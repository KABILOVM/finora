import { describe, expect, it, vi } from 'vitest';
import { stringifyWeather } from '@/domain/weatherPlaces';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SyncTableName, WireRow } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { USER, fakeTimers, openDevice, settle, spy, until, type Device, type Spy } from './engineHarness';

/**
 * Облако со старой схемой (supabase/schema.sql не выполнен заново): у сервера нет колонок цели накопления и городов для погоды.
 * Строка со значением в такой колонке ждёт на устройстве (отказ 'schema'), а всё остальное — другие кошельки, операции, категории,
 * чужие правки — синхронизируется как обычно. Статус объясняет, что сделать.
 */

const LATE: Partial<Record<SyncTableName, string[]>> = { wallets: ['goal_minor', 'goal_on'], settings: ['weather'] };

/** Устройство, чей сервер «не знает» поздних колонок, пока oldSchema.on = true (как боевой транспорт против старой схемы). */
async function openOld(server: MemoryServer, id: string): Promise<{ d: Device; sp: Spy; oldSchema: { on: boolean } }> {
  const oldSchema = { on: true };
  let sp!: Spy;
  const d = await openDevice(server, id, {
    seed: true,
    wrap: (inner) => {
      sp = spy(inner);
      sp.onPush = (table: SyncTableName, rows: WireRow[]) => {
        const cols = LATE[table] ?? [];
        if (oldSchema.on && rows.some((r) => cols.some((c) => r[c] !== null && r[c] !== undefined))) {
          throw new TransportError('schema', `Could not find the '${cols[0]}' column of '${table}' in the schema cache`, 'PGRST204', cols);
        }
      };
      return sp.transport;
    },
  });
  return { d, sp, oldSchema };
}

const wallet = (d: Device, name: string, goal = false) =>
  d.store.wallets.create({
    name,
    currency: 'TJS',
    kind: goal ? 'savings' : 'cash',
    openingBalanceMinor: 0,
    color: '#111111',
    icon: 'w',
    ...(goal ? { goalMinor: 1_000_000, goalOn: '2027-06-01' } : {}),
  });
const PLACES = stringifyWeather({ selected: null, cities: [{ id: '38.56,68.77', name: 'Душанбе', region: '', lat: 38.56, lon: 68.77 }] });
const onServer = (server: MemoryServer, table: SyncTableName) => server.dump(USER, table).map((r) => r['id']);
const sentTimes = (sp: Spy, id: string) => sp.pushes().filter((c) => c.ids?.includes(id)).length;

describe('облако без поздних колонок: ждёт только строка со значением в них', () => {
  it('из пачки [обычный, с целью, обычный] уходят обычные и их операции; кошелёк с целью и его операция ждут без карантина; чужое приходит', async () => {
    const server = createMemoryServer();
    const { d: a, sp, oldSchema } = await openOld(server, 'dev-a');
    await a.engine.syncNow();
    const b = await openDevice(server, 'dev-b', { seed: true });
    await b.engine.syncNow();

    const p1 = await wallet(a, 'Карта');
    const goal = await wallet(a, 'На машину', true);
    const p2 = await wallet(a, 'Наличные 2');
    const t1 = await a.store.transactions.create({ kind: 'expense', walletId: p1.id, amountMinor: 700, occurredOn: '2026-10-17' });
    const tg = await a.store.transactions.create({ kind: 'income', walletId: goal.id, amountMinor: 100_000, occurredOn: '2026-10-17' });
    const cat = await a.store.categories.create({ name: 'Кафе', kind: 'expense', color: '#f97316', icon: 'c' });
    const cash = (await b.store.db.wallets.toArray())[0]!;
    const tb = await b.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 300, occurredOn: '2026-10-17' });
    await b.engine.syncNow();

    await a.engine.syncNow();
    expect(onServer(server, 'wallets')).toEqual(expect.arrayContaining([p1.id, p2.id]));
    expect(onServer(server, 'wallets')).not.toContain(goal.id);
    expect(onServer(server, 'transactions')).toContain(t1.id);
    expect(onServer(server, 'transactions')).not.toContain(tg.id);
    expect(onServer(server, 'categories')).toContain(cat.id);
    expect(await a.store.db.wallets.get(goal.id)).toMatchObject({ dirty: 1, syncError: null, goalMinor: 1_000_000 });
    expect(await a.store.db.transactions.get(tg.id)).toMatchObject({ dirty: 1, syncError: null });
    expect(await a.store.db.transactions.get(tb.id)).toBeTruthy(); // получение после отправки не пропущено
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 2, quarantined: 0 });
    expect(a.engine.getStatus().lastError).toMatch(/schema\.sql.*раздел 11 — цели накопления/);
    expect(a.engine.getStatus().lastError).not.toMatch(/недоступен|\.$/);
    // за цикл кошелёк с целью отправлен один раз (не на каждом проходе), операция на нём — ни разу
    expect(sentTimes(sp, goal.id)).toBe(1);
    expect(sentTimes(sp, tg.id)).toBe(0);

    // следующий цикл пробует снова — тоже один раз
    await a.engine.syncNow();
    expect(sentTimes(sp, goal.id)).toBe(2);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 2, quarantined: 0 });

    // схему обновили: всё доезжает, статус чистый
    oldSchema.on = false;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
    expect(server.dump(USER, 'wallets').find((r) => r['id'] === goal.id)).toMatchObject({ goal_minor: 1_000_000, goal_on: '2027-06-01' });
    expect(onServer(server, 'transactions')).toContain(tg.id);
  });

  it('выбранный город: ждут только настройки; в сообщении — раздел 13 и что ждёт', async () => {
    const server = createMemoryServer();
    const { d: a, oldSchema } = await openOld(server, 'dev-a');
    await a.engine.syncNow();
    await a.store.settings.update({ weather: PLACES, weekStartsOn: 0 });
    const w = await wallet(a, 'Карта');
    await a.engine.syncNow();
    expect(onServer(server, 'wallets')).toContain(w.id);
    expect(server.dump(USER, 'settings')[0]).toMatchObject({ week_starts_on: 1 }); // настройки ждут целиком
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, quarantined: 0 });
    expect(a.engine.getStatus().lastError).toBe(
      'В облаке устарела схема: выполните supabase/schema.sql целиком (раздел 13 — города для погоды); пока настройки остаются только на этом устройстве',
    );
    oldSchema.on = false;
    await a.engine.syncNow();
    expect(server.dump(USER, 'settings')[0]).toMatchObject({ week_starts_on: 0, weather: PLACES });
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
  });

  it('ожидание схемы не ставит паузу после сбоя: новая правка уходит через ~1 с, а не через минуты', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d: a } = await openOld(server, 'dev-a');
    await a.engine.syncNow();
    await wallet(a, 'На машину', true);
    a.engine.start();
    await until(() => a.engine.getStatus().phase === 'error' && a.engine.getStatus().pending === 1, 'кошелёк с целью ждёт схему');
    await settle();
    const w = await wallet(a, 'Карта');
    await vi.advanceTimersByTimeAsync(1_000);
    await until(
      () => onServer(server, 'wallets').includes(w.id) && a.engine.getStatus().phase === 'error' && a.engine.getStatus().pending === 1,
      'правка ушла по обычному поводу, кошелёк с целью по-прежнему ждёт',
    );
  });
});
