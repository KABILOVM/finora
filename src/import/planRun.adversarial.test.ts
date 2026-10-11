import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan } from './plan';
import { runImport } from './runImport';
import { ImportFileError } from './types';

const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
async function fresh(): Promise<Store> {
  const store = await openStore('fuzz-user', { deviceId: 'dev-fuzz', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  stores.push(store);
  await ensureSeeded(store);
  return store;
}

const HEAD = 'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const ACCOUNTS: Array<[string, string]> = [
  ['Карта', 'TJS'],
  ['Нал', 'TJS'],
  ['Доллары', 'USD'],
  ['Евро', 'EUR'],
  ['Карта', 'USD'],
  ['Йена', 'JPY'],
  ['Наличные', 'TJS'],
  ['', 'TJS'],
  ['😀'.repeat(40), 'TJS'],
];
const CATS = ['', 'Еда', 'Еда / Кафе', 'Еда / Кафе / Пицца', 'Зарплата', 'Прочее', 'ё', 'Ё / ё', 'x'.repeat(80), 'A / ' + 'б'.repeat(70), ' / ', '😀', 'Продукты / Рынок'];
const AMOUNTS = ['1', '12,5', '1 234,56', '0', '0,00', '1.000,50', '1,000', '10', '999999999999.99', '10000000000000.00', '10000000000000.01', '1e5', '-5', 'abc', '', '5.', '.5', '0,001', '12,345', '1 000', '1,2,3', '100000000000000000', '7', '99,99', '1500', '3 000 000', '0,01'];
const DATES = ['2024-02-29', '29.02.2024', '2023-02-29', '2026-09-01 10:00:00', '', '2000-01-01', '1999-12-31', '2100-01-01', '2100-01-02', '31.12.2025', '2026-09-01', '2026-09-02', '2026-09-02T23:59:59Z', '2026-1-5'];
const TEXTS = ['', 'кофе', 'Обед, "с коллегами"', 'a\nb', 'x'.repeat(600), '😀'.repeat(300), '‮evil', 'nul\u0000x', '\ud83d', 'ё', 'a;b', '  pad  ', 'Корвон'];

const pick = <T,>(arr: readonly T[]) => fc.constantFrom(...arr);
const GOOD_AMOUNTS = ['1', '12,5', '1 234,56', '10', '7', '99,99', '1500', '3 000 000', '0,01', '100', '50,5', '1.000,50', '0', '0'];
const GOOD_DATES = ['2024-02-29', '29.02.2024', '2026-09-01 10:00:00', '2026-09-01', '2026-09-02', '31.12.2025', '2026-09-02T23:59:59Z'];
const GOOD_ACCS: Array<[string, string]> = [['Карта', 'TJS'], ['Нал', 'TJS'], ['Доллары', 'USD'], ['Евро', 'EUR'], ['Карта', 'USD'], ['Йена', 'JPY'], ['Наличные', 'TJS']];
const GOOD_CATS = ['', 'Еда', 'Еда / Кафе', 'Зарплата', 'Прочее', 'Продукты / Рынок', 'ё'];

const rowArb = fc.oneof(
  { weight: 1, arbitrary: fc.record({
    date: pick(DATES),
    cat: pick(CATS),
    payee: pick(TEXTS),
    comment: pick(TEXTS),
    out: fc.option(fc.record({ acc: pick(ACCOUNTS), amount: pick(AMOUNTS) }), { nil: null }),
    inc: fc.option(fc.record({ acc: pick(ACCOUNTS), amount: pick(AMOUNTS) }), { nil: null }),
  }) },
  { weight: 4, arbitrary: fc.record({
    date: pick(GOOD_DATES),
    cat: pick(GOOD_CATS),
    payee: pick(['', 'Корвон', 'ё']),
    comment: pick(['', 'кофе', 'ё']),
    out: fc.option(fc.record({ acc: pick(GOOD_ACCS), amount: pick(GOOD_AMOUNTS) }), { nil: null }),
    inc: fc.option(fc.record({ acc: pick(GOOD_ACCS), amount: pick(GOOD_AMOUNTS) }), { nil: null }),
  }) },
);

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
type GenRow = typeof rowArb extends fc.Arbitrary<infer T> ? T : never;
function toCsv(rows: GenRow[]): string {
  const lines = [HEAD];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        q(r.cat),
        q(r.payee),
        q(r.comment),
        q(r.out?.acc[0] ?? ''),
        r.out?.amount ?? '0',
        r.out?.acc[1] ?? '',
        q(r.inc?.acc[0] ?? ''),
        r.inc?.amount ?? '0',
        r.inc?.acc[1] ?? '',
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

const envArb = fc.record({
  wallets: fc.array(
    fc.record({ name: pick(['Карта', 'Нал', 'Доллары', 'Наличные', 'Евро', 'Другой']), currency: pick(['TJS', 'USD', 'EUR', 'JPY']), archived: fc.boolean() }),
    { maxLength: 4 },
  ),
  cats: fc.array(fc.record({ name: pick(['Еда', 'Кафе', 'Зарплата', 'ё', 'Продукты']), kind: pick(['expense', 'income'] as const), archived: fc.boolean() }), { maxLength: 4 }),
  rates: fc.record({ USD: pick([null, 10.9, 0.000001, 1e9]), EUR: pick([null, 11.5]), JPY: pick([null, 0.07]) }),
  chunk: pick([1, 3, 250]),
});

describe('случайные файлы и базы: план «добавить» всегда принимается репозиторием; повтор ничего не меняет', () => {
  it('случайные файлы и базы', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { minLength: 1, maxLength: 25 }), envArb, async (rows, env) => {
        const text = toCsv(rows);
        const store = await fresh();
        for (const w of env.wallets) {
          const c = await store.wallets.create({ name: w.name, currency: w.currency, kind: 'other', openingBalanceMinor: 0, color: '#000000', icon: '💰' });
          if (w.archived) await store.wallets.archive(c.id);
        }
        for (const c of env.cats) {
          const made = await store.categories.create({ name: c.name, kind: c.kind, color: '#000000', icon: 'x' });
          if (c.archived) await store.categories.archive(made.id);
        }
        let parsed;
        try {
          parsed = parseZenmoney(text);
        } catch (e) {
          if (e instanceof ImportFileError) return;
          throw e;
        }
        expect(parsed.rows.length + parsed.review.length + parsed.skipped.length).toBe(parsed.totalRecords);
        const ids = await computeIds(store.userId, parsed);
        const plan = async () => {
          const [wallets, categories, txs] = await Promise.all([store.db.wallets.toArray(), store.db.categories.toArray(), store.db.transactions.toArray()]);
          return buildPlan({ parsed: parsed!, ids, baseCurrency: 'TJS', wallets, categories, existing: new Map(txs.map((t) => [t.id, t.deletedAt !== null])), rates: env.rates });
        };
        const p1 = await plan();
        const report = await runImport(store, p1, { chunkSize: env.chunk });
        expect({ failed: report.failed, fatal: report.fatal }).toEqual({ failed: [], fatal: null });
                const live1 = await store.db.transactions.filter((t) => t.deletedAt === null).toArray();
        expect(live1.length).toBe(p1.counts.add);

        // повтор: ничего нового
        const p2 = await plan();
        expect(p2.counts.add).toBe(0);
        const r2 = await runImport(store, p2, { chunkSize: env.chunk });
        expect(r2.added).toBe(0);
        const live2 = await store.db.transactions.filter((t) => t.deletedAt === null).toArray();
        expect(live2.length).toBe(live1.length);

        // остаток созданных кошельков = то, что насчитал отчёт
        const wallets = await store.db.wallets.filter((w) => w.deletedAt === null).toArray();
        const bal = computeBalances(wallets, live2);
        for (const line of report.reconcile.filter((l) => l.created)) {
          expect(bal.get(line.id)).toBe(line.fileBalanceMinor);
        }
      }),
      { numRuns: 150 },
    );
  }, 600_000);
});

describe('случайные файлы: изменения человека между загрузками (архив, удаление, остановка)', () => {
  it('архив/удаление созданного импортом, потом новая выгрузка', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { minLength: 1, maxLength: 20 }),
        fc.array(rowArb, { minLength: 0, maxLength: 10 }),
        fc.record({
          archiveWallets: fc.array(fc.nat(5), { maxLength: 3 }),
          archiveCats: fc.array(fc.nat(8), { maxLength: 3 }),
          deleteTx: fc.array(fc.nat(30), { maxLength: 6 }),
          stopAfter: pick([0, 1, 2, 99]),
          choose: fc.boolean(),
          shuffle: fc.boolean(),
        }),
        async (rows1, extra, mut) => {
          const store = await fresh();
          const parseIt = (rs: typeof rows1) => {
            try {
              return parseZenmoney(toCsv(rs));
            } catch (e) {
              if (e instanceof ImportFileError) return null;
              throw e;
            }
          };
          const plan = async (parsed: NonNullable<ReturnType<typeof parseIt>>, choices: Record<string, string> = {}) => {
            const ids = await computeIds(store.userId, parsed);
            const [wallets, categories, txs] = await Promise.all([store.db.wallets.toArray(), store.db.categories.toArray(), store.db.transactions.toArray()]);
            return buildPlan({ parsed, ids, baseCurrency: 'TJS', wallets, categories, existing: new Map(txs.map((t) => [t.id, t.deletedAt !== null])), walletChoices: choices, rates: { USD: 10.9, EUR: 11.5, JPY: 0.07 } });
          };
          const a = parseIt(rows1);
          if (!a) return;
          const ctl = new AbortController();
          let chunks = 0;
          const p1 = await plan(a);
          const r1 = await runImport(store, p1, {
            chunkSize: 2,
            signal: ctl.signal,
            onProgress: (p) => {
              if (p.phase === 'transactions' && ++chunks > mut.stopAfter) ctl.abort();
            },
          });
          expect(r1.failed).toEqual([]);

          // человек наводит порядок
          const wl = await store.db.wallets.toArray();
          for (const i of mut.archiveWallets) {
            const w = wl[i % Math.max(1, wl.length)];
            if (w && w.archivedAt === null) await store.wallets.archive(w.id);
          }
          const cl = await store.db.categories.toArray();
          for (const i of mut.archiveCats) {
            const c = cl[i % Math.max(1, cl.length)];
            if (c && c.archivedAt === null) await store.categories.archive(c.id);
          }
          const tl = await store.db.transactions.toArray();
          for (const i of mut.deleteTx) {
            const t = tl[i % Math.max(1, tl.length)];
            if (t && t.deletedAt === null) await store.transactions.softDelete(t.id);
          }

          const rows2 = mut.shuffle ? [...extra, ...rows1].reverse() : [...rows1, ...extra];
          const b = parseIt(rows2);
          if (!b) return;
          let choices: Record<string, string> = {};
          if (mut.choose) {
            const p0 = await plan(b);
            for (const w of p0.wallets) if (w.target.kind === 'blocked' && w.candidates[0]) choices[w.key] = w.candidates[0].id;
          }
          const p2 = await plan(b, choices);
          const before = await store.db.transactions.count();
          const r2 = await runImport(store, p2, { chunkSize: 3 });
          expect({ failed: r2.failed, fatal: r2.fatal }).toEqual({ failed: [], fatal: null });
          const after = await store.db.transactions.count();
          expect(after - before).toBe(p2.counts.add);

          // третий прогон: ничего нового, deleted не воскресли
          const p3 = await plan(b, choices);
          expect(p3.counts.add).toBe(0);
          const delBefore = (await store.db.transactions.filter((t) => t.deletedAt !== null).toArray()).map((t) => t.id).sort();
          await runImport(store, p3);
          const delAfter = (await store.db.transactions.filter((t) => t.deletedAt !== null).toArray()).map((t) => t.id).sort();
          expect(delAfter).toEqual(delBefore);
        },
      ),
      { numRuns: 120 },
    );
  }, 600_000);
});
