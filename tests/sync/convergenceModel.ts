import fc from 'fast-check';
import { expect } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { ValidationError, type Store } from '@/db';
import { MERGE_GROUPS } from '@/db/mergeGroups';
import type { Entity } from '@/domain/types';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, fromWire, type SyncTableName } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { USER, openDevice, snapshotOf, type Device } from './engineHarness';

/**
 * Общая модель тестов сходимости: 2–3 устройства одного пользователя + сервер в памяти, случайные правки РАЗНЫХ частей
 * записей (сумма, заметка, дата, имя, цвет, архив, удаление, неделя…), офлайн/онлайн, порядок синхронизаций, затем «тихий» этап.
 *
 * ИНВАРИАНТЫ (checkInvariants):
 *  1. данные на всех устройствах и на сервере совпадают, очередь пуста, карантина нет;
 *  2. ни одна созданная запись не потеряна (и нет лишних);
 *  3. для каждой (запись, группа полей), изменённой за фазу ТОЛЬКО одним устройством, итог = его значение;
 *     для групп с конкурирующими правками итог = значение ОДНОГО из участников (группа целиком, не смесь полей);
 *  4. остатки кошельков на всех устройствах одинаковы и равны посчитанным по данным сервера;
 *  5. метки не растут бесконечно: число кругов до покоя ограничено, после покоя лишние круги ничего не меняют.
 */

type Row = Record<string, unknown>;

export type Op =
  | { t: 'wallet-create'; d: number; opening: number }
  | { t: 'wallet-rename'; d: number; i: number }
  | { t: 'wallet-color'; d: number; i: number; n: number }
  | { t: 'wallet-opening'; d: number; i: number; amount: number }
  | { t: 'wallet-archive'; d: number; i: number; restore: boolean }
  | { t: 'category-rename'; d: number; i: number }
  | { t: 'category-color'; d: number; i: number; n: number }
  | { t: 'settings'; d: number }
  | { t: 'settings-default'; d: number; i: number; clear: boolean }
  | { t: 'tx-create'; d: number; kind: 'expense' | 'income' | 'transfer'; w: number; to: number; amount: number; cat: number }
  | { t: 'tx-update'; d: number; i: number; amount: number }
  | { t: 'tx-note'; d: number; i: number; n: number }
  | { t: 'tx-date'; d: number; i: number; day: number }
  | { t: 'tx-delete'; d: number; i: number; restore: boolean }
  | { t: 'offline'; d: number }
  | { t: 'online'; d: number }
  | { t: 'sync'; d: number }
  | { t: 'tick'; ms: number };

const dev = (n: number) => fc.integer({ min: 0, max: n - 1 });
const idx = fc.integer({ min: 0, max: 50 });
const small = fc.integer({ min: 0, max: 9 });

export const opsArb = (n: number, min: number, max: number): fc.Arbitrary<Op[]> =>
  fc.array(
    fc.oneof(
      { weight: 2, arbitrary: fc.record({ t: fc.constant('wallet-create' as const), d: dev(n), opening: fc.integer({ min: 0, max: 100_000 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('wallet-rename' as const), d: dev(n), i: idx }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('wallet-color' as const), d: dev(n), i: idx, n: small }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('wallet-opening' as const), d: dev(n), i: idx, amount: fc.integer({ min: 0, max: 100_000 }) }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('wallet-archive' as const), d: dev(n), i: idx, restore: fc.boolean() }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('category-rename' as const), d: dev(n), i: idx }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('category-color' as const), d: dev(n), i: idx, n: small }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('settings' as const), d: dev(n) }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('settings-default' as const), d: dev(n), i: idx, clear: fc.boolean() }) },
      {
        weight: 6,
        arbitrary: fc.record({
          t: fc.constant('tx-create' as const),
          d: dev(n),
          kind: fc.constantFrom('expense' as const, 'income' as const, 'transfer' as const),
          w: idx,
          to: idx,
          amount: fc.integer({ min: 1, max: 1_000_000 }),
          cat: fc.integer({ min: -1, max: 30 }),
        }),
      },
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-update' as const), d: dev(n), i: idx, amount: fc.integer({ min: 1, max: 1_000_000 }) }) },
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-note' as const), d: dev(n), i: idx, n: small }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-date' as const), d: dev(n), i: idx, day: fc.integer({ min: 1, max: 27 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-delete' as const), d: dev(n), i: idx, restore: fc.boolean() }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('offline' as const), d: dev(n) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('online' as const), d: dev(n) }) },
      { weight: 9, arbitrary: fc.record({ t: fc.constant('sync' as const), d: dev(n) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 3_000 }) }) },
    ),
    { minLength: min, maxLength: max, size: 'max' }, // 'max': серии нужной длины, а не по две-три правки
  );

/** Что менялось за фазу: ключ «таблица/id/группа» → устройство → значение группы после его ПОСЛЕДНЕЙ правки. */
type PhaseEdits = Map<string, Map<number, string>>;

export interface World {
  server: MemoryServer;
  devices: Device[];
  offline: boolean[];
  time: { t: number };
  names: { n: number };
  /** Все когда-либо созданные записи («таблица/id»). */
  created: Set<string>;
  phase: PhaseEdits;
}

export async function makeWorld(n: number, skews: number[], base = Date.now()): Promise<World> {
  const time = { t: base };
  const server = createMemoryServer({ now: () => time.t });
  const offline = Array.from({ length: n }, () => false);
  const devices: Device[] = [];
  for (let d = 0; d < n; d++) {
    devices.push(
      await openDevice(server, `dev-${d}`, {
        seed: true,
        now: () => time.t + (skews[d] ?? 0),
        wrap: (inner) => ({
          pull: async (table, after, limit) => {
            if (offline[d]) throw new TransportError('network', 'офлайн');
            return inner.pull(table, after, limit);
          },
          push: async (table, rows) => {
            if (offline[d]) throw new TransportError('network', 'офлайн');
            return inner.push(table, rows);
          },
        }),
      }),
    );
  }
  return { server, devices, offline, time, names: { n: 0 }, created: new Set(), phase: new Map() };
}

export function disposeWorld(w: World): void {
  for (const d of w.devices) {
    d.engine.dispose();
    d.store.close();
  }
}

/** Значения всех групп всех строк устройства: «таблица/id/группа» → JSON значений полей группы. */
async function groupValues(store: Store): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const table of SYNC_TABLES) {
    for (const row of (await store.db.syncTable(table).toArray()) as unknown as Row[]) {
      for (const [g, fields] of Object.entries(MERGE_GROUPS[table])) {
        out.set(`${table}/${row['id']}/${g}`, JSON.stringify(fields.map((f) => row[f] ?? null)));
      }
    }
  }
  return out;
}

const pick = <T>(list: T[], i: number): T | undefined => (list.length === 0 ? undefined : list[i % list.length]);
const byIdAsc = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : 1);
const EDIT_OPS = new Set<Op['t']>(['offline', 'online', 'sync', 'tick']);

/**
 * Применяет одну операцию. Правки, которые локальные проверки не пускают (архивный кошелёк и т. п.), — пропуск.
 * Для правок запоминается, какие группы каких записей изменило устройство (для проверки итогов).
 */
export async function apply(w: World, op: Op): Promise<void> {
  if (op.t === 'tick') {
    w.time.t += op.ms;
    return;
  }
  const d = w.devices[op.d] as Device;
  const s: Store = d.store;
  const tracks = !EDIT_OPS.has(op.t);
  const before = tracks ? await groupValues(s) : null;
  try {
    const wallets = (await s.db.wallets.toArray()).filter((x) => x.deletedAt === null).sort(byIdAsc);
    const usable = wallets.filter((x) => x.archivedAt === null);
    const txs = (await s.db.transactions.toArray()).sort(byIdAsc);
    const cats = () => s.db.categories.toArray().then((l) => l.filter((x) => x.deletedAt === null).sort(byIdAsc));
    switch (op.t) {
      case 'offline':
        w.offline[op.d] = true;
        return;
      case 'online':
        w.offline[op.d] = false;
        return;
      case 'sync':
        await d.engine.syncNow();
        return;
      case 'wallet-create': {
        const x = await s.wallets.create({ name: `W${++w.names.n}`, currency: 'TJS', kind: 'cash', openingBalanceMinor: op.opening, color: '#111111', icon: 'w' });
        w.created.add(`wallets/${x.id}`);
        return;
      }
      case 'wallet-rename': {
        const x = pick(wallets, op.i);
        if (x) await s.wallets.update(x.id, { name: `W${++w.names.n}` });
        return;
      }
      case 'wallet-color': {
        const x = pick(wallets, op.i);
        if (x) await s.wallets.update(x.id, { color: `#00000${op.n}` });
        return;
      }
      case 'wallet-opening': {
        const x = pick(wallets, op.i);
        if (x) await s.wallets.update(x.id, { openingBalanceMinor: op.amount });
        return;
      }
      case 'wallet-archive': {
        const x = pick(wallets, op.i);
        if (x) await (op.restore ? s.wallets.restore(x.id) : s.wallets.archive(x.id));
        return;
      }
      case 'category-rename': {
        const x = pick(await cats(), op.i);
        if (x) await s.categories.update(x.id, { name: `C${++w.names.n}` });
        return;
      }
      case 'category-color': {
        const x = pick(await cats(), op.i);
        if (x) await s.categories.update(x.id, { color: `#00000${op.n}` });
        return;
      }
      case 'settings': {
        const cur = await s.settings.get();
        if (cur) await s.settings.update({ weekStartsOn: cur.weekStartsOn === 1 ? 0 : 1 });
        return;
      }
      case 'settings-default': {
        const x = op.clear ? undefined : pick(usable, op.i);
        await s.settings.update({ defaultWalletId: x?.id ?? null });
        return;
      }
      case 'tx-create': {
        const from = pick(usable, op.w);
        if (!from) return;
        const own = (await cats()).filter((x) => x.archivedAt === null && x.kind === op.kind);
        const cat = op.kind === 'transfer' || op.cat < 0 ? undefined : pick(own, op.cat);
        const target = op.kind === 'transfer' ? pick(usable.filter((x) => x.id !== from.id), op.to) : undefined;
        if (op.kind === 'transfer' && !target) return;
        const x = await s.transactions.create({
          kind: op.kind,
          walletId: from.id,
          toWalletId: target?.id ?? null,
          amountMinor: op.amount,
          categoryId: cat?.id ?? null,
          occurredOn: '2026-10-05',
        });
        w.created.add(`transactions/${x.id}`);
        return;
      }
      case 'tx-update': {
        const x = pick(txs, op.i);
        if (x) await s.transactions.update(x.id, { amountMinor: op.amount });
        return;
      }
      case 'tx-note': {
        const x = pick(txs, op.i);
        if (x) await s.transactions.update(x.id, { note: `заметка-${op.n}-${++w.names.n}` });
        return;
      }
      case 'tx-date': {
        const x = pick(txs, op.i);
        if (x) await s.transactions.update(x.id, { occurredOn: `2026-10-${String(op.day).padStart(2, '0')}` });
        return;
      }
      case 'tx-delete': {
        const x = pick(txs, op.i);
        if (x) await (op.restore ? s.transactions.restore(x.id) : s.transactions.softDelete(x.id));
        return;
      }
    }
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e; // локальные правила не пустили — как будто человек этого не делал
  } finally {
    if (before) {
      const after = await groupValues(s);
      for (const [key, value] of after) {
        if (before.get(key) === value) continue;
        const byDevice = w.phase.get(key) ?? new Map<number, string>();
        byDevice.set(op.d, value);
        w.phase.set(key, byDevice);
      }
    }
  }
}

/** Начало: каждое устройство хотя бы раз синхронизировано (настройки и затравка на месте). */
export async function bootstrap(w: World): Promise<void> {
  for (const d of w.devices) await d.engine.syncNow();
  for (const d of w.devices) await d.engine.syncNow();
  const first = w.devices[0] as Device;
  for (const table of SYNC_TABLES) for (const row of await first.store.db.syncTable(table).toArray()) w.created.add(`${table}/${row.id}`);
  w.phase = new Map();
}

/** Всё состояние мира (сырые строки всех устройств, со служебными полями и метками, и сервер) одной строкой. */
async function stateKey(w: World): Promise<string> {
  const parts: unknown[] = [];
  for (const d of w.devices) {
    for (const t of SYNC_TABLES) parts.push((await d.store.db.syncTable(t).toArray()).sort(byIdAsc));
  }
  for (const t of SYNC_TABLES) parts.push(w.server.dump(USER, t));
  return JSON.stringify(parts);
}

/**
 * Тихий этап: все в сети, круги синхронизации по очереди, пока состояние (включая метки) не перестанет меняться.
 * Возвращает, сколько кругов что-то меняли. Если не успокоилось за maxRounds — ошибка (метки росли бы бесконечно).
 */
export async function quiesce(w: World, maxRounds = 10): Promise<number> {
  w.offline.fill(false);
  let prev = await stateKey(w);
  for (let round = 1; round <= maxRounds; round++) {
    for (const d of w.devices) await d.engine.syncNow();
    const cur = await stateKey(w);
    if (cur === prev) {
      // ещё два круга: покой не случайный, лишние синхронизации ничего не меняют (метки и серверные номера стоят)
      for (let extra = 0; extra < 2; extra++) for (const d of w.devices) await d.engine.syncNow();
      expect(await stateKey(w), 'после покоя лишние круги синхронизации изменили состояние (метки растут?)').toBe(cur);
      return round - 1;
    }
    prev = cur;
  }
  throw new Error(`не успокоилось за ${maxRounds} кругов: метки растут бесконечно`);
}

const byId = <T extends { id: string }>(list: T[]): T[] => [...list].sort(byIdAsc);

/** Значения групп записи на сервере: «таблица/id/группа» → JSON. */
function serverGroups(w: World): Map<string, string> {
  const out = new Map<string, string>();
  for (const table of SYNC_TABLES) {
    for (const wire of w.server.dump(USER, table)) {
      const e = fromWire(table, wire).entity as unknown as Row;
      for (const [g, fields] of Object.entries(MERGE_GROUPS[table])) out.set(`${table}/${e['id']}/${g}`, JSON.stringify(fields.map((f) => e[f] ?? null)));
    }
  }
  return out;
}

export interface MergeStats {
  /** Группы с единственным редактором за фазу. */
  single: number;
  /** Группы с конкурирующими правками. */
  contested: number;
}

/** Все инварианты на покое (см. шапку файла). Возвращает, сколько групп проверено. */
export async function checkInvariants(w: World): Promise<MergeStats> {
  // 1. очередь пуста, карантина нет
  for (const d of w.devices) {
    expect(d.engine.getStatus(), `${d.deviceId}: статус`).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
  }
  // 1. все устройства и сервер совпадают
  const snaps = await Promise.all(w.devices.map((d) => snapshotOf(d.store)));
  const first = snaps[0]!;
  const norm = (s: typeof first) => ({ settings: s.settings, wallets: byId(s.wallets), categories: byId(s.categories), transactions: byId(s.transactions) });
  for (const [i, s] of snaps.entries()) expect(norm(s), `устройство ${i} против устройства 0`).toEqual(norm(first));
  const onServer = Object.fromEntries(SYNC_TABLES.map((t) => [t, byId(w.server.dump(USER, t).map((r) => fromWire(t, r).entity))])) as unknown as Record<SyncTableName, Entity[]>;
  expect(onServer.settings).toEqual(first.settings ? [first.settings] : []);
  expect(onServer.wallets).toEqual(norm(first).wallets);
  expect(onServer.categories).toEqual(norm(first).categories);
  expect(onServer.transactions).toEqual(norm(first).transactions);

  // у чистых строк нет следов слияния
  for (const d of w.devices) {
    for (const t of SYNC_TABLES) {
      for (const r of await d.store.db.syncTable(t).toArray()) {
        expect(r.dirty, `${d.deviceId}: ${t}/${r.id} грязная после покоя`).toBe(0);
        expect('dirtyGroups' in r, `${d.deviceId}: ${t}/${r.id} хранит dirtyGroups у чистой строки`).toBe(false);
      }
    }
  }

  // 2. ничего не потеряно и не лишнее
  const ids = new Set(SYNC_TABLES.flatMap((t) => onServer[t].map((e) => `${t}/${e.id}`)));
  for (const key of w.created) expect(ids.has(key), `запись потеряна: ${key}`).toBe(true);
  expect(ids.size, 'на сервере появились записи, которых никто не создавал').toBe(w.created.size);

  // 3. итоги по группам
  const final = serverGroups(w);
  const stats: MergeStats = { single: 0, contested: 0 };
  for (const [key, byDevice] of w.phase) {
    const got = final.get(key);
    const values = [...byDevice.values()];
    if (byDevice.size === 1) {
      stats.single++;
      expect(got, `группа ${key} правилась одним устройством (${[...byDevice.keys()]}), итог не его значение`).toBe(values[0]);
    } else {
      stats.contested++;
      expect(values, `группа ${key} спорная между устройствами ${[...byDevice.keys()]}: итог не значение ни одного участника (смесь полей?)`).toContain(got);
    }
  }

  // 4. остатки кошельков одинаковы на всех устройствах и равны посчитанным по серверу
  const model = computeBalances(onServer.wallets as never, onServer.transactions as never);
  for (const [i, s] of snaps.entries()) {
    expect([...computeBalances(s.wallets, s.transactions).entries()].sort(), `остатки устройства ${i}`).toEqual([...model.entries()].sort());
  }
  return stats;
}

/** Конец фазы правок: тихий этап, проверки; следующая фаза начинается с чистого листа (общая точка). */
export async function endPhase(w: World, maxRounds?: number): Promise<{ rounds: number; stats: MergeStats }> {
  const rounds = await quiesce(w, maxRounds);
  const stats = await checkInvariants(w);
  w.phase = new Map();
  return { rounds, stats };
}

