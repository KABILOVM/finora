import fc from 'fast-check';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, openStore, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { convertMinor } from '@/domain/money';

const USER = '55555555-5555-4555-8555-555555555555';
const CURS = ['TJS', 'USD', 'RUB'] as const;

type Op =
  | { t: 'wallet'; c: number }
  | { t: 'cat'; kind: 0 | 1 }
  | { t: 'tx'; kind: 0 | 1 | 2; w: number; w2: number; c: number; amt: number; toAmt: number }
  | { t: 'upd'; tx: number; amt: number; w: number; kind: 0 | 1 | 2; cat: number }
  | { t: 'del'; tx: number }
  | { t: 'res'; tx: number }
  | { t: 'arch'; w: number }
  | { t: 'unarch'; w: number }
  | { t: 'cur'; w: number; c: number }
  | { t: 'ckind'; c: number }
  | { t: 'base'; c: number }
  | { t: 'roundtrip' };
const n = (max: number) => fc.integer({ min: 0, max });
const w = (weight: number, arbitrary: fc.Arbitrary<Op>) => ({ weight, arbitrary });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  w(4, fc.record({ t: fc.constant('wallet' as const), c: n(2) })),
  w(3, fc.record({ t: fc.constant('cat' as const), kind: n(1) as fc.Arbitrary<0 | 1> })),
  w(12, fc.record({ t: fc.constant('tx' as const), kind: n(2) as fc.Arbitrary<0 | 1 | 2>, w: n(5), w2: n(5), c: n(5), amt: fc.integer({ min: 1, max: 100000 }), toAmt: fc.integer({ min: 1, max: 100000 }) })),
  w(6, fc.record({ t: fc.constant('upd' as const), tx: n(9), amt: fc.integer({ min: 1, max: 100000 }), w: n(5), kind: n(2) as fc.Arbitrary<0 | 1 | 2>, cat: n(5) })),
  w(2, fc.record({ t: fc.constant('del' as const), tx: n(9) })),
  w(2, fc.record({ t: fc.constant('res' as const), tx: n(9) })),
  w(1, fc.record({ t: fc.constant('arch' as const), w: n(5) })),
  w(1, fc.record({ t: fc.constant('unarch' as const), w: n(5) })),
  w(1, fc.record({ t: fc.constant('cur' as const), w: n(5), c: n(2) })),
  w(1, fc.record({ t: fc.constant('ckind' as const), c: n(5) })),
  w(1, fc.record({ t: fc.constant('base' as const), c: n(2) })),
  w(1, fc.record({ t: fc.constant('roundtrip' as const) })),
);

async function ok<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ValidationError) return undefined;
    throw e;
  }
}

describe('модель: репозитории + импорт держат смысловые инварианты', () => {
  it('случайные последовательности', { timeout: 280_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 30, maxLength: 70, size: 'max' }), async (ops) => {
        let now = Date.UTC(2026, 9, 10, 12);
        const mk = () => openStore(USER, { deviceId: 'device-m-1111', now: () => now, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
        const s: Store = await mk();
        const spare: Store = await mk();
        try {
          await s.settings.ensure({ baseCurrency: 'TJS' });
          const walletCur = new Map<string, string>(); // валюта кошелька, закреплённая операциями
          const wallets: string[] = [];
          const cats: string[] = [];
          const txs: string[] = [];
          const pick = (arr: string[], i: number) => arr[i % Math.max(arr.length, 1)];
          for (const op of ops) {
            now += 5;
            switch (op.t) {
              case 'wallet': {
                const w = await ok(s.wallets.create({ name: `W${wallets.length}`, currency: CURS[op.c]!, kind: 'cash', openingBalanceMinor: 1000, color: '#000', icon: 'x' }));
                if (w) wallets.push(w.id);
                break;
              }
              case 'cat': {
                const c = await ok(s.categories.create({ name: `C${cats.length}`, kind: op.kind ? 'income' : 'expense', color: '#000', icon: 'x' }));
                if (c) cats.push(c.id);
                break;
              }
              case 'tx': {
                const w = pick(wallets, op.w);
                const w2 = pick(wallets, op.w2);
                if (!w) break;
                const kind = (['expense', 'income', 'transfer'] as const)[op.kind];
                const base = (await s.settings.get())!.baseCurrency;
                const fx = { rate: 2.5, source: 'manual' };
                const t = await ok(
                  s.transactions.create({
                    kind, walletId: w, amountMinor: op.amt, occurredOn: '2026-10-05',
                    ...(kind === 'transfer' ? { toWalletId: w2, toAmountMinor: op.toAmt } : { categoryId: pick(cats, op.c) ?? null }),
                    fx,
                  } as never),
                );
                void base;
                if (t) txs.push(t.id);
                break;
              }
              case 'upd': {
                const id = pick(txs, op.tx);
                if (!id) break;
                const kind = (['expense', 'income', 'transfer'] as const)[op.kind];
                await ok(s.transactions.update(id, { amountMinor: op.amt, walletId: pick(wallets, op.w), kind, categoryId: kind === 'transfer' ? null : (pick(cats, op.cat) ?? null), fx: { rate: 3, source: 'manual' } } as never));
                break;
              }
              case 'del': { const id = pick(txs, op.tx); if (id) await ok(s.transactions.softDelete(id)); break; }
              case 'res': { const id = pick(txs, op.tx); if (id) await ok(s.transactions.restore(id)); break; }
              case 'arch': { const id = pick(wallets, op.w); if (id) await ok(s.wallets.archive(id)); break; }
              case 'unarch': { const id = pick(wallets, op.w); if (id) await ok(s.wallets.restore(id)); break; }
              case 'cur': { const id = pick(wallets, op.c); if (id) await ok(s.wallets.update(pick(wallets, op.w)!, { currency: CURS[op.c]! })); break; }
              case 'ckind': { const id = pick(cats, op.c); if (id && (await s.db.transactions.where('categoryId').equals(id).count()) === 0) { const c = await s.db.categories.get(id); await ok(s.categories.update(id, { kind: c!.kind === 'income' ? 'expense' : 'income' })); } break; }
              case 'base': await ok(s.settings.update({ baseCurrency: CURS[op.c]! })); break;
              case 'roundtrip': {
                // выгрузили из одного хранилища, загрузили в другое, потом обратно: ничего не должно ломаться
                const file = JSON.parse(JSON.stringify(await exportBackup(s)));
                await importBackup(spare, file);
                await importBackup(s, JSON.parse(JSON.stringify(await exportBackup(spare))));
                break;
              }
            }
            // ───── инварианты
            const w = new Map((await s.db.wallets.toArray()).map((x) => [x.id, x]));
            const c = new Map((await s.db.categories.toArray()).map((x) => [x.id, x]));
            const allTx = await s.db.transactions.toArray();
            for (const t of allTx) {
              if (t.deletedAt !== null) continue;
              expect(Number.isSafeInteger(t.amountMinor) && t.amountMinor > 0, 'сумма').toBe(true);
              expect(w.get(t.walletId)?.deletedAt, `кошелёк операции ${JSON.stringify(op)}`).toBeNull();
              if (t.kind === 'transfer') {
                expect(t.toWalletId).not.toBeNull();
                expect(t.toAmountMinor! > 0).toBe(true);
                expect(t.categoryId).toBeNull();
                expect(t.baseAmountMinor).toBe(0);
              } else {
                // снимок согласован с валютой кошелька и курсом
                const wc = w.get(t.walletId)!.currency;
                if (wc === t.baseCurrency) {
                  expect({ r: t.fxRate, s: t.fxSource, b: t.baseAmountMinor }, `снимок «same» ${JSON.stringify(op)}`).toEqual({ r: 1, s: 'same', b: t.amountMinor });
                } else {
                  expect(t.fxSource, `источник курса ${JSON.stringify(op)}`).not.toBe('same');
                  expect(t.baseAmountMinor, `снимок не сходится с курсом ${JSON.stringify(op)}`).toBe(convertMinor(t.amountMinor, wc, t.baseCurrency, t.fxRate!));
                }
                expect(t.toWalletId).toBeNull();
                if (t.categoryId) expect(c.get(t.categoryId)?.kind, `вид категории ${JSON.stringify(op)}`).toBe(t.kind);
              }
            }
            // валюта кошелька с операциями не меняется (пока на него ссылается хоть одна операция, в том числе удалённая)
            const referenced = new Set<string>();
            for (const t of allTx) for (const wid of [t.walletId, t.toWalletId]) if (wid) referenced.add(wid);
            for (const wid of [...walletCur.keys()]) if (!referenced.has(wid)) walletCur.delete(wid);
            for (const wid of referenced) {
              const cur = w.get(wid)!.currency;
              const prev = walletCur.get(wid);
              if (prev) expect(cur, `валюта кошелька с операциями изменилась ${JSON.stringify(op)}`).toBe(prev);
              else walletCur.set(wid, cur);
            }
            // остатки считаются без ошибок
            expect(() => computeBalances([...w.values()], allTx)).not.toThrow();
          }
        } finally {
          s.close();
          spare.close();
        }
      }),
      { numRuns: 300 },
    );
  });
});
