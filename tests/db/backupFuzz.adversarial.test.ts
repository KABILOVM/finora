import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { defaultId, ensureSeeded, exportBackup, importBackup, uuidV5, type Store } from '@/db';
import { withoutSettings } from '@/features/settings/backupAccount';
import { makeStore, USER_A, USER_B } from './helpers';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function populate(store: Store, userId: string, seed: number) {
  const rand = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  await ensureSeeded(store);
  const food = await defaultId(userId, 'category:food');
  const cash = (await store.db.wallets.orderBy('sortOrder').first())!;
  const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  const usd = await store.wallets.create({ name: 'USD', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  const usd2 = await store.wallets.create({ name: 'USD2', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  const dates = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-11-02'];
  for (let i = 0; i < 40; i++) {
    const debts = (await store.db.debts.toArray()).filter((d) => d.deletedAt === null);
    const rules = (await store.db.recurring_rules.toArray()).filter((d) => d.deletedAt === null && d.archivedAt === null);
    const txs = (await store.db.transactions.toArray()).filter((d) => d.deletedAt === null);
    const r = rand();
    try {
      if (r < 0.08) await store.budgets.create({ categoryId: rand() < 0.5 ? food : null, amountMinor: 1000 });
      else if (r < 0.16) await store.debts.create({ direction: pick(['lent', 'borrowed'] as const), counterparty: `Д${i}`, principalMinor: 5000, currency: pick(['TJS', 'USD']), openedOn: '2026-10-01' });
      else if (r < 0.26) await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, frequency: 'weekly', startOn: '2026-10-05', categoryId: food, debtId: debts.find((d) => d.currency === 'TJS' && rand() < 0.5)?.id ?? null });
      else if (r < 0.36 && rules.length) await store.transactions.createFromRule(pick(rules).id, pick(dates));
      else if (r < 0.40 && rules.length) await store.transactions.skipOccurrence(pick(rules).id, pick(dates));
      else if (r < 0.50) await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 1000, toAmountMinor: pick([1000, 990, 950]), occurredOn: '2026-10-06' });
      else if (r < 0.56) await store.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: usd2.id, amountMinor: 1000, toAmountMinor: 990, occurredOn: '2026-10-06', fx: { rate: 10.9, source: 'manual' } });
      else if (r < 0.62) await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: '2026-10-06' });
      else if (r < 0.72 && debts.length) { const d = pick(debts); const w = d.currency === 'TJS' ? cash : usd; await store.transactions.create({ kind: pick(['income', 'expense'] as const), walletId: w.id, amountMinor: 100, occurredOn: '2026-10-07', debtId: d.id, ...(d.currency === 'USD' ? { fx: { rate: 10.9, source: 'manual' } } : {}) }); }
      else if (r < 0.80 && txs.length) await store.transactions.softDelete(pick(txs).id);
      else if (r < 0.86 && debts.length) await store.debts.close(pick(debts).id);
      else await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 123, occurredOn: '2026-10-07', categoryId: food });
    } catch {
      /* валидные отказы */
    }
  }
}

const noTime = <T extends { exportedAt: string }>(f: T) => ({ ...f, exportedAt: '' });

const seen = { debts: 0, rules: 0, ruleTx: 0, budgets: 0, fees: 0 };
describe('резервная копия v2: круги на случайных данных', () => {
  it('своя копия в чистую базу: бит в бит; повтор ничего не меняет', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const src = await makeStore({ factory: new IDBFactory(), userId: USER_A });
      await populate(src, USER_A, seed);
      const file = JSON.parse(JSON.stringify(await exportBackup(src)));
      const dst = await makeStore({ factory: new IDBFactory(), userId: USER_A });
      await importBackup(dst, file);
      try {
        expect(noTime(await exportBackup(dst))).toEqual(noTime(file));
        const again = await importBackup(dst, file);
        expect(again.added + again.replaced).toBe(0);
        expect(noTime(await exportBackup(dst))).toEqual(noTime(file));
      } catch (e) {
        bad.push(`seed ${seed}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('чужая копия (без настроек) в другой аккаунт: ссылки целы, id регулярных операций выведены из нового правила, бюджеты — канонические, повтор не плодит', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const src = await makeStore({ factory: new IDBFactory(), userId: USER_A });
      await populate(src, USER_A, seed);
      const file = JSON.parse(JSON.stringify(await exportBackup(src)));
      const dst = await makeStore({ factory: new IDBFactory(), userId: USER_B });
      await ensureSeeded(dst);
      try {
        await importBackup(dst, withoutSettings(file), { sourceUserId: USER_A });
        const out = await exportBackup(dst);
        seen.debts += out.debts.length; seen.rules += out.recurringRules.length; seen.budgets += out.budgets.length; seen.ruleTx += out.transactions.filter((t) => t.recurringRuleId).length; seen.fees += out.transactions.filter((t) => t.kind === 'transfer' && t.baseAmountMinor > 0).length;
        const dIds = new Set(out.debts.map((d) => d.id));
        const rIds = new Set(out.recurringRules.map((d) => d.id));
        for (const t of out.transactions) {
          if (t.debtId) expect(dIds.has(t.debtId)).toBe(true);
          if (t.recurringRuleId) {
            expect(rIds.has(t.recurringRuleId)).toBe(true);
            expect(t.id).toBe(await uuidV5(t.recurringRuleId, t.occurredOn));
          }
        }
        for (const b of out.budgets) expect(b.id).toBe(await defaultId(USER_B, `budget:${b.categoryId ?? 'total'}`));
        expect(new Set(out.budgets.map((b) => b.categoryId)).size).toBe(out.budgets.length);
        expect(out.transactions.length).toBe(file.transactions.length);
        expect(out.debts.length).toBe(file.debts.length);
        expect(out.recurringRules.length).toBe(file.recurringRules.length);
        const before = noTime(out);
        const again = await importBackup(dst, withoutSettings(file), { sourceUserId: USER_A });
        expect(again.added).toBe(0);
        expect(noTime(await exportBackup(dst))).toEqual(before);
        // деньги: суммы по кошелькам и комиссии не изменились
        const sum = (f: typeof file.transactions) => f.reduce((s: number, t: { baseAmountMinor: number; deletedAt: unknown; kind: string }) => s + (t.deletedAt === null && t.kind === 'transfer' ? t.baseAmountMinor : 0), 0);
        expect(sum(out.transactions)).toBe(sum(file.transactions));
      } catch (e) {
        bad.push(`seed ${seed}: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('данные не пустые', () => {
    expect(seen.debts).toBeGreaterThan(20);
    expect(seen.rules).toBeGreaterThan(20);
    expect(seen.ruleTx).toBeGreaterThan(20);
    expect(seen.budgets).toBeGreaterThan(10);
    expect(seen.fees).toBeGreaterThan(20);
  });
});
