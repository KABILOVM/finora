// @vitest-environment node
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TxKind } from '@/domain/types';
import { createMemoryServer } from '@/sync/memoryServer';
import { TABLE_SPECS, toWire, type SyncTableName, type WireRow } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeCategory, makeSettings, makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Дифференциальная проверка: одни и те же случайные пачки идут и на сервер в памяти, и на НАСТОЯЩУЮ схему (PGlite).
 * В пачках случайно встречается проверка версии (base_seq): верная, устаревшая, «строки нет», отрицательная.
 * После каждой пачки сравниваем исход (принято / вид и код отказа) и состояние таблиц (все поля, порядок по server_seq).
 * Postgres здесь — эталон: если расходятся, чинится сервер в памяти.
 */

let pg: PgliteServer;
beforeAll(async () => {
  pg = await createPgliteServer();
}, 120_000);
afterAll(async () => {
  await pg.close();
});

const MIN = 60_000;
const OFFSETS = [-60 * MIN, -10 * MIN, -1_000, 0, 4 * MIN, 10 * MIN, 24 * 60 * MIN]; // относительно начала прогона
const DEVICES = ['a', 'B', 'a-dev', 'B-dev', 'z', 'dev-1', '', 'x'.repeat(65)];

interface Spec {
  table: SyncTableName;
  user: number;
  rows: Array<{
    id: number; // номер в пуле
    stamp: number;
    device: number;
    createdFuture: boolean;
    deleted: boolean;
    variant: number; // что именно испортить (0 — ничего)
    ref: number; // на какие кошелёк/категорию ссылаться
    ref2: number;
    kind: number;
    /** Какую ожидаемую версию (base_seq) нести: см. BASE_MODES. */
    base: number;
  }>;
}

/**
 * Режимы base_seq (проверка версии): нет колонки вовсе, null, «строки нет» (0), текущая версия строки на сервере, устаревшая,
 * версия «из будущего» и отрицательная (её сервер отвергает). Текущую версию каждый сервер подставляет свою:
 * номера server_seq у сервера в памяти и у Postgres разные, а вот исход обязан быть одинаковым.
 */
const BASE_MODES = ['absent', 'null', 'zero', 'current', 'current', 'current', 'stale', 'ahead', 'negative'] as const;

interface Focus {
  stamps: number[];
  devices: number[];
  ids: number;
  variants: number[];
}
const GENERAL: Focus = { stamps: [0, 1, 2, 3, 4, 5, 6], devices: [0, 1, 2, 3, 4, 5, 6, 7], ids: 4, variants: [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6] };
/** Повторы одной и той же правки с «убежавшими» часами: проверяют журнал меток из будущего. */
const FUTURE: Focus = { stamps: [3, 4, 5, 5, 6, 6], devices: [0, 1, 2], ids: 2, variants: [0, 0, 0, 0, 0, 0, 1] };

const specArb = (f: Focus): fc.Arbitrary<Spec> =>
  fc.record({
    table: fc.constantFrom('wallets' as const, 'categories' as const, 'transactions' as const, 'settings' as const),
    user: fc.integer({ min: 0, max: 1 }),
    rows: fc.array(
      fc.record({
        id: fc.integer({ min: 0, max: f.ids - 1 }),
        stamp: fc.constantFrom(...f.stamps),
        device: fc.constantFrom(...f.devices),
        createdFuture: fc.boolean(),
        deleted: fc.boolean(),
        variant: fc.constantFrom(...f.variants),
        ref: fc.integer({ min: 0, max: 5 }),
        ref2: fc.integer({ min: 0, max: 5 }),
        kind: fc.integer({ min: 0, max: 3 }),
        base: fc.integer({ min: 0, max: BASE_MODES.length - 1 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  });

/** Строки в виде, пригодном для сравнения: время — мс (зажатые «из будущего» — одна метка), служебные поля убраны. */
function normalize(rows: Array<Record<string, unknown>>, table: SyncTableName, nowMs: number): Array<Record<string, unknown>> {
  const tsCols = new Set(TABLE_SPECS[table].columns.filter((c) => c.type === 'ts').map((c) => c.column));
  return rows
    .map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === 'server_seq' || k === 'server_updated_at') continue; // base_seq в таблице всегда пуста — это тоже сравнивается
        if (tsCols.has(k) && typeof v === 'string') {
          const ms = Date.parse(v);
          out[k] = ms > nowMs + 6 * MIN ? 'далёкое будущее' : ms > nowMs + 4.5 * MIN ? 'зажато «сейчас + 5 минут»' : ms;
        } else out[k] = v;
      }
      return out;
    })
    .sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
}

async function compare(specs: Spec[]): Promise<void> {
  const base = Date.now();
  let last = 0;
  const mem = createMemoryServer({ now: () => (last = Math.max(last + 1, Date.now())) });
  const users = [makeUserId(), makeUserId()] as const;
  // пулы идентификаторов этого прогона (общие для обоих пользователей — чтобы ловить чужие строки с тем же id)
  const walletIds = Array.from({ length: 4 }, () => makeWallet().id);
  const categoryIds = Array.from({ length: 4 }, () => makeCategory().id);
  const txIds = Array.from({ length: 4 }, () => makeTransaction().id);
  const at = (i: number) => new Date(base + (OFFSETS[i] as number)).toISOString();

  const build = (spec: Spec, r: Spec['rows'][number]): WireRow => {
    const uid = users[spec.user] as string;
    const device = DEVICES[r.device] as string;
    const sync = {
      createdAt: new Date(base + (r.createdFuture ? 24 * 60 * MIN : -120 * MIN)).toISOString(),
      clientUpdatedAt: at(r.stamp),
      deviceId: device,
      deletedAt: r.deleted ? at(r.stamp) : null,
    };
    switch (spec.table) {
      case 'wallets':
        return toWire('wallets', {
          ...makeWallet(sync),
          id: walletIds[r.id] as string,
          name: r.variant === 1 ? '' : r.variant === 2 ? 'я'.repeat(81) : `n${r.kind}`,
          currency: r.variant === 3 ? 'tjs' : 'TJS',
          kind: r.variant === 4 ? ('crypto' as 'cash') : 'cash',
          openingBalanceMinor: r.variant === 5 ? 1_000_000_000_000_001 : r.kind,
        });
      case 'categories':
        return toWire('categories', {
          ...makeCategory(sync),
          id: categoryIds[r.id] as string,
          name: r.variant === 1 ? '' : `c${r.kind}`,
          kind: r.variant === 4 ? ('transfer' as 'expense') : r.kind % 2 === 0 ? 'expense' : 'income',
        });
      case 'settings':
        return toWire('settings', {
          ...makeSettings(r.variant === 1 ? (walletIds[0] as string) : uid, sync),
          locale: r.variant === 2 ? ('en' as 'ru') : 'ru',
          weekStartsOn: r.variant === 3 ? (2 as 0) : r.kind % 2 === 0 ? 0 : 1,
          baseCurrency: r.variant === 4 ? 'tjs' : 'TJS',
        });
      case 'transactions': {
        const kinds = ['expense', 'income', 'transfer', 'refund'] as const;
        const kind = kinds[r.kind] as TxKind;
        const wid = r.ref === 5 ? makeWallet().id : (walletIds[r.ref % 4] as string);
        const to = r.ref2 === 5 ? makeWallet().id : (walletIds[r.ref2 % 4] as string);
        return toWire('transactions', {
          ...makeTransaction(sync),
          id: txIds[r.id] as string,
          kind,
          walletId: wid,
          toWalletId: kind === 'transfer' ? (r.variant === 6 ? wid : to) : r.variant === 5 ? to : null,
          toAmountMinor: kind === 'transfer' ? (r.variant === 1 ? null : 10) : null,
          amountMinor: r.variant === 2 ? 0 : 10,
          categoryId: r.variant === 3 ? (categoryIds[r.ref % 4] as string) : null,
          note: r.variant === 4 ? 'я'.repeat(501) : '',
          fxRate: kind === 'transfer' ? null : r.variant === 1 ? 0 : 1,
          fxSource: kind === 'transfer' ? null : 'same',
        });
      }
    }
  };

  const texts: string[] = []; // тексты отказов обоих серверов — только для сообщения об ошибке
  const outcome = async (run: () => Promise<void>): Promise<string> => {
    try {
      await run();
      texts.push('принято');
      return 'принято';
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      texts.push(e.message);
      return `${e.kind}:${e.code ?? ''}`;
    }
  };

  /** Текущая версия строки у каждого из серверов (того пользователя, что пишет); undefined — строки у него нет. */
  const currentSeq = {
    mem: (uid: string, table: SyncTableName, id: string): number | undefined => mem.dump(uid, table).find((r) => r['id'] === id)?.server_seq,
    pg: async (uid: string, table: SyncTableName, id: string): Promise<number | undefined> => {
      const res = await pg.db.query<{ s: string | number }>(`select server_seq as s from public.${TABLE_SPECS[table].remote} where id = $1 and user_id = $2`, [id, uid]);
      return res.rows[0] === undefined ? undefined : Number(res.rows[0].s);
    },
  };
  const withBase = (row: WireRow, mode: (typeof BASE_MODES)[number], current: number | undefined): WireRow => {
    switch (mode) {
      case 'absent':
        return row;
      case 'null':
        return { ...row, base_seq: null };
      case 'zero':
        return { ...row, base_seq: 0 };
      // Строки на сервере ещё нет: «текущая» версия — 0 («строки нет»), а «устаревшая» и «из будущего» — число, которого нет ни у
      // одного из серверов. Нельзя брать маленькое число: у сервера в памяти оно совпало бы с номером соседней строки той же пачки
      // (номера server_seq у двух серверов разные), и исходы разошлись бы не из-за правил, а из-за совпадения чисел.
      case 'current':
        return { ...row, base_seq: current ?? 0 };
      case 'stale':
        return { ...row, base_seq: current === undefined ? 9_000_000_001 : current - 1 };
      case 'ahead':
        return { ...row, base_seq: (current ?? 0) + 9_000_000_000 };
      case 'negative':
        return { ...row, base_seq: -1 };
    }
  };

  for (const [step, spec] of specs.entries()) {
    const uid = users[spec.user] as string;
    // строки строятся ОДИН раз (фабрики ведут счётчики): обоим серверам уходит одно и то же, различается только base_seq
    // Строка с уже встречавшимся в пачке id идёт без проверки версии: клиент такие пачки не шлёт (движок убирает дубли по id), а
    // «точный повтор» двух таких строк с метками из будущего у серверов различается на микросекунды (память зажимает метку по
    // одной границе на пачку, Postgres — по своей на каждую строку); это отличие не видно нигде, кроме как здесь.
    const seenIds = new Set<string>();
    const built = spec.rows.map((r) => {
      const row = build(spec, r);
      const id = String(row['id']);
      const mode = seenIds.has(id) ? 'absent' : (BASE_MODES[r.base] as (typeof BASE_MODES)[number]);
      seenIds.add(id);
      return { row, mode };
    });
    const batchFor = async (current: (id: string) => Promise<number | undefined> | number | undefined): Promise<WireRow[]> =>
      Promise.all(built.map(async ({ row, mode }) => withBase(row, mode, await current(String(row['id'])))));
    const memBatch = await batchFor((id) => currentSeq.mem(uid, spec.table, id));
    const pgBatch = await batchFor((id) => currentSeq.pg(uid, spec.table, id));
    const before = {
      mem: mem.dump(uid, spec.table).map((r) => `${String(r['id']).slice(-4)}:seq${String(r['server_seq'])}@${String(r['client_updated_at'])}/${String(r['device_id']).slice(0, 8)}`).join(', '),
      pg: (await pg.db.query<{ t: string }>(`select id::text || ':seq' || server_seq || '@' || client_updated_at || '/' || left(device_id, 8) as t from public.${TABLE_SPECS[spec.table].remote} where user_id = $1 order by server_seq`, [uid])).rows.map((r) => r.t.replace(/^.*(.{4}:seq)/, '$1')).join(', '),
    };
    const a = await outcome(() => mem.transportFor(uid).push(spec.table, memBatch));
    const b = await outcome(() => pg.transportFor(uid).push(spec.table, pgBatch));
    const brief = (batch: WireRow[]) =>
      batch.map((r) => `${String(r['id']).slice(-4)}@${String(r['client_updated_at'])}/${String(r['device_id']).slice(0, 8)} base=${String(r['base_seq'])}`).join('; ');
    expect(a, `шаг ${step}: исход пачки ${spec.table} (память против Postgres)\n  память: ${texts.at(-2)}\n  Postgres: ${texts.at(-1)}\n  до пачки (память): ${before.mem}\n  до пачки (Postgres): ${before.pg}\n  пачка (память): ${brief(memBatch)}\n  пачка (Postgres): ${brief(pgBatch)}`).toBe(b);
    // состояние всех таблиц обоих пользователей
    for (const table of ['settings', 'wallets', 'categories', 'transactions'] as const) {
      for (const u of users) {
        const memRows = mem.dump(u, table);
        const pgRows = (
            await pg.db.query<{ j: Record<string, unknown> }>(`select to_jsonb(t) as j from public.${TABLE_SPECS[table].remote} t where t.user_id = $1 order by t.server_seq`, [u])
          ).rows.map((r) => r.j);
        const nowMs = Date.now();
        expect(normalize(memRows, table, nowMs), `шаг ${step}: ${table} пользователя ${users.indexOf(u)}`).toEqual(normalize(pgRows as never, table, nowMs));
        // порядок по server_seq: что новее, лежит позже
        expect(memRows.map((r) => r['id']), `шаг ${step}: порядок ${table}`).toEqual(pgRows.map((r) => r['id']));
      }
    }
  }
}

const RUNS = Number(process.env['DIFFERENTIAL_RUNS'] ?? 60);

describe('сервер в памяти против настоящей схемы (PGlite)', () => {
  it('случайные пачки: исходы и состояние совпадают', async () => {
    await fc.assert(fc.asyncProperty(fc.array(specArb(GENERAL), { minLength: 4, maxLength: 14, size: 'max' }), compare), { numRuns: RUNS, endOnFailure: true });
  }, 600_000);

  it('повторы правок с часами из будущего: журнал меток ведёт себя так же', async () => {
    await fc.assert(fc.asyncProperty(fc.array(specArb(FUTURE), { minLength: 6, maxLength: 16, size: 'max' }), compare), { numRuns: RUNS, endOnFailure: true });
  }, 600_000);
});
