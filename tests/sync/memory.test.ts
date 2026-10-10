// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import { fromWire, toWire } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeCategory, makeSettings, makeTransaction, makeUserId, makeWallet } from './factories';

/** Что сервер в памяти умеет сверх общего набора сценариев: сбои, задержки, журнал меток, формат выдачи. */

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

/** Сервер с часами, которыми управляет тест. */
function serverAt(start = T0) {
  let t = start;
  const server = createMemoryServer({ now: () => t });
  return { server, set: (ms: number) => (t = ms), get: () => t };
}

async function errorOf(p: Promise<unknown>): Promise<TransportError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(TransportError);
  return e as TransportError;
}

describe('MemoryServer: журнал меток из будущего (как private.sync_future_stamps)', () => {
  const base = (name: string, device: string, at: number, w = fixedWallet) => toWire('wallets', { ...w, name, deviceId: device, clientUpdatedAt: iso(at) });
  const fixedWallet = makeWallet({ createdAt: iso(T0 - 10 * MIN), clientUpdatedAt: iso(T0 - 10 * MIN), name: 'исходное', deviceId: 'dev-b' });
  const nameOf = (s: ReturnType<typeof serverAt>, uid: string) => (s.server.dump(uid, 'wallets')[0] ?? {})['name'];

  it('запоздалый повтор: когда время сервера «догнало» присланную метку, старая правка новую не затирает', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    await t.push('wallets', [base('исходное', 'dev-b', T0 - 10 * MIN)]);
    const aEdit = base('правка A', 'dev-a', T0 + 60 * MIN); // часы устройства A убежали на час вперёд
    await t.push('wallets', [aEdit]); // принята, метка зажата до «сейчас + 5 минут»
    s.set(T0 + 6 * MIN);
    await t.push('wallets', [base('правка B', 'dev-b', T0 + 6 * MIN)]);
    expect(nameOf(s, uid)).toBe('правка B');
    const afterB = s.server.dump(uid, 'wallets');
    s.set(T0 + 58 * MIN); // «сейчас + 5 минут» уже позже присланной метки: зажатия нет, но правку уже видели
    await t.push('wallets', [aEdit]);
    expect(s.server.dump(uid, 'wallets')).toEqual(afterB); // ни имени, ни server_seq, ни server_updated_at не тронуто
  });

  it('настоящая новая правка с тех же часов принимается', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    await t.push('wallets', [base('исходное', 'dev-b', T0 - 10 * MIN)]);
    await t.push('wallets', [base('правка A1', 'dev-a', T0 + 60 * MIN)]);
    s.set(T0 + 6 * MIN);
    await t.push('wallets', [base('правка B', 'dev-b', T0 + 6 * MIN)]);
    s.set(T0 + 7 * MIN);
    await t.push('wallets', [base('правка A2', 'dev-a', T0 + 62 * MIN)]); // другая метка = другая правка
    const row = s.server.dump(uid, 'wallets')[0];
    expect(row?.['name']).toBe('правка A2');
    expect(Date.parse(String(row?.['client_updated_at']))).toBeLessThanOrEqual(T0 + 12 * MIN);
  });

  it('повтор той же будущей метки не плодит новых server_seq', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    await t.push('wallets', [base('исходное', 'dev-b', T0 - 10 * MIN)]);
    const edit = base('правка A', 'dev-a', T0 + 3 * 60 * MIN);
    await t.push('wallets', [edit]);
    const first = s.server.dump(uid, 'wallets');
    s.set(T0 + MIN); // время идёт, зажатая метка «молодеет» — а повтор всё равно не меняет строку
    await t.push('wallets', [edit]);
    await t.push('wallets', [edit]);
    expect(s.server.dump(uid, 'wallets')).toEqual(first);
  });
});

describe('MemoryServer: отказы пачки и формат ответа', () => {
  it('пачка принимается целиком или отвергается целиком, даже если плохая строка последняя', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const stamp = { createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) };
    const good = Array.from({ length: 5 }, () => toWire('wallets', makeWallet(stamp)));
    const bad = toWire('wallets', makeWallet({ ...stamp, name: '' }));
    const err = await errorOf(t.push('wallets', [...good, bad]));
    expect(err.kind).toBe('rejected');
    expect(err.code).toBe('23514');
    expect(s.server.dump(uid, 'wallets')).toEqual([]);
    await t.push('wallets', good); // без плохой — проходит
    expect(s.server.dump(uid, 'wallets')).toHaveLength(5);
  });

  it('две строки с одним id в пачке: отказ 21000, ничего не сохранено', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const w = makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) });
    const err = await errorOf(t.push('wallets', [toWire('wallets', w), toWire('wallets', { ...w, name: 'другое', clientUpdatedAt: iso(T0) })]));
    expect(err.kind).toBe('rejected');
    expect(err.code).toBe('21000');
    expect(s.server.dump(uid, 'wallets')).toEqual([]);
  });

  it('устаревшая правка с битым значением всё равно отвергается (проверки идут до разбора конфликта)', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const w = makeWallet({ createdAt: iso(T0 - HOUR()), clientUpdatedAt: iso(T0 - MIN) });
    await t.push('wallets', [toWire('wallets', w)]);
    const stale = toWire('wallets', { ...w, name: '', clientUpdatedAt: iso(T0 - 30 * MIN) });
    expect((await errorOf(t.push('wallets', [stale]))).code).toBe('23514');
  });

  it('чужая строка с тем же id: отказ по правам доступа (42501), чужая строка цела', async () => {
    const s = serverAt();
    const [a, b] = [makeUserId(), makeUserId()];
    const w = makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) });
    await s.server.transportFor(a).push('wallets', [toWire('wallets', w)]);
    const snap = s.server.dump(a, 'wallets');
    const err = await errorOf(s.server.transportFor(b).push('wallets', [toWire('wallets', { ...w, name: 'взлом', clientUpdatedAt: iso(T0) })]));
    expect(err.kind).toBe('rejected');
    expect(err.code).toBe('42501');
    expect(s.server.dump(a, 'wallets')).toEqual(snap);
    expect(s.server.dump(b, 'wallets')).toEqual([]);
  });

  it('неизвестная колонка — не «отказ данных», а ошибка сервера (как PGRST204): повторять, а не ставить в карантин', async () => {
    const s = serverAt();
    const t = s.server.transportFor(makeUserId());
    const row = { ...toWire('wallets', makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) })), balance: 5 };
    const err = await errorOf(t.push('wallets', [row]));
    expect(err.kind).toBe('server');
    expect(err.code).toBe('PGRST204');
  });

  it('пустое обязательное поле → 23502, неверный тип → 22P02, дата вне календаря → 22008', async () => {
    const s = serverAt();
    const t = s.server.transportFor(makeUserId());
    const w = toWire('wallets', makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) }));
    expect((await errorOf(t.push('wallets', [{ ...w, name: null }]))).code).toBe('23502');
    expect((await errorOf(t.push('wallets', [{ ...w, opening_balance_minor: 1.5 }]))).code).toBe('22P02');
    expect((await errorOf(t.push('wallets', [{ ...w, opening_balance_minor: '10' }]))).code).toBe('22P02');
    expect((await errorOf(t.push('wallets', [{ ...w, id: 'не-uuid' }]))).code).toBe('22P02');
    const tx = toWire('transactions', makeTransaction({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN), occurredOn: '2026-02-30' }));
    expect((await errorOf(t.push('transactions', [tx]))).code).toBe('22008');
  });

  it('метки времени отдаются в виде PostgREST, а fromWire возвращает их в каноничном виде', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const w = makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: '2026-10-10T11:59:00.120Z' });
    await t.push('wallets', [toWire('wallets', w)]);
    const row = (await t.pull('wallets', 0, 10))[0];
    expect(row?.['client_updated_at']).toBe('2026-10-10T11:59:00.12+00:00');
    expect(row?.['created_at']).toBe('2026-10-10T11:59:00+00:00');
    expect(typeof row?.['server_seq']).toBe('number');
    expect(fromWire('wallets', row as never).entity).toEqual(w);
  });

  it('fx_rate округляется до 10 знаков, как numeric(20,10)', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const w = makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) });
    await t.push('wallets', [toWire('wallets', w)]);
    const tx = makeTransaction({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN), walletId: w.id, fxRate: 10.123456789012345, fxSource: 'nbt' });
    await t.push('transactions', [toWire('transactions', tx)]);
    expect(s.server.dump(uid, 'transactions')[0]?.['fx_rate']).toBe(10.123456789);
  });

  it('присланные user_id, server_seq, server_updated_at не сохраняются', async () => {
    const s = serverAt();
    const [a, b] = [makeUserId(), makeUserId()];
    const w = makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) });
    await s.server.transportFor(b).push('wallets', [{ ...toWire('wallets', w), user_id: a, server_seq: 999_999, server_updated_at: '2000-01-01T00:00:00Z' }]);
    const row = s.server.dump(b, 'wallets')[0];
    expect(row?.['user_id']).toBe(b);
    expect(row?.['server_seq']).toBeLessThan(999_999);
    expect(row?.['server_updated_at']).toBe(formatLike(T0));
    expect(s.server.dump(a, 'wallets')).toEqual([]);
  });

  it('родители проверяются по текущему состоянию того же пользователя; settings.id обязан быть id пользователя', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    const stamp = { createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) };
    const w = makeWallet(stamp);
    const c = makeCategory(stamp);
    await t.push('wallets', [toWire('wallets', w)]);
    await t.push('categories', [toWire('categories', c)]);
    await t.push('transactions', [toWire('transactions', makeTransaction({ ...stamp, walletId: w.id, categoryId: c.id }))]);
    expect((await errorOf(t.push('transactions', [toWire('transactions', makeTransaction({ ...stamp, walletId: makeWallet().id }))]))).code).toBe('23503');
    await t.push('settings', [toWire('settings', makeSettings(uid, stamp))]);
    expect((await errorOf(t.push('settings', [toWire('settings', makeSettings(makeUserId(), stamp))]))).code).toBe('23514');
  });
});

describe('MemoryServer: сценарии отказов', () => {
  const oneWallet = () => toWire('wallets', makeWallet({ createdAt: iso(T0 - MIN), clientUpdatedAt: iso(T0 - MIN) }));

  it('setOnline(false): запросы падают сетевой ошибкой, данные не меняются; при возврате сети всё работает', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    s.server.setOnline(false);
    expect((await errorOf(t.pull('wallets', 0, 10))).kind).toBe('network');
    expect((await errorOf(t.push('wallets', [oneWallet()]))).kind).toBe('network');
    expect((await errorOf(s.server.signedOutTransport().pull('wallets', 0, 10))).kind).toBe('network');
    expect(s.server.dump(uid, 'wallets')).toEqual([]);
    s.server.setOnline(true);
    await t.push('wallets', [oneWallet()]);
    expect(await t.pull('wallets', 0, 10)).toHaveLength(1);
  });

  it('failNext: ровно столько запросов, сколько просили, любого вида; запрос не применяется', async () => {
    const s = serverAt();
    const uid = makeUserId();
    const t = s.server.transportFor(uid);
    s.server.failNext('server', 2);
    expect((await errorOf(t.push('wallets', [oneWallet()]))).kind).toBe('server');
    expect((await errorOf(t.pull('wallets', 0, 10))).kind).toBe('server');
    expect(s.server.dump(uid, 'wallets')).toEqual([]);
    s.server.failNext('auth');
    expect((await errorOf(t.pull('wallets', 0, 10))).kind).toBe('auth');
    s.server.failNext('rejected');
    expect((await errorOf(t.push('wallets', [oneWallet()]))).kind).toBe('rejected');
    await t.push('wallets', [oneWallet()]); // очередь отказов кончилась
    expect(s.server.dump(uid, 'wallets')).toHaveLength(1);
    expect(() => s.server.failNext('network', 0)).toThrow(RangeError);
  });

  it('пустая пачка — не запрос: не тратит отказ из очереди', async () => {
    const s = serverAt();
    const t = s.server.transportFor(makeUserId());
    s.server.failNext('server');
    await t.push('wallets', []);
    expect((await errorOf(t.pull('wallets', 0, 10))).kind).toBe('server');
  });

  it('signedOutTransport: и чтение, и запись — auth', async () => {
    const s = serverAt();
    const out = s.server.signedOutTransport();
    expect((await errorOf(out.pull('wallets', 0, 10))).kind).toBe('auth');
    expect((await errorOf(out.push('wallets', [oneWallet()]))).kind).toBe('auth');
  });

  it('setLatency: ответ приходит не раньше заданного времени', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const s = serverAt();
      const t = s.server.transportFor(makeUserId());
      s.server.setLatency(200);
      let done = false;
      const p = t.push('wallets', [oneWallet()]).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(199);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(done).toBe(true);
      expect(() => s.server.setLatency(-1)).toThrow(RangeError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pull проверяет аргументы', async () => {
    const t = createMemoryServer().transportFor(makeUserId());
    await expect(t.pull('wallets', -1, 10)).rejects.toBeInstanceOf(RangeError);
    await expect(t.pull('wallets', 0, 0)).rejects.toBeInstanceOf(RangeError);
  });
});

function HOUR(): number {
  return 60 * MIN;
}
function formatLike(ms: number): string {
  return iso(ms).replace('.000Z', '+00:00');
}
