import { beforeAll, describe, expect, it } from 'vitest';
import type { Category, Entity, Settings, Transaction, TxKind, Wallet } from '@/domain/types';
import { SYNC_TABLES, fromWire, toWire, type PulledRow, type SyncTableName, type WireRow } from '@/sync/tables';
import { TransportError, type SyncTransport } from '@/sync/transport';
import { makeCategory, makeSettings, makeTransaction, makeUserId, makeWallet } from './factories';

/**
 * Общий набор сценариев для ВСЕХ реализаций сервера синхронизации (PGlite, позже MemoryTransport).
 * Сценарии написаны против интерфейса SyncTransport; время берётся у сервера (harness.now()), а не из фабрик.
 */
export interface ServerHarness {
  /** Клиент от имени пользователя (пользователь заводится сам). */
  transportFor(userId: string): SyncTransport;
  /** Текущее время сервера. */
  now(): Date;
  /** Все строки таблицы в обход проверок доступа (если реализация это умеет). */
  adminRows?(table: SyncTableName): Promise<Record<string, unknown>[]>;
  /** Клиент без входа. Если не задан, сценарий 10 пропускается (и это видно в отчёте vitest). */
  signedOutTransport?(): SyncTransport;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number): string => new Date(ms).toISOString();
const must = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw new Error(`нет значения: ${what}`);
  return v;
};
const newId = (): string => makeWallet().id;
const markerUuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Забрать таблицу целиком постранично. */
async function pullAll(t: SyncTransport, table: SyncTableName, afterSeq = 0, page = 500): Promise<PulledRow[]> {
  const out: PulledRow[] = [];
  let cur = afterSeq;
  for (;;) {
    const rows = await t.pull(table, cur, page);
    out.push(...rows);
    if (rows.length < page) return out;
    cur = must(rows[rows.length - 1], 'последняя строка страницы').server_seq;
  }
}

const find = async (t: SyncTransport, table: SyncTableName, id: string): Promise<PulledRow | undefined> =>
  (await pullAll(t, table)).find((r) => r.id === id);

async function failure(p: Promise<unknown>): Promise<TransportError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'ожидалась ошибка TransportError').toBeInstanceOf(TransportError);
  return err as TransportError;
}

async function expectRejected(p: Promise<unknown>): Promise<void> {
  const err = await failure(p);
  expect(err.kind, err.message).toBe('rejected');
  expect(err.retryable).toBe(false);
}

interface Stamp {
  clientUpdatedAt: string;
  deviceId: string;
  deletedAt?: string | null;
  createdAt?: string;
}

/** «Предмет» сценария: одна сущность нужной таблицы; n — видимый маркер содержимого (по нему видно, чья версия сохранилась). */
interface Subject {
  id: string;
  prepare(): Promise<void>;
  row(n: number, s: Stamp): WireRow;
}

function makeSubject(table: SyncTableName, userId: string, t: SyncTransport, t0: number): Subject {
  const id = table === 'settings' ? userId : newId();
  const old = iso(t0 - 2 * HOUR);
  const parent = makeWallet({ createdAt: old, clientUpdatedAt: old }); // родитель для операции
  const build = (n: number, s: Stamp): Entity => {
    const sync = { createdAt: s.createdAt ?? old, clientUpdatedAt: s.clientUpdatedAt, deviceId: s.deviceId, deletedAt: s.deletedAt ?? null };
    switch (table) {
      case 'settings':
        return makeSettings(userId, { ...sync, defaultWalletId: markerUuid(n) });
      case 'wallets':
        return makeWallet({ ...sync, id, name: `m${n}` });
      case 'categories':
        return makeCategory({ ...sync, id, name: `m${n}` });
      case 'transactions':
        return makeTransaction({ ...sync, id, walletId: parent.id, note: `m${n}` });
    }
  };
  return {
    id,
    prepare: async () => {
      if (table === 'transactions') await t.push('wallets', [toWire('wallets', parent)]);
    },
    row: (n, s) => toWire(table, build(n, s)),
  };
}

const markerOf = (table: SyncTableName, r: Record<string, unknown>): number =>
  table === 'settings'
    ? parseInt(String(r['default_wallet_id']).slice(-12), 16)
    : Number(String(r[table === 'transactions' ? 'note' : 'name']).slice(1));

export function runConformance(label: string, make: () => Promise<ServerHarness>): void {
  describe(`сервер синхронизации: ${label}`, () => {
    let h: ServerHarness;
    beforeAll(async () => {
      h = await make();
    }, 120_000);

    const fresh = () => {
      const userId = makeUserId();
      return { userId, t: h.transportFor(userId) };
    };
    /** Свежий пользователь + предмет нужной таблицы; at() — метка «час назад + offset», put() — отправка версии n. */
    const setup = async (table: SyncTableName) => {
      const { userId, t } = fresh();
      const t0 = h.now().getTime();
      const subj = makeSubject(table, userId, t, t0);
      await subj.prepare();
      const at = (offsetMs: number, deviceId: string, extra: Partial<Stamp> = {}): Stamp => ({
        clientUpdatedAt: iso(t0 - HOUR + offsetMs),
        deviceId,
        ...extra,
      });
      return {
        userId,
        t,
        t0,
        subj,
        at,
        put: (n: number, offsetMs: number, deviceId: string, extra: Partial<Stamp> = {}) =>
          t.push(table, [subj.row(n, at(offsetMs, deviceId, extra))]),
        get: async () => must(await find(t, table, subj.id), 'строка предмета'),
      };
    };

    it('1. круговой обмен: push → pull возвращает ту же сущность (все 4 таблицы)', async () => {
      const { userId, t } = fresh();
      const t0 = h.now().getTime();
      const sync = (k: number) => ({ createdAt: iso(t0 - HOUR + k * 1000), clientUpdatedAt: iso(t0 - HOUR + k * 1000 + 500), deviceId: 'device-a' });
      const w1 = makeWallet({ ...sync(0), openingBalanceMinor: 150_000 });
      const w2 = makeWallet({ ...sync(1), currency: 'USD', kind: 'card', name: 'Карта «Алиф»', archivedAt: iso(t0 - 30 * MIN), deletedAt: iso(t0 - 20 * MIN) });
      const cat = makeCategory({ ...sync(2), kind: 'income', name: 'Зарплата', archivedAt: iso(t0 - 10 * MIN) });
      const sub = makeCategory({ ...sync(3), parentId: cat.id });
      const settings = makeSettings(userId, { ...sync(4), defaultWalletId: w1.id, weekStartsOn: 0 });
      const expense = makeTransaction({ ...sync(5), walletId: w1.id, categoryId: sub.id, note: 'Обед, «плов»', amountMinor: 12_345, baseAmountMinor: 12_345 });
      const usd = makeTransaction({ ...sync(6), walletId: w2.id, amountMinor: 1_000, baseAmountMinor: 10_900, fxRate: 10.9, fxSource: 'nbt', occurredOn: '2026-02-28' });
      const income = makeTransaction({ ...sync(7), kind: 'income', walletId: w1.id, categoryId: cat.id, amountMinor: 500_000, baseAmountMinor: 500_000 });
      const transfer = makeTransaction({ ...sync(8), kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: 109_00, toAmountMinor: 1_000 });
      const sent: Record<SyncTableName, Entity[]> = {
        settings: [settings],
        wallets: [w1, w2],
        categories: [cat, sub],
        transactions: [expense, usd, income, transfer],
      };
      for (const table of SYNC_TABLES) await t.push(table, sent[table].map((e) => toWire(table, e))); // порядок: родители раньше детей
      for (const table of SYNC_TABLES) {
        const pulled = await pullAll(t, table);
        expect(pulled, table).toHaveLength(sent[table].length);
        const got = new Map(pulled.map((r) => [r.id as string, fromWire(table, r).entity]));
        for (const e of sent[table]) expect(got.get(e.id), `${table}/${e.id}`).toEqual(e);
        for (const r of pulled) expect(r.server_seq).toBeGreaterThan(0);
      }
    });

    it.each(SYNC_TABLES)('2. идемпотентность (%s): тот же push дважды → одна строка, server_seq не растёт', async (table) => {
      const c = await setup(table);
      await c.put(1, 0, 'dev-a');
      const first = await pullAll(c.t, table);
      expect(first.filter((r) => r.id === c.subj.id)).toHaveLength(1);
      await c.put(1, 0, 'dev-a');
      await c.put(1, 0, 'dev-a');
      expect(await pullAll(c.t, table)).toEqual(first); // ни одной новой или изменённой строки (server_seq и server_updated_at на месте)
      const maxSeq = Math.max(...first.map((r) => r.server_seq));
      expect(await c.t.pull(table, maxSeq, 100)).toEqual([]);
    });

    it.each(SYNC_TABLES)('3. «последний побеждает» (%s): метка, затем больший device_id; устаревшее игнорируется без ошибки', async (table) => {
      const c = await setup(table);
      const marker = async () => markerOf(table, await c.get());

      await c.put(1, 0, 'dev-b');
      const s1 = (await c.get()).server_seq;
      expect(await marker()).toBe(1);

      await c.put(2, 10_000, 'dev-a'); // новее по метке — побеждает, хотя device_id меньше
      const s2 = (await c.get()).server_seq;
      expect(await marker()).toBe(2);
      expect(s2).toBeGreaterThan(s1);

      let snap = await c.get();
      await c.put(3, 5_000, 'dev-z'); // старее — молча игнорируется
      expect(await c.get()).toEqual(snap);

      await c.put(4, 10_000, 'dev-b'); // метка равна, device_id больше — побеждает
      expect(await marker()).toBe(4);
      expect((await c.get()).server_seq).toBeGreaterThan(s2);

      snap = await c.get();
      await c.put(5, 10_000, 'dev-a'); // метка равна, device_id меньше — игнор
      await c.put(6, 10_000, 'dev-b'); // метка и device_id те же — игнор
      expect(await c.get()).toEqual(snap);

      // device_id сравнивается по кодам символов, а не по правилам языка: 'B' (0x42) меньше 'a' (0x61)
      await c.put(7, 20_000, 'a-dev');
      snap = await c.get();
      expect(markerOf(table, snap)).toBe(7);
      await c.put(8, 20_000, 'B-dev');
      expect(await c.get()).toEqual(snap);
    });

    it.each(SYNC_TABLES)('4. мягкое удаление (%s): deleted_at доходит до других устройств; старая правка не воскрешает, новая воскрешает', async (table) => {
      const c = await setup(table);
      const deletedAt = (offset: number) => iso(c.t0 - HOUR + offset);

      await c.put(1, 0, 'dev-a');
      await c.put(2, 10_000, 'dev-a', { deletedAt: deletedAt(10_000) });
      const gone = must(await find(h.transportFor(c.userId), table, c.subj.id), 'удалённая строка осталась в выдаче');
      expect(fromWire(table, gone).entity.deletedAt).toBe(deletedAt(10_000));

      await c.put(3, 5_000, 'dev-a'); // правка, сделанная ДО удаления, приходит позже
      expect(fromWire(table, await c.get()).entity.deletedAt).toBe(deletedAt(10_000));
      expect(markerOf(table, await c.get())).toBe(2);

      await c.put(4, 20_000, 'dev-a'); // правка ПОСЛЕ удаления воскрешает
      expect(fromWire(table, await c.get()).entity.deletedAt).toBeNull();
      expect(markerOf(table, await c.get())).toBe(4);
    });

    it.each(SYNC_TABLES)('5. метка из далёкого будущего (%s) зажимается до «сейчас + 5 минут»', async (table) => {
      const year = 365 * 24 * HOUR;
      const limit = () => h.now().getTime() + 5 * MIN;
      // а) вставка
      const a = await setup(table);
      await a.put(1, 0, 'dev-a', { clientUpdatedAt: iso(a.t0 + year), createdAt: iso(a.t0 + year) });
      const ins = fromWire(table, await a.get()).entity;
      expect(Date.parse(ins.clientUpdatedAt)).toBeLessThanOrEqual(limit());
      // б) правка существующей строки
      const b = await setup(table);
      await b.put(1, 0, 'dev-a');
      await b.put(2, 0, 'dev-a', { clientUpdatedAt: iso(b.t0 + year) });
      const upd = fromWire(table, await b.get()).entity;
      expect(markerOf(table, await b.get())).toBe(2); // правка принята, не отвергнута
      expect(Date.parse(upd.clientUpdatedAt)).toBeLessThanOrEqual(limit());
      // в) метка в пределах допуска не трогается
      const c = await setup(table);
      const near = iso(c.t0 + MIN);
      await c.put(1, 0, 'dev-a', { clientUpdatedAt: near });
      expect(fromWire(table, await c.get()).entity.clientUpdatedAt).toBe(near);
    });

    describe('6. изоляция пользователей', () => {
      it('чужие строки не видны через pull', async () => {
        const A = fresh();
        const B = fresh();
        for (const table of SYNC_TABLES) {
          const s = makeSubject(table, A.userId, A.t, h.now().getTime());
          await s.prepare();
          await A.t.push(table, [s.row(1, { clientUpdatedAt: iso(h.now().getTime() - HOUR), deviceId: 'dev-a' })]);
          expect(await pullAll(A.t, table), table).not.toHaveLength(0);
          expect(await pullAll(B.t, table), table).toEqual([]);
        }
      });

      for (const table of ['wallets', 'categories', 'transactions'] as const) {
        it(`push с id чужой строки (${table}) не меняет её`, async () => {
          const A = await setup(table);
          await A.put(1, 0, 'dev-a');
          const snap = await A.get();
          const B = fresh();
          const t0 = h.now().getTime();
          const bs = makeSubject(table, B.userId, B.t, t0);
          await bs.prepare(); // у B есть свой кошелёк, чтобы операция была бы валидной
          const evil = { ...bs.row(9, { clientUpdatedAt: iso(t0), deviceId: 'dev-z' }), id: A.subj.id }; // новее и с «большим» устройством
          await B.t.push(table, [evil]).catch((e: unknown) => expect(e).toBeInstanceOf(TransportError)); // ошибка или игнор — оба допустимы
          expect(await A.get()).toEqual(snap);
        });
      }

      it('присланные user_id, server_seq, server_updated_at игнорируются', async () => {
        const A = fresh();
        const B = fresh();
        const t0 = h.now().getTime();
        const w = makeWallet({ createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR) });
        const forged: WireRow = { ...toWire('wallets', w), user_id: A.userId, server_seq: 1_000_000_000, server_updated_at: '2000-01-01T00:00:00.000Z' };
        await B.t.push('wallets', [forged]);
        const mine = must(await find(B.t, 'wallets', w.id), 'строка у отправителя');
        expect(mine.server_seq).toBeLessThan(1_000_000_000);
        expect(await find(A.t, 'wallets', w.id)).toBeUndefined();
        if (h.adminRows) {
          const stored = must((await h.adminRows('wallets')).find((r) => r['id'] === w.id), 'строка в адмистративной выдаче');
          expect(stored['user_id']).toBe(B.userId);
        }
      });
    });

    it('7. порядок и страницы pull: limit, afterSeq, строго возрастающий server_seq; обновлённая строка получает больший номер', async () => {
      const A = fresh();
      const B = fresh();
      const t0 = h.now().getTime();
      const stamp = iso(t0 - HOUR);
      const wallets = Array.from({ length: 27 }, () => makeWallet({ createdAt: stamp, clientUpdatedAt: stamp }));
      for (let i = 0; i < 27; i += 9) {
        await A.t.push('wallets', wallets.slice(i, i + 9).map((w) => toWire('wallets', w)));
        await B.t.push('wallets', [toWire('wallets', makeWallet({ createdAt: stamp, clientUpdatedAt: stamp }))]); // чужие записи между нашими
      }
      const all = await pullAll(A.t, 'wallets');
      expect(all.map((r) => r.id).sort()).toEqual(wallets.map((w) => w.id).sort());
      all.forEach((r, i) => {
        expect(Number.isSafeInteger(r.server_seq)).toBe(true);
        if (i > 0) expect(r.server_seq).toBeGreaterThan(must(all[i - 1], 'предыдущая').server_seq);
      });

      const p1 = await A.t.pull('wallets', 0, 10);
      const p2 = await A.t.pull('wallets', must(p1[9], 'p1[9]').server_seq, 10);
      const p3 = await A.t.pull('wallets', must(p2[9], 'p2[9]').server_seq, 10);
      expect([p1.length, p2.length, p3.length]).toEqual([10, 10, 7]);
      expect([...p1, ...p2, ...p3]).toEqual(all);
      expect(await A.t.pull('wallets', must(p3[6], 'p3[6]').server_seq, 10)).toEqual([]);
      expect(await A.t.pull('wallets', 0, 1)).toEqual([must(all[0], 'all[0]')]);
      expect(await A.t.pull('wallets', must(all[4], 'all[4]').server_seq, 3)).toEqual(all.slice(5, 8));

      const target = wallets[2] as Wallet;
      const maxBefore = must(all[all.length - 1], 'последняя').server_seq;
      await A.t.push('wallets', [toWire('wallets', { ...target, name: 'Новое имя', clientUpdatedAt: iso(t0 - HOUR + 1000) })]);
      const tail = await A.t.pull('wallets', maxBefore, 10);
      expect(tail.map((r) => r.id)).toEqual([target.id]);
      expect(must(tail[0], 'обновлённая').server_seq).toBeGreaterThan(maxBefore);
    });

    describe('8. отказы сервера: вся пачка отвергается целиком', () => {
      const ctx = {} as { B: ReturnType<typeof fresh>; w1: Wallet; w2: Wallet; catId: string; foreignWalletId: string; foreignCatId: string };
      const sync = () => ({ createdAt: iso(h.now().getTime() - HOUR), clientUpdatedAt: iso(h.now().getTime() - HOUR), deviceId: 'device-a' });
      const tx = (o: Partial<Transaction>): WireRow => toWire('transactions', makeTransaction({ ...sync(), walletId: ctx.w1.id, ...o }));
      const wal = (o: Partial<Wallet>): WireRow => toWire('wallets', makeWallet({ ...sync(), ...o }));
      const cat = (o: Partial<Category>): WireRow => toWire('categories', makeCategory({ ...sync(), ...o }));

      beforeAll(async () => {
        const A = fresh();
        const fw = makeWallet(sync());
        const fc = makeCategory(sync());
        await A.t.push('wallets', [toWire('wallets', fw)]);
        await A.t.push('categories', [toWire('categories', fc)]);
        ctx.B = fresh();
        ctx.w1 = makeWallet(sync());
        ctx.w2 = makeWallet({ ...sync(), currency: 'USD' });
        const c = makeCategory(sync());
        await ctx.B.t.push('wallets', [toWire('wallets', ctx.w1), toWire('wallets', ctx.w2)]);
        await ctx.B.t.push('categories', [toWire('categories', c)]);
        ctx.catId = c.id;
        ctx.foreignWalletId = fw.id;
        ctx.foreignCatId = fc.id;
      });

      const tooLong = 'я'.repeat(501);
      const cases: Array<[string, SyncTableName, () => WireRow]> = [
        ['сумма 0', 'transactions', () => tx({ amountMinor: 0 })],
        ['отрицательная сумма', 'transactions', () => tx({ amountMinor: -5 })],
        ['сумма больше допустимой', 'transactions', () => tx({ amountMinor: 1_000_000_000_000_001 })],
        ['перевод на тот же кошелёк', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w1.id })],
        ['перевод без суммы зачисления', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, toAmountMinor: null })],
        ['перевод с нулевой суммой зачисления', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, toAmountMinor: 0 })],
        ['перевод с категорией', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, categoryId: ctx.catId })],
        ['перевод с курсом', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, fxRate: 1, fxSource: 'same' })],
        ['расход с to_wallet_id', 'transactions', () => tx({ toWalletId: ctx.w2.id })],
        ['расход с to_amount_minor', 'transactions', () => tx({ toAmountMinor: 5 })],
        ['плохая валюта операции', 'transactions', () => tx({ baseCurrency: 'tjs' })],
        ['курс 0', 'transactions', () => tx({ fxRate: 0 })],
        ['отрицательный курс', 'transactions', () => tx({ fxRate: -1.5 })],
        ['дата раньше 2000 года', 'transactions', () => tx({ occurredOn: '1999-12-31' })],
        ['дата позже 2100 года', 'transactions', () => tx({ occurredOn: '2100-01-02' })],
        ['заметка длиннее 500 символов', 'transactions', () => tx({ note: tooLong })],
        ['неизвестный вид операции', 'transactions', () => tx({ kind: 'refund' as unknown as TxKind })],
        ['пустой device_id', 'transactions', () => tx({ deviceId: '' })],
        ['операция с кошельком другого пользователя', 'transactions', () => tx({ walletId: ctx.foreignWalletId })],
        ['перевод на кошелёк другого пользователя', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.foreignWalletId })],
        ['операция с категорией другого пользователя', 'transactions', () => tx({ categoryId: ctx.foreignCatId })],
        ['операция на ещё не отправленный кошелёк', 'transactions', () => tx({ walletId: newId() })],
        ['валюта кошелька не из трёх заглавных букв', 'wallets', () => wal({ currency: 'tjs' })],
        ['пустое имя кошелька', 'wallets', () => wal({ name: '' })],
        ['имя кошелька длиннее 80 символов', 'wallets', () => wal({ name: 'я'.repeat(81) })],
        ['неизвестный вид кошелька', 'wallets', () => wal({ kind: 'crypto' as Wallet['kind'] })],
        ['остаток кошелька за пределом', 'wallets', () => wal({ openingBalanceMinor: 1_000_000_000_000_001 })],
        ['неизвестный вид категории', 'categories', () => cat({ kind: 'transfer' as 'expense' })],
        ['пустое имя категории', 'categories', () => cat({ name: '' })],
      ];

      for (const [title, table, bad] of cases) {
        it(title, async () => {
          const good = table === 'wallets' ? wal({}) : table === 'categories' ? cat({}) : tx({});
          const badRow = bad();
          await expectRejected(ctx.B.t.push(table, [good, badRow]));
          const ids = (await pullAll(ctx.B.t, table)).map((r) => r.id);
          expect(ids, 'хорошая строка из той же пачки не должна сохраниться').not.toContain(good['id']);
          expect(ids).not.toContain(badRow['id']);
        });
      }
    });

    it('9. settings.id обязан равняться id пользователя', async () => {
      const A = fresh();
      const B = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      await A.t.push('settings', [toWire('settings', makeSettings(A.userId, sync))]);
      const snap = await pullAll(A.t, 'settings');
      expect(snap).toHaveLength(1);

      const newer = { ...sync, clientUpdatedAt: iso(t0), weekStartsOn: 0 as const };
      await expectRejected(B.t.push('settings', [toWire('settings', makeSettings(A.userId, newer))])); // id чужого пользователя
      await expectRejected(B.t.push('settings', [toWire('settings', { ...makeSettings(B.userId, sync), id: newId() })])); // случайный id
      expect(await pullAll(B.t, 'settings')).toEqual([]);
      expect(await pullAll(A.t, 'settings')).toEqual(snap);

      const broken: Array<Partial<Settings>> = [{ locale: 'en' as 'ru' }, { weekStartsOn: 2 as 0 }, { baseCurrency: 'tjs' }];
      for (const o of broken) await expectRejected(B.t.push('settings', [toWire('settings', makeSettings(B.userId, { ...sync, ...o }))]));

      await B.t.push('settings', [toWire('settings', makeSettings(B.userId, sync))]); // свой id — принимается
      expect(await pullAll(B.t, 'settings')).toHaveLength(1);
    });

    it('10. без входа нельзя ни читать, ни писать (физического удаления в SyncTransport нет вовсе)', async (ctx) => {
      if (!h.signedOutTransport) return ctx.skip();
      const out = h.signedOutTransport();
      const { t } = fresh();
      const t0 = h.now().getTime();
      const w = makeWallet({ createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR) });
      await t.push('wallets', [toWire('wallets', w)]);
      const snap = await pullAll(t, 'wallets');
      for (const table of SYNC_TABLES) {
        const err = await failure(out.pull(table, 0, 10));
        expect(['auth', 'rejected']).toContain(err.kind);
      }
      const forged = toWire('wallets', makeWallet({ createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0) }));
      expect(['auth', 'rejected']).toContain((await failure(out.push('wallets', [forged]))).kind);
      const overwrite = { ...toWire('wallets', w), name: 'Взлом', client_updated_at: iso(t0) };
      expect(['auth', 'rejected']).toContain((await failure(out.push('wallets', [overwrite]))).kind);
      expect(await pullAll(t, 'wallets')).toEqual(snap);
    });
  });
}
