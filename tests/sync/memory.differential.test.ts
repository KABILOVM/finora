// @vitest-environment node
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TxKind } from '@/domain/types';
import { createMemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, TABLE_SPECS, toWire, type SyncTableName, type WireRow } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeSettings, makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Дифференциальная проверка: одни и те же случайные пачки идут и на сервер в памяти, и на НАСТОЯЩУЮ схему (PGlite).
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
    variant: number; // что именно испортить в старых таблицах (0 — ничего)
    v2: number; // то же для таблиц этапа 2 и для новых полей операций (0 — ничего)
    ref: number; // на какие кошелёк/категорию ссылаться
    ref2: number;
    kind: number;
  }>;
}

interface Focus {
  stamps: number[];
  devices: number[];
  ids: number;
  variants: number[];
  variants2: number[];
}
const V2_ALL = Array.from({ length: 20 }, (_, i) => i + 1);
const GENERAL: Focus = {
  stamps: [0, 1, 2, 3, 4, 5, 6],
  devices: [0, 1, 2, 3, 4, 5, 6, 7],
  ids: 4,
  variants: [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  variants2: [0, 0, 0, ...V2_ALL],
};
/** Повторы одной и той же правки с «убежавшими» часами: проверяют журнал меток из будущего. */
const FUTURE: Focus = { stamps: [3, 4, 5, 5, 6, 6], devices: [0, 1, 2], ids: 2, variants: [0, 0, 0, 0, 0, 0, 1], variants2: [0, 0, 0, 0, 0, 0, 1] };

const specArb = (f: Focus): fc.Arbitrary<Spec> =>
  fc.record({
    table: fc.constantFrom(
      'wallets' as const,
      'categories' as const,
      'transactions' as const,
      'transactions' as const,
      'settings' as const,
      'debts' as const,
      'budgets' as const,
      'recurring_rules' as const,
      'recurring_rules' as const,
    ),
    user: fc.integer({ min: 0, max: 1 }),
    rows: fc.array(
      fc.record({
        id: fc.integer({ min: 0, max: f.ids - 1 }),
        stamp: fc.constantFrom(...f.stamps),
        device: fc.constantFrom(...f.devices),
        createdFuture: fc.boolean(),
        deleted: fc.boolean(),
        variant: fc.constantFrom(...f.variants),
        v2: fc.constantFrom(...f.variants2),
        ref: fc.integer({ min: 0, max: 5 }),
        ref2: fc.integer({ min: 0, max: 5 }),
        kind: fc.integer({ min: 0, max: 3 }),
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
        if (k === 'server_seq' || k === 'server_updated_at') continue;
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
  const debtIds = Array.from({ length: 4 }, () => makeDebt().id);
  const budgetIds = Array.from({ length: 4 }, () => makeBudget().id);
  const ruleIds = Array.from({ length: 4 }, () => makeRecurringRule().id);
  const MAX = 1_000_000_000_000_000;
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
          // длина color / icon считается в символах: 32 эмодзи (64 единицы UTF-16) — можно, 33 — нельзя
          color: r.variant === 6 ? 'c'.repeat(33) : r.variant === 8 ? '😀'.repeat(32) : r.variant === 9 ? 'c'.repeat(32) : '#0ea5e9',
          icon: r.variant === 7 ? '😀'.repeat(33) : r.variant === 8 ? '😀'.repeat(32) : 'wallet',
        });
      case 'categories':
        return toWire('categories', {
          ...makeCategory(sync),
          id: categoryIds[r.id] as string,
          name: r.variant === 1 ? '' : `c${r.kind}`,
          kind: r.variant === 4 ? ('transfer' as 'expense') : r.kind % 2 === 0 ? 'expense' : 'income',
          color: r.variant === 5 ? 'c'.repeat(33) : r.variant === 8 ? '😀'.repeat(32) : '#f97316',
          icon: r.variant === 6 ? 'i'.repeat(33) : r.variant === 7 ? '😀'.repeat(33) : r.variant === 9 ? '😀'.repeat(32) : 'tag',
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
          debtId: r.v2 === 1 || r.v2 === 6 ? (debtIds[r.ref2 % 4] as string) : null,
          recurringRuleId: r.v2 === 2 || r.v2 === 6 ? (ruleIds[r.ref % 4] as string) : null,
          // base_amount_minor: у перевода это комиссия (0..1e15), у расхода/дохода — сумма в базовой валюте
          baseAmountMinor: r.v2 === 3 ? -1 : r.v2 === 4 ? MAX + 1 : r.v2 === 5 ? MAX : kind === 'transfer' ? 0 : 10,
          note: r.variant === 4 ? 'я'.repeat(501) : '',
          fxRate: kind === 'transfer' ? null : r.variant === 1 ? 0 : 1,
          // fx_source: 17 символов — нельзя, 16 (в том числе эмодзи, 32 единицы UTF-16) — можно
          fxSource: kind === 'transfer' ? null : r.variant === 7 ? 'x'.repeat(17) : r.variant === 8 ? 'x'.repeat(16) : r.variant === 9 ? '😀'.repeat(16) : 'same',
        });
      }
      case 'debts': {
        const v = r.v2;
        return toWire('debts', {
          ...makeDebt(sync),
          id: debtIds[r.id] as string,
          direction: v === 4 ? ('gift' as 'lent') : r.kind % 2 === 0 ? 'lent' : 'borrowed',
          counterparty: v === 1 ? '' : v === 2 ? 'я'.repeat(81) : v === 12 ? '😀'.repeat(80) : `d${r.kind}`,
          principalMinor: v === 3 ? 0 : v === 5 ? MAX + 1 : v === 12 ? MAX : 10,
          currency: v === 6 ? 'usd' : 'TJS',
          openedOn: v === 7 ? '1999-12-31' : v === 8 ? '2100-01-02' : '2026-09-01',
          dueOn: v === 9 ? '2100-01-02' : v === 13 ? '1999-12-31' : v === 15 ? '2100-01-01' : r.kind === 3 ? '2026-12-01' : null,
          note: v === 10 ? 'я'.repeat(501) : v === 14 ? '😀'.repeat(500) : '',
          closedAt: v === 11 ? '1999-01-01T00:00:00.000Z' : null,
        });
      }
      case 'budgets': {
        const v = r.v2;
        return toWire('budgets', {
          ...makeBudget(sync),
          id: budgetIds[r.id] as string,
          categoryId: v === 6 || v === 10 ? (categoryIds[(v === 6 ? r.ref : r.ref2) % 4] as string) : v === 7 ? makeCategory().id : null,
          amountMinor: v === 1 ? 0 : v === 2 ? -1 : v === 3 ? MAX + 1 : v === 8 ? MAX : 10 + r.kind,
          currency: v === 4 ? 'tjs' : 'TJS',
          period: v === 5 ? ('week' as 'month') : 'month',
          archivedAt: v === 9 ? '1990-01-01T00:00:00.000Z' : null,
        });
      }
      case 'recurring_rules': {
        const v = r.v2;
        const kinds = ['expense', 'income', 'transfer', 'refund'] as const;
        const freqs = ['daily', 'weekly', 'monthly', 'yearly'] as const;
        const kind = kinds[r.kind] as TxKind;
        const transfer = kind === 'transfer';
        const wid = r.ref === 5 ? makeWallet().id : (walletIds[r.ref % 4] as string);
        const to = r.ref2 === 5 ? makeWallet().id : (walletIds[r.ref2 % 4] as string);
        return toWire('recurring_rules', {
          ...makeRecurringRule(sync),
          id: ruleIds[r.id] as string,
          kind,
          walletId: wid,
          toWalletId: transfer ? (v === 13 ? wid : to) : v === 15 ? to : null,
          toAmountMinor: transfer ? (v === 14 ? null : v === 15 ? 0 : 10) : v === 14 ? 5 : null,
          amountMinor: v === 1 ? 0 : v === 20 ? MAX : 10,
          categoryId: v === 16 ? (categoryIds[r.ref % 4] as string) : null,
          debtId: v === 17 ? (debtIds[r.ref2 % 4] as string) : null,
          frequency: v === 2 ? ('hourly' as 'daily') : (freqs[r.kind] as 'daily'),
          intervalN: v === 3 ? 0 : v === 4 ? 1001 : v === 5 ? 1000 : 1,
          startOn: v === 6 ? '1999-12-31' : v === 7 ? '2100-01-02' : v === 19 ? '2100-01-01' : '2026-10-01',
          endOn: v === 8 ? '2026-09-30' : v === 9 ? '2100-01-02' : v === 18 ? '2026-10-01' : v === 19 ? '2100-01-01' : r.kind === 1 ? '2027-01-01' : null,
          autoPost: v === 10 ? (2 as 0) : r.kind % 2 === 0 ? 0 : 1,
          note: v === 11 ? 'я'.repeat(501) : v === 12 ? 'я'.repeat(500) : '',
        });
      }
    }
  };

  const outcome = async (run: () => Promise<void>): Promise<string> => {
    try {
      await run();
      return 'принято';
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      return `${e.kind}:${e.code ?? ''}`;
    }
  };

  for (const [step, spec] of specs.entries()) {
    const batch = spec.rows.map((r) => build(spec, r));
    const uid = users[spec.user] as string;
    const a = await outcome(() => mem.transportFor(uid).push(spec.table, batch));
    const b = await outcome(() => pg.transportFor(uid).push(spec.table, batch));
    expect(a, `шаг ${step}: исход пачки ${spec.table} (память против Postgres)`).toBe(b);
    // состояние всех таблиц обоих пользователей
    for (const table of SYNC_TABLES) {
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
