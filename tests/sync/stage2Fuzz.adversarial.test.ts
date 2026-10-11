// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { exportBackup, defaultId, type Store } from '@/db';
import { createMemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES } from '@/sync/tables';
import { openDevice, type Device } from './engineHarness';
import { USER } from './engineHarness';

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

const BASE = Date.UTC(2026, 9, 10, 12, 0, 0);
const DATES = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];

async function scenario(seed: number): Promise<string[]> {
  const rand = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const server = createMemoryServer();
  const clocks = [BASE, BASE + 90_000, BASE - 45_000];
  const devs: Device[] = [];
  for (let i = 0; i < 3; i++) {
    const d = await openDevice(server, `dev-${'abc'[i]}`, { seed: true, now: () => clocks[i]! });
    await d.engine.syncNow();
    devs.push(d);
  }
  const food = await defaultId(USER, 'category:food');
  const cash = (await devs[0]!.store.db.wallets.orderBy('sortOrder').first())!;
  const problems: string[] = [];
  const steps = 40 + Math.floor(rand() * 40);
  for (let s = 0; s < steps; s++) {
    const i = Math.floor(rand() * 3);
    const d = devs[i]!;
    const st: Store = d.store;
    clocks[i]! += 1000 + Math.floor(rand() * 5000);
    for (let k = 0; k < 3; k++) clocks[k]! += 100;
    const debts = (await st.db.debts.toArray()).filter((x) => x.deletedAt === null);
    const rules = (await st.db.recurring_rules.toArray()).filter((x) => x.deletedAt === null);
    const buds = (await st.db.budgets.toArray()).filter((x) => x.deletedAt === null);
    const txs = (await st.db.transactions.toArray()).filter((x) => x.deletedAt === null);
    const r = rand();
    try {
      if (r < 0.08) await st.budgets.create({ categoryId: rand() < 0.5 ? food : null, amountMinor: 1000 + Math.floor(rand() * 9000) });
      else if (r < 0.12 && buds.length) { const b = pick(buds); await (rand() < 0.5 ? st.budgets.archive(b.id) : st.budgets.update(b.id, { amountMinor: 500 + Math.floor(rand() * 9000) })); }
      else if (r < 0.16 && buds.length) { await st.budgets.restore(pick(buds).id); }
      else if (r < 0.22) await st.debts.create({ direction: rand() < 0.5 ? 'lent' : 'borrowed', counterparty: `Д${s}`, principalMinor: 1000 + Math.floor(rand() * 90_000), currency: 'TJS', openedOn: '2026-10-01' });
      else if (r < 0.28 && debts.length) { const x = pick(debts); const q = rand(); await (q < 0.25 ? st.debts.close(x.id) : q < 0.5 ? st.debts.reopen(x.id) : q < 0.75 ? st.debts.update(x.id, { note: `n${s}` }) : st.debts.archive(x.id)); }
      else if (r < 0.34) await st.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 100 + Math.floor(rand() * 900), frequency: pick(['daily', 'weekly', 'monthly'] as const), startOn: '2026-10-05', debtId: debts.length && rand() < 0.4 ? pick(debts).id : null });
      else if (r < 0.4 && rules.length) { const x = pick(rules); const q = rand(); await (q < 0.3 ? st.recurring.update(x.id, { autoPost: rand() < 0.5 ? 1 : 0 }) : q < 0.6 ? st.recurring.update(x.id, { amountMinor: 50 + Math.floor(rand() * 900) }) : q < 0.8 ? st.recurring.archive(x.id) : st.recurring.restore(x.id)); }
      else if (r < 0.52 && rules.length) { const x = pick(rules); await st.transactions.createFromRule(x.id, pick(DATES)); }
      else if (r < 0.56 && rules.length) { const x = pick(rules); await st.transactions.skipOccurrence(x.id, pick(DATES)); }
      else if (r < 0.64 && debts.length) { const x = pick(debts); await st.transactions.create({ kind: rand() < 0.5 ? 'income' : 'expense', walletId: cash.id, amountMinor: 100 + Math.floor(rand() * 900), occurredOn: '2026-10-06', debtId: x.id }); }
      else if (r < 0.7 && txs.length) { const x = pick(txs); const q = rand(); await (q < 0.5 ? st.transactions.update(x.id, { note: `m${s}` }) : q < 0.8 ? st.transactions.update(x.id, { amountMinor: 10 + Math.floor(rand() * 900) }) : st.transactions.softDelete(x.id)); }
      else if (r < 0.74) await st.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-07', categoryId: food });
      else if (r < 0.9) { server.setOnline(rand() < 0.7 ? true : false); await d.engine.syncNow(); server.setOnline(true); }
    } catch (e) {
      // валидные отказы репозиториев допустимы
      if (!(e instanceof Error) || !/Error$|Validation|Fx/.test(e.name)) problems.push(`unexpected ${String(e)}`);
    }
  }
  server.setOnline(true);
  for (let i = 0; i < 6; i++) for (const d of devs) await d.engine.syncNow();
  const seqs = () => SYNC_TABLES.map((t) => server.dump(USER, t).map((r) => r.server_seq).join(','));
  const before = seqs();
  for (let i = 0; i < 4; i++) for (const d of devs) await d.engine.syncNow();
  if (JSON.stringify(before) !== JSON.stringify(seqs())) problems.push(`ping-pong: server_seq продолжает расти после схождения (seed ${seed})`);
  const st = await Promise.all(devs.map(async (d) => ({ ...(await exportBackup(d.store)), exportedAt: '' })));
  try {
    expect(st[1]).toEqual(st[0]);
    expect(st[2]).toEqual(st[0]);
  } catch (e) {
    problems.push(`diverged seed ${seed}: ${(e as Error).message.slice(0, 300)}`);
  }
  for (const d of devs) {
    const s = d.engine.getStatus();
    if (s.pending !== 0 || s.quarantined !== 0) problems.push(`status ${d.deviceId} ${JSON.stringify(s)}`);
  }
  // ссылочная целостность и уникальность
  const b = st[0]!;
  const dIds = new Set(b.debts.map((x) => x.id));
  const rIds = new Set(b.recurringRules.map((x) => x.id));
  for (const t of b.transactions) {
    if (t.debtId && !dIds.has(t.debtId)) problems.push(`tx ${t.id} dangling debt`);
    if (t.recurringRuleId && !rIds.has(t.recurringRuleId)) problems.push(`tx ${t.id} dangling rule`);
  }
  const live = b.budgets.filter((x) => x.deletedAt === null);
  const cats = live.map((x) => x.categoryId);
  if (new Set(cats).size !== cats.length) problems.push('duplicate budgets');
  for (const t of SYNC_TABLES) {
    const n = server.dump(USER, t).length;
    const local = t === 'settings' ? b.settings ? 1 : 0 : t === 'wallets' ? b.wallets.length : t === 'categories' ? b.categories.length : t === 'transactions' ? b.transactions.length : t === 'budgets' ? b.budgets.length : t === 'debts' ? b.debts.length : b.recurringRules.length;
    if (n !== local) problems.push(`server ${t} ${n} != local ${local}`);
  }
  if (process.env['ADV_VERBOSE']) console.log(`seed ${seed}: budgets=${b.budgets.length} debts=${b.debts.length} rules=${b.recurringRules.length} txs=${b.transactions.length} skipped=${b.transactions.filter((t) => t.deletedAt).length}`);
  return problems;
}

describe('фаззинг сущностей этапа 2 на трёх устройствах (память)', () => {
  it('сходятся, без карантина, ссылки целы, один бюджет на категорию', async () => {
    const bad: string[] = [];
    const n = Number(process.env['ADV_SEEDS'] ?? 25);
    for (let seed = 1; seed <= n; seed++) {
      const p = await scenario(seed);
      for (const x of p) bad.push(`seed ${seed}: ${x}`);
    }
    expect(bad).toEqual([]);
  }, 600_000);
});
