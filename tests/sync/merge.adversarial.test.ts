// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction, Wallet } from '@/domain/types';
import { compareVersion } from '@/db/validate';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { fromWire, toWire } from '@/sync/tables';
import type { SyncTransport } from '@/sync/transport';
import { makeUserId } from './factories';
import { openDevice, snapshotOf, spy, type Device, type Spy } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt } from './postgrestEmulator';

/**
 * Состязательные проверки слияния правок двух устройств и проверки версии на сервере (M5).
 *
 * Риск, который здесь закрыт: между тем, как устройство в последний раз получило строку, и тем, как оно её отправило, другое
 * устройство успело отправить правку ТОЙ ЖЕ записи. Раньше решала только метка: если метка нашей отправки меньше серверной, наша
 * правка молча пропадала; если больше (часы убежали дальше окна «сейчас + 5 минут») — сервер принимал нашу строку ЦЕЛИКОМ и затирал
 * чужую правку другой группы полей. Теперь отправка несёт «ожидаемую» версию (base_seq), сервер отвергает пачку, если версия ушла
 * вперёд, а устройство забирает свежее и сливает по группам полей (db/syncMerge.ts): правки РАЗНЫХ групп складываются при любых часах,
 * правки одной группы решает большая метка. Те же сценарии идут на двух стендах: сервер в памяти и НАСТОЯЩАЯ схема (PGlite)
 * через supabase-js — со всеми триггерами, ограничениями и проверкой версии в SQL.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

let pg: PgliteServer;
beforeAll(async () => {
  pg = await createPgliteServer();
}, 120_000);
afterAll(async () => {
  await pg.close();
});

type Table = 'settings' | 'wallets' | 'categories' | 'transactions';

interface Stack {
  label: string;
  /** Устройство пользователя; skewMs — на сколько его часы убежали вперёд (отрицательное — отстают). */
  open(userId: string, deviceId: string, skewMs: number, wrap?: (inner: SyncTransport) => SyncTransport): Promise<Device>;
  /** Строки таблицы на сервере (в проводном виде). */
  onServer(userId: string, table: Table): Promise<Array<Record<string, unknown>>>;
  /** Транспорт без обёрток, от имени пользователя (для «контрольных» отправок в обход движка). */
  raw(userId: string): SyncTransport;
}

function memoryStack(): Stack {
  const server: MemoryServer = createMemoryServer();
  return {
    label: 'сервер в памяти',
    open: (userId, deviceId, skewMs, wrap) =>
      openDevice(server, deviceId, { userId, seed: true, now: () => Date.now() + skewMs, wrap }),
    onServer: async (userId, table) => server.dump(userId, table),
    raw: (userId) => server.transportFor(userId),
  };
}

function postgresStack(): Stack {
  const emulator = createPostgrestEmulator(pg);
  const anon = makeJwt({ role: 'anon' });
  const transportOf = (userId: string): SyncTransport => {
    const token = makeJwt({ sub: userId });
    const client = createClient(emulator.url, anon, {
      global: { fetch: emulator.fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => token,
    });
    return createSupabaseTransport(client);
  };
  return {
    label: 'настоящая схема (PGlite) через supabase-js',
    open: (userId, deviceId, skewMs, wrap) => {
      const inner = transportOf(userId);
      return openDevice(null, deviceId, { userId, seed: true, now: () => Date.now() + skewMs, transport: wrap ? wrap(inner) : inner });
    },
    onServer: async (userId, table) => (await pg.adminRows(table)).filter((r) => r['user_id'] === userId),
    raw: transportOf,
  };
}

const stacks = [
  { label: 'сервер в памяти', make: memoryStack },
  { label: 'настоящая схема (PGlite) через supabase-js', make: postgresStack },
] as const;

interface Pair {
  stack: Stack;
  userId: string;
  a: Device;
  b: Device;
  txId: string;
  walletId: string;
}

/** Два устройства одного пользователя с общей синхронизированной операцией (расход 100,00 «обед» от 2026-10-05). */
async function pair(
  stack: Stack,
  skewA: number,
  skewB: number,
  wrapA?: (inner: SyncTransport) => SyncTransport,
): Promise<Pair> {
  const userId = makeUserId();
  const a = await stack.open(userId, 'dev-a', skewA, wrapA);
  const b = await stack.open(userId, 'dev-b', skewB);
  await a.engine.syncNow(); // первое устройство кладёт на сервер затравку
  await b.engine.syncNow(); // второе её получает
  const wallet = (await a.store.db.wallets.toArray()).find((w) => w.deletedAt === null) as Wallet;
  const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'обед' });
  await a.engine.syncNow();
  await b.engine.syncNow();
  expect(await b.store.db.transactions.get(tx.id)).toMatchObject({ note: 'обед', amountMinor: 10_000, dirty: 0 });
  return { stack, userId, a, b, txId: tx.id, walletId: wallet.id };
}

const txOf = async (d: Device, id: string): Promise<Transaction> => {
  const row = await d.store.db.transactions.get(id);
  if (!row) throw new Error('операции нет');
  return row;
};
const view = (t: Transaction) => ({ note: t.note, occurredOn: t.occurredOn, amountMinor: t.amountMinor, deleted: t.deletedAt !== null });

async function serverTx(p: Pair): Promise<Transaction> {
  const rows = await p.stack.onServer(p.userId, 'transactions');
  const row = rows.find((r) => r['id'] === p.txId);
  if (!row) throw new Error('операции нет на сервере');
  return fromWire('transactions', row).entity as Transaction;
}

/**
 * Два устройства правят, не видя друг друга. Возвращает, чья правка новее по (метке, устройству) — именно это решает общую группу.
 * Расхождение часов само по себе победителя не определяет: устройство с отстающими часами, увидев чужие метки, «подтягивается»
 * к ним (часы монотонны), поэтому кто новее, смотрим по меткам, которые правки реально получили.
 */
async function editBoth(
  p: Pair,
  editA: Parameters<Device['store']['transactions']['update']>[1],
  editB: Parameters<Device['store']['transactions']['update']>[1],
): Promise<{ newer: 'A' | 'B'; cmp: number }> {
  await p.a.store.transactions.update(p.txId, editA);
  await p.b.store.transactions.update(p.txId, editB);
  const cmp = compareVersion(await txOf(p.a, p.txId), await txOf(p.b, p.txId));
  return { newer: cmp > 0 ? 'A' : 'B', cmp };
}

/** Все синхронизируются по кругу до покоя; затем: очередь пуста, ошибок нет, устройства и сервер совпадают. */
async function settleAll(p: Pair): Promise<Transaction> {
  for (let round = 0; round < 3; round++) {
    await p.a.engine.syncNow();
    await p.b.engine.syncNow();
  }
  for (const d of [p.a, p.b]) {
    expect(d.engine.getStatus(), `${d.deviceId}: статус`).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
  }
  expect(await snapshotOf(p.b.store)).toEqual(await snapshotOf(p.a.store));
  const onServer = await serverTx(p);
  expect(onServer).toEqual((await snapshotOf(p.a.store)).transactions.find((t) => t.id === p.txId));
  return onServer;
}

describe.each(stacks)('слияние двух устройств: $label', ({ make }) => {
  /** Расхождение часов шире окна сервера «сейчас + 5 минут» в обе стороны и без расхождения. */
  const SKEWS = [
    { name: 'часы A на час вперёд (метка A БОЛЬШЕ серверной, шире окна 5 минут)', a: HOUR, b: 0, aNewer: true },
    { name: 'часы A на час назад (метка A МЕНЬШЕ серверной)', a: -HOUR, b: 0, aNewer: false },
    { name: 'часы A на 10 минут вперёд, часы B на 10 минут назад', a: 10 * MIN, b: -10 * MIN, aNewer: true },
    { name: 'часы идут одинаково', a: 0, b: 0, aNewer: null },
  ] as const;

  describe.each(SKEWS)('$name', ({ a: skewA, b: skewB, aNewer }) => {
    /** Сценарий действительно тот, что назван: чья метка больше, определено расхождением часов (кроме случая одинаковых часов). */
    const expectOrder = (cmp: number): void => {
      if (aNewer === true) expect(cmp, 'метка правки A больше метки правки B').toBeGreaterThan(0);
      if (aNewer === false) expect(cmp, 'метка правки A меньше метки правки B').toBeLessThan(0);
    };
    // обе очерёдности: кто первым успел отправить, тот и «опередил»
    const ORDERS = [
      { name: 'первым отправляет B', first: 'b' as const },
      { name: 'первым отправляет A', first: 'a' as const },
    ];

    it.each(ORDERS)('правки РАЗНЫХ групп (A — заметка, B — сумма) складываются, $name', async ({ first }) => {
      const p = await pair(make(), skewA, skewB);
      expectOrder((await editBoth(p, { note: 'заметка с A' }, { amountMinor: 25_000 })).cmp);
      const [one, two] = first === 'b' ? [p.b, p.a] : [p.a, p.b];
      await one.engine.syncNow();
      await two.engine.syncNow();
      const merged = await settleAll(p);
      expect(view(merged)).toEqual({ note: 'заметка с A', occurredOn: '2026-10-05', amountMinor: 25_000, deleted: false });
    });

    it.each(ORDERS)('три группы у двоих: каждый своё, дата — общая и решается меткой, $name', async ({ first }) => {
      const p = await pair(make(), skewA, skewB);
      const { newer, cmp } = await editBoth(p, { note: 'A', occurredOn: '2026-10-07' }, { amountMinor: 33_300, occurredOn: '2026-10-09' });
      expectOrder(cmp);
      const [one, two] = first === 'b' ? [p.b, p.a] : [p.a, p.b];
      await one.engine.syncNow();
      await two.engine.syncNow();
      const merged = await settleAll(p);
      // дату правили оба: побеждает большая метка (только здесь она что-то решает); остальное — у того, кто это менял
      expect(view(merged)).toEqual({ note: 'A', occurredOn: newer === 'A' ? '2026-10-07' : '2026-10-09', amountMinor: 33_300, deleted: false });
    });

    it.each(ORDERS)('правка ОДНОЙ группы двумя устройствами: побеждает большая метка, одна для всех, $name', async ({ first }) => {
      const p = await pair(make(), skewA, skewB);
      const { newer, cmp } = await editBoth(p, { amountMinor: 11_000 }, { amountMinor: 25_000 });
      expectOrder(cmp);
      const [one, two] = first === 'b' ? [p.b, p.a] : [p.a, p.b];
      await one.engine.syncNow();
      await two.engine.syncNow();
      const merged = await settleAll(p);
      expect(merged.amountMinor).toBe(newer === 'A' ? 11_000 : 25_000);
    });

    it.each(ORDERS)('удаление на одном устройстве и правка заметки на другом: запись удалена, заметка сохранена, $name', async ({ first }) => {
      const p = await pair(make(), skewA, skewB);
      await p.a.store.transactions.softDelete(p.txId);
      await p.b.store.transactions.update(p.txId, { note: 'правка без знания об удалении' });
      const [one, two] = first === 'b' ? [p.b, p.a] : [p.a, p.b];
      await one.engine.syncNow();
      await two.engine.syncNow();
      const merged = await settleAll(p);
      expect(view(merged)).toEqual({ note: 'правка без знания об удалении', occurredOn: '2026-10-05', amountMinor: 10_000, deleted: true });
    });

    it.each(ORDERS)('кошелёк: переименование с одного устройства и смена цвета с другого, $name', async ({ first }) => {
      const p = await pair(make(), skewA, skewB);
      await p.a.store.wallets.update(p.walletId, { name: 'Новое имя' });
      await p.b.store.wallets.update(p.walletId, { color: '#123456' });
      const [one, two] = first === 'b' ? [p.b, p.a] : [p.a, p.b];
      await one.engine.syncNow();
      await two.engine.syncNow();
      for (let i = 0; i < 2; i++) {
        await p.a.engine.syncNow();
        await p.b.engine.syncNow();
      }
      for (const d of [p.a, p.b]) {
        expect(await d.store.db.wallets.get(p.walletId), d.deviceId).toMatchObject({ name: 'Новое имя', color: '#123456', dirty: 0 });
      }
      const onServer = (await p.stack.onServer(p.userId, 'wallets')).find((r) => r['id'] === p.walletId);
      expect(onServer).toMatchObject({ name: 'Новое имя', color: '#123456' });
    });
  });

  it('ГЛАВНЫЙ СЛУЧАЙ: метка нашей отправки больше серверной (часы на час вперёд) — чужая правка другой группы НЕ затирается', async () => {
    let sp!: Spy;
    const p = await pair(make(), HOUR, 0, (inner) => {
      sp = spy(inner);
      return sp.transport;
    });
    const { newer } = await editBoth(p, { note: 'правка с убежавших часов' }, { amountMinor: 77_700 });
    expect(newer, 'метка правки A больше метки правки B — это и есть опасный случай').toBe('A');
    await p.b.engine.syncNow(); // B успел раньше: на сервере сумма 777,00
    expect((await serverTx(p)).amountMinor).toBe(77_700);
    sp.calls.length = 0;
    await p.a.engine.syncNow(); // отправка A: версия ушла вперёд → отказ → получение → слияние → повторная отправка
    expect(sp.pushes('transactions'), 'первая отправка отвергнута, вторая (после слияния) принята').toHaveLength(2);
    expect(sp.pulls('transactions').length).toBeGreaterThanOrEqual(1);
    const merged = await settleAll(p);
    expect(view(merged)).toEqual({ note: 'правка с убежавших часов', occurredOn: '2026-10-05', amountMinor: 77_700, deleted: false });
  });

  it('контроль: без проверки версии (старый клиент) сервер принимает строку целиком и затирает чужую правку — вот от чего защищает base_seq', async () => {
    const p = await pair(make(), 0, 0);
    await p.b.store.transactions.update(p.txId, { amountMinor: 77_700 });
    await p.b.engine.syncNow();
    // старый клиент: строка со старой суммой и новой заметкой, часы убежали на час (сервер зажмёт метку до «сейчас + 5 минут» — это
    // всё равно новее метки B), колонки base_seq нет
    const stale = { ...(await txOf(p.a, p.txId)), note: 'старый клиент', clientUpdatedAt: new Date(Date.now() + HOUR).toISOString(), deviceId: 'dev-old' };
    await p.stack.raw(p.userId).push('transactions', [toWire('transactions', stale)]);
    const onServer = await serverTx(p);
    expect(onServer).toMatchObject({ note: 'старый клиент', amountMinor: 10_000 }); // сумма B пропала
    // а с base_seq — тот же случай отвергается
    const sent = await p.stack.raw(p.userId).push('transactions', [toWire('transactions', { ...stale, note: 'новый клиент', deviceId: 'dev-new', clientUpdatedAt: new Date(Date.now() + HOUR + 1).toISOString() }, 1)]).then(
      () => 'принято',
      (e: unknown) => (e as { kind?: string }).kind,
    );
    expect(sent).toBe('conflict');
  });

  it('ответ потерялся, хотя сервер правку принял: повтор не считается конфликтом, не двигает server_seq и ничего не теряет', async () => {
    let sp!: Spy;
    const p = await pair(make(), 0, 0, (inner) => {
      sp = spy(inner);
      return sp.transport;
    });
    await p.a.store.transactions.update(p.txId, { note: 'правка A' });
    sp.loseResponses = 1;
    await p.a.engine.syncNow(); // сервер принял, ответ потерялся
    expect(p.a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    const seqAfterApply = (await p.stack.onServer(p.userId, 'transactions')).find((r) => r['id'] === p.txId)?.['server_seq'];
    sp.calls.length = 0;
    await p.a.engine.syncNow(); // та же правка с прежней (теперь устаревшей) версией: точный повтор
    expect(p.a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect((await p.stack.onServer(p.userId, 'transactions')).find((r) => r['id'] === p.txId)?.['server_seq']).toBe(seqAfterApply);
    expect(sp.pushes('transactions')).toHaveLength(1); // без отказа и повторов
    const merged = await settleAll(p);
    expect(merged.note).toBe('правка A');
  });

  it('чужое устройство пишет ту же запись при каждой нашей отправке: цикл останавливается с понятной ошибкой, следующий — доходит', async () => {
    let writes = 0;
    let sp!: Spy;
    const p = await pair(make(), 0, 0, (inner) => {
      sp = spy(inner);
      return sp.transport;
    });
    sp.onPush = async (table) => {
      if (table !== 'transactions' || writes >= 8) return;
      writes++;
      await p.b.store.transactions.update(p.txId, { note: `B-${writes}` });
      await p.b.engine.syncNow(); // B успевает раньше каждой отправки A
    };
    await p.a.store.transactions.update(p.txId, { occurredOn: '2026-10-20' });
    await p.a.engine.syncNow();
    expect(p.a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1 });
    expect(p.a.engine.getStatus().lastError).toMatch(/меняются на другом устройстве/);
    // ничего не потеряно и не перезаписано: сумма и дата A ещё ждут отправки
    expect((await txOf(p.a, p.txId)).occurredOn).toBe('2026-10-20');

    await p.a.engine.syncNow(); // помехи кончились
    const merged = await settleAll(p);
    expect(merged.occurredOn).toBe('2026-10-20'); // дата A (B её не трогал)
    expect(merged.note).toMatch(/^B-\d$/); // заметка B
  });

  it('операция создана на A, уточнена на B, сумма исправлена на A (часы A на час вперёд): обе правки сохраняются', async () => {
    const stack = make();
    const userId = makeUserId();
    const a = await stack.open(userId, 'dev-a', HOUR);
    const b = await stack.open(userId, 'dev-b', 0);
    await a.engine.syncNow();
    await b.engine.syncNow();
    const wallet = (await a.store.db.wallets.toArray())[0] as Wallet;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 500, occurredOn: '2026-10-06', note: 'создано на A' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await b.store.transactions.update(tx.id, { note: 'уточнено на B' });
    await a.store.transactions.update(tx.id, { amountMinor: 900 });
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();
    for (const d of [a, b]) expect(await d.store.db.transactions.get(tx.id), d.deviceId).toMatchObject({ note: 'уточнено на B', amountMinor: 900, dirty: 0 });
  });
});

describe('слияние двух устройств: случайные правки групп, часы и порядок синхронизаций (сервер в памяти)', () => {
  const GROUPS = ['note', 'date', 'amount'] as const;
  type Group = (typeof GROUPS)[number];
  const A_VALUES = { note: 'заметка A', date: '2026-10-07', amount: 11_100 } as const;
  const B_VALUES = { note: 'заметка B', date: '2026-10-09', amount: 22_200 } as const;
  const patch = (groups: readonly Group[], v: typeof A_VALUES | typeof B_VALUES) => ({
    ...(groups.includes('note') ? { note: v.note } : {}),
    ...(groups.includes('date') ? { occurredOn: v.date } : {}),
    ...(groups.includes('amount') ? { amountMinor: v.amount } : {}),
  });
  const subset = fc.subarray([...GROUPS], { minLength: 1 });
  // расхождения часов шире окна сервера «сейчас + 5 минут» и без расхождения; кто новее при общей группе — по меткам, которые получили правки
  const skewPair = fc.constantFrom(
    [HOUR, 0],
    [0, HOUR],
    [-HOUR, 0],
    [0, -HOUR],
    [HOUR, -HOUR],
    [-HOUR, HOUR],
  ) as fc.Arbitrary<[number, number]>;
  const schedule = fc.array(fc.constantFrom('a', 'b'), { minLength: 1, maxLength: 4 });

  it('итог не зависит от порядка: каждая группа — у того, кто её менял; при общей группе — у того, чья метка больше', async () => {
    await fc.assert(
      fc.asyncProperty(subset, subset, skewPair, schedule, async (groupsA, groupsB, [skewA, skewB], order) => {
        const p = await pair(memoryStack(), skewA, skewB);
        try {
          const { newer } = await editBoth(p, patch(groupsA, A_VALUES), patch(groupsB, B_VALUES));
          for (const who of order) await (who === 'a' ? p.a : p.b).engine.syncNow();
          const merged = await settleAll(p);
          const expected = { note: 'обед', occurredOn: '2026-10-05', amountMinor: 10_000, deleted: false };
          for (const g of GROUPS) {
            const byA = groupsA.includes(g);
            const byB = groupsB.includes(g);
            const owner = byA && byB ? newer : byA ? 'A' : 'B';
            if (!byA && !byB) continue;
            const values = owner === 'A' ? A_VALUES : B_VALUES;
            if (g === 'note') expected.note = values.note;
            if (g === 'date') expected.occurredOn = values.date;
            if (g === 'amount') expected.amountMinor = values.amount;
          }
          expect(view(merged)).toEqual(expected);
        } finally {
          for (const d of [p.a, p.b]) {
            d.engine.dispose();
            d.store.close();
          }
        }
      }),
      { numRuns: Number(process.env['MERGE_RUNS'] ?? 40), endOnFailure: true },
    );
  }, 300_000);
});
