// @vitest-environment node
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TxKind } from '@/domain/types';
import { createMemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, TABLE_SPECS, toWire, type SyncTableName, type WireRow } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeSavingsGoal, makeSettings, makeShoppingItem, makeTransaction, makeUserId, makeWallet } from './factories';
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
    variant: number; // что именно испортить в старых таблицах (0 — ничего)
    v2: number; // то же для таблиц этапа 2 и для новых полей операций (0 — ничего)
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
  variants2: number[];
}
const V2_ALL = Array.from({ length: 20 }, (_, i) => i + 1);
const GENERAL: Focus = {
  stamps: [0, 1, 2, 3, 4, 5, 6],
  devices: [0, 1, 2, 3, 4, 5, 6, 7],
  ids: 4,
  variants: [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
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
      'shopping_items' as const,
      'shopping_items' as const,
      'savings_goals' as const,
      'savings_goals' as const,
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
  const debtIds = Array.from({ length: 4 }, () => makeDebt().id);
  const budgetIds = Array.from({ length: 4 }, () => makeBudget().id);
  const ruleIds = Array.from({ length: 4 }, () => makeRecurringRule().id);
  const shopIds = Array.from({ length: 4 }, () => makeShoppingItem().id);
  const goalIds = Array.from({ length: 4 }, () => makeSavingsGoal().id);
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
          // цель: variant 10 — сумма за пределом, 11 — срок до 2000 года; в остальных случаях цели нет
          goalMinor: r.variant === 10 ? 1_000_000_000_000_001 : r.variant === 11 ? 1_000 : null,
          goalOn: r.variant === 11 ? '1999-12-31' : null,
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
          // «обязательная» категория: 0 и 1 можно, 2 — нельзя
          essential: r.variant === 10 ? (2 as 0) : r.variant === 11 ? 1 : 0,
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
          // категория долга: до 40 символов (считаются символы, а не единицы UTF-16)
          category: v === 16 ? 'я'.repeat(41) : v === 17 ? 'я'.repeat(40) : v === 18 ? '😀'.repeat(40) : v === 19 ? '😀'.repeat(41) : '',
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
      case 'shopping_items': {
        const v = r.v2;
        const at = new Date(base - 5 * MIN).toISOString();
        const tx = txIds[r.ref % 4] as string;
        // отметка и цена идут парой; купленная — отмеченная и с чеком (v 14)
        const checked = v === 7 || v === 8 || v === 9 || v === 11 || v === 12 || v === 14 || v === 15 || v === 17;
        const price = v === 7 ? -1 : v === 8 ? MAX + 1 : v === 9 ? MAX : v === 10 ? 100 : v === 11 ? null : v === 15 ? 0 : checked ? 250 : null;
        return toWire('shopping_items', {
          ...makeShoppingItem(sync),
          id: shopIds[r.id] as string,
          name: v === 1 ? '' : v === 2 ? 'я'.repeat(81) : v === 16 ? 'я'.repeat(80) : `п${r.kind}`,
          qtyMilli: v === 3 ? 0 : v === 4 ? 1_000_000_001 : v === 5 ? 1_000_000_000 : 1400,
          unit: v === 6 ? ('kgs' as 'kg') : (['pcs', 'kg', 'l'] as const)[r.kind % 3]!,
          priceMinor: price,
          checkedAt: checked ? at : null,
          purchasedAt: v === 12 || v === 14 ? at : null,
          transactionId: v === 13 || v === 14 ? tx : null,
        });
      }
      case 'savings_goals': {
        const v = r.v2;
        return toWire('savings_goals', {
          ...makeSavingsGoal(sync),
          id: goalIds[r.id] as string,
          name: v === 1 ? '' : v === 2 ? 'я'.repeat(61) : v === 3 ? 'я'.repeat(60) : v === 14 ? '😀'.repeat(60) : v === 15 ? '😀'.repeat(61) : `ц${r.kind}`,
          targetMinor: v === 4 ? 0 : v === 5 ? MAX + 1 : v === 6 ? MAX : v === 16 ? -1 : 10 + r.kind,
          currency: v === 7 ? 'usd' : 'TJS',
          dueOn: v === 8 ? '1999-12-31' : v === 9 ? '2100-01-02' : v === 10 ? '2100-01-01' : v === 17 ? '2000-01-01' : '2026-12-31',
          // кошелёк: v 11 — свой из пула (может ещё не существовать у этого пользователя), 12 — чужой выдуманный
          walletId: v === 11 ? (walletIds[r.ref % 4] as string) : v === 12 ? makeWallet().id : null,
          archivedAt: v === 13 ? '1990-01-01T00:00:00.000Z' : null,
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
