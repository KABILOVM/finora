import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { LocalRow, Wallet } from '@/domain/types';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { makeTransaction, makeWallet } from './factories';
import { USER, openDevice, snapshotOf, spy, until, type Device, type Spy } from './engineHarness';

/** Движок синхронизации: основные сценарии на двух «устройствах» одного пользователя и сервере в памяти. */

const iso = (ms: number) => new Date(ms).toISOString();
const firstWallet = async (d: Device): Promise<LocalRow<Wallet>> => {
  const w = await d.store.db.wallets.orderBy('sortOrder').first();
  if (!w) throw new Error('нет кошелька');
  return w;
};
const serverRows = (s: ReturnType<typeof createMemoryServer>, table: 'wallets' | 'transactions' | 'categories' | 'settings') => s.dump(USER, table);

/** Устройство с затравкой и шпионом над транспортом; первый цикл уже выполнен. */
async function ready(server: ReturnType<typeof createMemoryServer>, id: string, now?: () => number) {
  let sp!: Spy;
  const d = await openDevice(server, id, { seed: true, now, wrap: (inner) => (sp = spy(inner)).transport });
  await d.engine.syncNow();
  return { d, sp };
}

describe('простая отправка и получение', () => {
  it('данные первого устройства попадают на сервер, второе устройство получает те же данные', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
    expect(a.engine.getStatus().lastSyncedAt).not.toBeNull();
    expect(serverRows(server, 'settings')).toHaveLength(1);
    expect(serverRows(server, 'wallets')).toHaveLength(1);
    expect(serverRows(server, 'categories')).toHaveLength(17);

    const w = await firstWallet(a);
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 12_500, occurredOn: '2026-10-05', note: 'плов' });
    expect(a.engine.getStatus().pending).toBe(0); // движок не запущен: счётчик обновится на цикле
    await a.engine.syncNow();
    expect(serverRows(server, 'transactions')).toHaveLength(1);

    const { d: b } = await ready(server, 'dev-b');
    expect(await snapshotOf(b.store)).toEqual(await snapshotOf(a.store));
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
  });

  it('удаление операции доезжает до другого устройства (мягкое удаление), строка остаётся', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const { d: b } = await ready(server, 'dev-b');
    const w = await firstWallet(a);
    const tx = await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 50_000, occurredOn: '2026-10-06' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect((await b.store.db.transactions.get(tx.id))?.deletedAt).toBeNull();
    await a.store.transactions.softDelete(tx.id);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect((await b.store.db.transactions.get(tx.id))?.deletedAt).not.toBeNull();
    expect(serverRows(server, 'transactions')).toHaveLength(1);
    expect(await snapshotOf(b.store)).toEqual(await snapshotOf(a.store));
  });

  it('конфликт: сервер оставил более новую правку другого устройства; после отправки устройство принимает серверную версию', async () => {
    let t = Date.now(); // общее «настоящее время»; сервер и устройства живут по нему (метки в пределах допуска сервера)
    const server = createMemoryServer({ now: () => t });
    const { d: a } = await ready(server, 'dev-a', () => t);
    const { d: b } = await ready(server, 'dev-b', () => t + 5_000); // часы B идут на 5 секунд впереди
    const w = await firstWallet(a);
    await b.engine.syncNow();
    t += 1000;
    await a.store.wallets.update(w.id, { name: 'правка A' });
    t += 1000;
    await b.store.wallets.update(w.id, { name: 'правка B' });
    await b.engine.syncNow(); // сервер получает B
    await a.engine.syncNow(); // старая правка A молча игнорируется сервером; A обязан принять версию B
    expect((await a.store.db.wallets.get(w.id))?.name).toBe('правка B');
    expect(a.engine.getStatus().pending).toBe(0);
    await b.engine.syncNow();
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
    expect(serverRows(server, 'wallets')[0]?.['name']).toBe('правка B');
  });

  it('обратный порядок: A успел отправить раньше, но B новее — побеждает B на обоих устройствах', async () => {
    let t = Date.now();
    const server = createMemoryServer({ now: () => t });
    const { d: a } = await ready(server, 'dev-a', () => t);
    const { d: b } = await ready(server, 'dev-b', () => t);
    await b.engine.syncNow();
    const w = await firstWallet(a);
    t += 1000;
    await a.store.wallets.update(w.id, { name: 'правка A' });
    t += 1000;
    await b.store.wallets.update(w.id, { name: 'правка B' });
    await a.engine.syncNow();
    await b.engine.syncNow(); // B новее: перекрывает A на сервере
    await a.engine.syncNow();
    expect((await a.store.db.wallets.get(w.id))?.name).toBe('правка B');
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
  });
});

describe('офлайн-очередь', () => {
  it('без сети правки копятся и честно показываются как неотправленные; с возвратом сети уходят', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    server.setOnline(false);
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 1000, occurredOn: '2026-10-07' });
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 2000, occurredOn: '2026-10-07' });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 2, lastError: 'Нет связи с сервером' });
    expect(serverRows(server, 'transactions')).toHaveLength(0);

    server.setOnline(true);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
    expect(serverRows(server, 'transactions')).toHaveLength(2);
  });

  it('событие online снимает паузу после сбоя и запускает цикл сразу', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    server.setOnline(false);
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 1000, occurredOn: '2026-10-07' });
    a.engine.start();
    await until(() => a.engine.getStatus().phase === 'offline', 'фаза offline после первой попытки');
    server.setOnline(true);
    window.dispatchEvent(new Event('online')); // не ждём 5 секунд паузы
    await until(() => serverRows(server, 'transactions').length === 1, 'операция на сервере');
    await until(() => a.engine.getStatus().phase === 'idle' && a.engine.getStatus().pending === 0, 'фаза idle');
  });

  it('обрыв связи посреди отправки: ушедшая часть не теряется и не повторяется, остаток уходит позже', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    const base = Date.now() - 3_600_000;
    const txs = Array.from({ length: 250 }, (_, i) =>
      makeTransaction({ walletId: w.id, createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', amountMinor: 100 + i, baseAmountMinor: 100 + i }),
    );
    await a.store.db.transactions.bulkPut(txs.map((t) => ({ ...t, dirty: 1 as const, serverSeq: null, syncError: null })));
    let n = 0;
    sp.onPush = () => {
      if (++n === 2) throw new TransportError('network', 'обрыв');
    };
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 50 });
    expect(serverRows(server, 'transactions')).toHaveLength(200);
    sp.onPush = undefined;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(serverRows(server, 'transactions')).toHaveLength(250);
    // 200 — принято; 50 — оборвано; ещё 50 — повтор. Уже принятые 200 заново не отправлялись.
    expect(sp.pushes('transactions').map((c) => c.size)).toEqual([200, 50, 50]);
  });

  it('ответ потерялся, хотя сервер данные принял: повторная отправка ничего не дублирует и не двигает server_seq', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 777, occurredOn: '2026-10-07' });
    sp.loseResponses = 1;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    const afterLoss = serverRows(server, 'transactions');
    expect(afterLoss).toHaveLength(1); // сервер данные принял
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(serverRows(server, 'transactions')).toEqual(afterLoss); // ни новой строки, ни нового номера
  });
});

describe('правка во время отправки', () => {
  it('правка во время отправки не теряется: версия «в пути» не помечается отправленной и уходит следом в том же цикле', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await a.store.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#000000', icon: '🐷' });
    sp.calls.length = 0;
    const gate = sp.holdNextPush();
    const cycle = a.engine.syncNow();
    await gate.entered; // кошелёк уже прочитан и «в пути»
    await a.store.wallets.update(w.id, { name: 'Копилка 2' });
    gate.open();
    await cycle;

    const pushes = sp.pushes('wallets');
    expect(pushes).toHaveLength(2); // сначала версия «в пути», потом новая (первая не очистила строку)
    expect(serverRows(server, 'wallets').find((r) => r['id'] === w.id)?.['name']).toBe('Копилка 2');
    expect(await a.store.db.wallets.get(w.id)).toMatchObject({ name: 'Копилка 2', dirty: 0 });
    expect(a.engine.getStatus().pending).toBe(0);
  });

  it('правка во время получения: сервер вернул старую версию, но локальная правка новее — остаётся и уходит следующим циклом', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await a.store.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#000000', icon: '🐷' });
    let edited = false;
    sp.onPull = async (table, _after, rows) => {
      if (table === 'wallets' && !edited) {
        edited = true;
        await a.store.wallets.update(w.id, { name: 'Копилка 2' }); // правка посреди получения, уже после отправки
      }
      return rows;
    };
    await a.engine.syncNow();
    expect(serverRows(server, 'wallets').find((r) => r['id'] === w.id)?.['name']).toBe('Копилка');
    expect(await a.store.db.wallets.get(w.id)).toMatchObject({ name: 'Копилка 2', dirty: 1 });
    expect(a.engine.getStatus().pending).toBe(1);

    await a.engine.syncNow();
    expect(serverRows(server, 'wallets').find((r) => r['id'] === w.id)?.['name']).toBe('Копилка 2');
    expect(await a.store.db.wallets.get(w.id)).toMatchObject({ name: 'Копилка 2', dirty: 0 });
    expect(a.engine.getStatus().pending).toBe(0);
  });
});

describe('отказы сервера: карантин', () => {
  it('одна отвергнутая строка уходит в карантин, остальные отправляются', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const mk = (name: string) => a.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    const [w1, w2, w3] = [await mk('Один'), await mk('Два'), await mk('Три')];
    await a.store.db.wallets.update(w2.id, { name: '' }); // локальная проверка такое не пустит, сервер отвергнет (CHECK name_len)

    await a.engine.syncNow();
    const ids = serverRows(server, 'wallets').map((r) => r['id']);
    expect(ids).toContain(w1.id);
    expect(ids).toContain(w3.id);
    expect(ids).not.toContain(w2.id);
    const bad = await a.store.db.wallets.get(w2.id);
    expect(bad?.dirty).toBe(1);
    expect(bad?.syncError).toMatch(/^Сервер не принял запись/);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 1 });
    // карантин не блокирует очередь: следующая новая запись уходит
    await mk('Четыре');
    await a.engine.syncNow();
    expect(serverRows(server, 'wallets')).toHaveLength(4);
    expect(a.engine.getStatus().quarantined).toBe(1);
  });

  it('виновник среди 200 строк находится за ~2·log2 N запросов, остальные 199 уходят', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const base = Date.now() - 3_600_000;
    const wallets = Array.from({ length: 200 }, (_, i) =>
      makeWallet({ createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', sortOrder: 100 + i, name: i === 137 ? '' : `Кошелёк ${i}` }),
    );
    await a.store.db.wallets.bulkPut(wallets.map((w) => ({ ...w, dirty: 1 as const, serverSeq: null, syncError: null })));
    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(serverRows(server, 'wallets')).toHaveLength(1 + 199);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 1 });
    const pushes = sp.pushes('wallets');
    expect(pushes.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(200)) + 2);
    expect(pushes.length).toBeGreaterThan(2);
    expect((await a.store.db.wallets.get(wallets[137]!.id))?.syncError).not.toBeNull();
  });

  it('цепочка: отвергнутый кошелёк тянет за собой свои операции в карантин, чужие операции уходят; снятие карантина при запуске даёт второй шанс', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const mk = (name: string) => a.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    const bad = await mk('Плохой');
    const good = await mk('Хороший');
    const txBad1 = await a.store.transactions.create({ kind: 'expense', walletId: bad.id, amountMinor: 100, occurredOn: '2026-10-07' });
    const txBad2 = await a.store.transactions.create({ kind: 'income', walletId: bad.id, amountMinor: 200, occurredOn: '2026-10-07' });
    const txGood = await a.store.transactions.create({ kind: 'expense', walletId: good.id, amountMinor: 300, occurredOn: '2026-10-07' });
    await a.store.db.wallets.update(bad.id, { currency: 'tjs' }); // сервер отвергнет кошелёк: currency_fmt

    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 3 });
    expect(serverRows(server, 'transactions').map((r) => r['id'])).toEqual([txGood.id]);
    for (const t of [txBad1, txBad2]) {
      const row = await a.store.db.transactions.get(t.id);
      expect(row?.syncError).toMatch(/Не отправлена: кошелёк «Плохой» не принят/);
    }
    // операции плохого кошелька даже не пытались отправлять (иначе тратили бы запросы на заведомый отказ)
    const sentTxIds = sp.pushes('transactions').flatMap((c) => c.ids ?? []);
    expect(sentTxIds).toEqual([txGood.id]);

    // «починили» кошелёк (временный отказ): при следующем запуске приложения карантин снимается, и всё уходит
    await a.store.db.wallets.update(bad.id, { currency: 'TJS' });
    a.engine.start();
    await until(() => serverRows(server, 'transactions').length === 3, 'все операции на сервере');
    await until(() => a.engine.getStatus().quarantined === 0 && a.engine.getStatus().pending === 0, 'пустой карантин');
    expect(serverRows(server, 'wallets').map((r) => r['id'])).toContain(bad.id);
  });

  it('карантин при старте снимается ровно один раз за запуск', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const w = await a.store.wallets.create({ name: 'Плохой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    await a.store.db.wallets.update(w.id, { currency: 'tjs' });
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(1);

    let calls = 0;
    const original = a.store.sync.retryQuarantined.bind(a.store.sync);
    a.store.sync.retryQuarantined = async () => {
      calls++;
      return original();
    };
    a.engine.start();
    a.engine.start(); // повторный start ничего не делает
    await until(() => calls === 1 && a.engine.getStatus().phase === 'idle' && a.engine.getStatus().quarantined === 1, 'повторная попытка и новый карантин');
    expect(calls).toBe(1);
  });

  it('сбой «сервера» (5xx) не отправляет данные в карантин: строки остаются в очереди', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    await a.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    server.failNext('server');
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, quarantined: 0 });
    expect(a.engine.getStatus().lastError).toBeTruthy();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
  });

  it('слишком много отказов за цикл: лимит запросов, цикл завершается ошибкой, следующие циклы дорабатывают остаток', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const base = Date.now() - 3_600_000;
    const wallets = Array.from({ length: 320 }, (_, i) =>
      makeWallet({ createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', sortOrder: 100 + i, name: '' }),
    );
    await a.store.db.wallets.bulkPut(wallets.map((w) => ({ ...w, dirty: 1 as const, serverSeq: null, syncError: null })));
    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(a.engine.getStatus().phase).toBe('error');
    expect(sp.pushes().length).toBeLessThanOrEqual(600 + 5);
    for (let i = 0; i < 5 && a.engine.getStatus().pending > 0; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 320, phase: 'idle' });
  });
});

describe('очередь отправки', () => {
  it('пачки не больше 200 строк, внутри пачки нет повторяющихся id', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    const base = Date.now() - 3_600_000;
    const txs = Array.from({ length: 450 }, (_, i) =>
      makeTransaction({ walletId: w.id, createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', amountMinor: 1 + i, baseAmountMinor: 1 + i }),
    );
    await a.store.db.transactions.bulkPut(txs.map((t) => ({ ...t, dirty: 1 as const, serverSeq: null, syncError: null })));
    sp.calls.length = 0;
    await a.engine.syncNow();
    const pushes = sp.pushes('transactions');
    expect(pushes.map((c) => c.size)).toEqual([200, 200, 50]);
    for (const p of pushes) expect(new Set(p.ids).size).toBe(p.size);
    expect(serverRows(server, 'transactions')).toHaveLength(450);
  });

  it('таблицы уходят в порядке зависимостей: настройки, кошельки, категории, операции', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await a.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    const c = await a.store.categories.create({ name: 'Новая', kind: 'expense', color: '#222222', icon: 'c' });
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, categoryId: c.id, amountMinor: 5, occurredOn: '2026-10-07' });
    await a.store.settings.update({ weekStartsOn: 0 });
    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(sp.pushes().map((c2) => c2.table)).toEqual(['settings', 'wallets', 'categories', 'transactions']);
  });

  it('родитель правился во время отправки: операция ждёт его следующего прохода и не попадает в карантин', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await a.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 5, occurredOn: '2026-10-07' });
    const gate = sp.holdNextPush();
    const cycle = a.engine.syncNow();
    await gate.entered; // кошелёк «в пути»
    await a.store.wallets.update(w.id, { name: 'Новый 2' }); // кошелёк снова «грязный», а на сервере его ещё нет
    gate.open();
    await cycle;
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(serverRows(server, 'transactions')).toHaveLength(1);
    expect(serverRows(server, 'wallets').find((r) => r['id'] === w.id)?.['name']).toBe('Новый 2');
  });
});

describe('схлопывание запросов', () => {
  it('пять запросов во время цикла дают один повторный цикл, и все получают ответ', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    server.setLatency(15);
    sp.calls.length = 0;
    const all = Array.from({ length: 5 }, () => a.engine.syncNow());
    await Promise.all(all);
    expect(sp.pulls('settings')).toHaveLength(2); // ровно два цикла: первый и один повторный
  });

  it('запрос, пришедший во время цикла, видит правку, сделанную уже после его начала', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const w = await firstWallet(a);
    const gate = sp.holdNextPush();
    await a.store.wallets.update(w.id, { name: 'до' });
    const first = a.engine.syncNow();
    await gate.entered;
    await a.store.wallets.update(w.id, { name: 'после' });
    const second = a.engine.syncNow(); // придёт во время цикла
    gate.open();
    await Promise.all([first, second]);
    expect(serverRows(server, 'wallets')[0]?.['name']).toBe('после');
    expect(a.engine.getStatus().pending).toBe(0);
  });
});

describe('перезапуск приложения', () => {
  it('очередь, курсы и признак первой загрузки переживают перезапуск: ничего не теряется и не сеется заново', async () => {
    const server = createMemoryServer();
    const factory = new IDBFactory();
    const first = await openDevice(server, 'dev-a', { factory, seed: true });
    await first.engine.syncNow();
    server.setOnline(false);
    await first.store.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#000000', icon: '🐷' });
    await first.engine.syncNow();
    expect(first.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    first.engine.dispose();
    first.store.close(); // приложение закрыли

    server.setOnline(true);
    const seed = vi.fn(async () => undefined);
    let sp!: Spy;
    const second = await openDevice(server, 'dev-a', { factory, wrap: (inner) => (sp = spy(inner)).transport, engine: { afterFirstPull: seed } });
    await until(() => second.engine.getStatus().pending === 1 && second.engine.getStatus().lastSyncedAt !== null, 'состояние после перезапуска');
    await second.engine.syncNow();
    expect(seed).not.toHaveBeenCalled(); // признак первой загрузки сохранился
    expect(second.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(serverRows(server, 'wallets').map((r) => r['name']).sort()).toEqual(['Копилка', 'Наличные']);
    expect(sp.pulls('settings')[0]?.size).toBeGreaterThan(0); // получение пошло с сохранённого курса, а не с нуля
    expect(sp.pushes('wallets')).toHaveLength(1);
  });
});

describe('статус', () => {
  it('getStatus отдаёт один и тот же объект, пока ничего не изменилось; подписчик получает текущий статус сразу', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const s1 = a.engine.getStatus();
    expect(a.engine.getStatus()).toBe(s1);
    const seen: Array<ReturnType<typeof a.engine.getStatus>> = [];
    const off = a.engine.subscribe((s) => seen.push(s));
    expect(seen).toEqual([s1]);
    expect(seen[0]).toBe(s1);
    await a.engine.syncNow();
    const phases = seen.map((s) => s.phase);
    expect(phases).toContain('syncing');
    expect(seen[seen.length - 1]).toBe(a.engine.getStatus());
    // успешный цикл без изменений данных меняет только время; других «пустых» уведомлений нет
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    off();
    const count = seen.length;
    await a.engine.syncNow();
    expect(seen).toHaveLength(count);
  });

  it('время последней синхронизации сохраняется и видно после перезапуска', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const stamp = a.engine.getStatus().lastSyncedAt;
    expect(stamp).not.toBeNull();
    const again = createSyncEngine({ store: a.store, transport: a.transport });
    await until(() => again.getStatus().lastSyncedAt === stamp, 'время из базы');
    expect(again.getStatus().phase).toBe('idle');
    again.dispose();
  });

  it('счётчики «ждут отправки» обновляются сразу после правки (запущенный движок), до отправки', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    server.setOnline(false);
    a.engine.start();
    await until(() => a.engine.getStatus().phase === 'offline', 'offline');
    await a.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    await until(() => a.engine.getStatus().pending === 1, 'pending = 1');
  });
});
