import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { USER, openDevice, snapshotOf, type Device } from './engineHarness';

/** Слияние по группам против согласования (reconcile): валюта кошелька, вид категории, остатки. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pair() {
  const server = createMemoryServer();
  const off = { a: false, b: false };
  const mk = (id: string, key: 'a' | 'b') =>
    openDevice(server, id, {
      seed: true,
      wrap: (inner) => ({
        pull: async (t, s, l) => (off[key] ? Promise.reject(new TransportError('network', 'офлайн')) : inner.pull(t, s, l)),
        push: async (t, r) => (off[key] ? Promise.reject(new TransportError('network', 'офлайн')) : inner.push(t, r)),
      }),
    });
  const a = await mk('dev-a', 'a');
  const b = await mk('dev-b', 'b');
  await a.engine.syncNow();
  await b.engine.syncNow();
  return { server, a, b, off };
}

async function converge(devs: Device[], rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) for (const d of devs) await d.engine.syncNow();
}

async function consistent(d: Device, walletId: string): Promise<void> {
  const w = (await d.store.db.wallets.get(walletId))!;
  const txs = (await d.store.db.transactions.where('walletId').equals(walletId).toArray()).filter((t) => t.kind !== 'transfer');
  for (const t of txs) {
    expect(t.fxSource === 'same' ? w.currency === t.baseCurrency : w.currency !== t.baseCurrency, `${d.deviceId}: кошелёк ${w.currency}, операция ${t.fxSource}/${t.baseCurrency}`).toBe(true);
  }
}

describe.each([
  ['A синхронизируется первым', 'a'],
  ['B синхронизируется первым', 'b'],
] as const)('валюта кошелька против операции с другого устройства + слияние (%s)', (_name, first) => {
  it('A меняет валюту и имя пустого кошелька, B пишет расход в него: расход не меняет смысл, имя сохраняется', async () => {
    const { a, b, off } = await pair();
    const w = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#111111', icon: 'c' });
    await converge([a, b]);
    off.a = off.b = true;
    await a.store.wallets.update(w.id, { currency: 'USD', name: 'Долларовая' });
    await sleep(3);
    const tx = await b.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100_000, occurredOn: '2026-10-05', note: 'продукты' });
    off.a = off.b = false;
    await converge(first === 'a' ? [a, b] : [b, a]);
    for (const d of [a, b]) {
      await consistent(d, w.id);
      expect((await d.store.db.wallets.get(w.id))!.name).toBe('Долларовая');
    }
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
    const wal = (await a.store.db.wallets.get(w.id))!;
    expect(computeBalances([wal], await a.store.db.transactions.toArray()).get(w.id)).toBe(-100_000);
    expect(tx.id).toBeTruthy();
  });

  it('B меняет валюту пустого кошелька, а A (не зная) переименовывает его и пишет расход: расход не меняет смысл', async () => {
    const { a, b, off } = await pair();
    const w = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#111111', icon: 'c' });
    await converge([a, b]);
    off.a = off.b = true;
    await b.store.wallets.update(w.id, { currency: 'USD' });
    await sleep(3);
    await a.store.wallets.update(w.id, { name: 'Моя карта' });
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 50_000, occurredOn: '2026-10-05', note: 'кафе' });
    off.a = off.b = false;
    await converge(first === 'a' ? [a, b] : [b, a]);
    for (const d of [a, b]) {
      await consistent(d, w.id);
      expect((await d.store.db.wallets.get(w.id))!.name).toBe('Моя карта');
    }
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
  });

  it('вид категории: A меняет вид пустой категории и цвет, B пишет в неё расход: операция остаётся в категории своего вида', async () => {
    const { a, b, off } = await pair();
    const cat = await a.store.categories.create({ name: 'Прочее', kind: 'expense', color: '#111111', icon: 'x' });
    const wallet = (await a.store.db.wallets.toArray())[0]!;
    await converge([a, b]);
    off.a = off.b = true;
    await a.store.categories.update(cat.id, { kind: 'income', color: '#222222' });
    await sleep(3);
    await b.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 1_000, categoryId: cat.id, occurredOn: '2026-10-05' });
    off.a = off.b = false;
    await converge(first === 'a' ? [a, b] : [b, a]);
    for (const d of [a, b]) {
      const c = (await d.store.db.categories.get(cat.id))!;
      for (const t of await d.store.db.transactions.where('categoryId').equals(cat.id).toArray()) {
        if (t.deletedAt === null) expect(t.kind, `${d.deviceId}: категория ${c.kind}, операция ${t.kind}`).toBe(c.kind);
      }
      expect(c.color).toBe('#222222');
    }
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
  });
});

describe.each([
  ['A синхронизируется первым', 'a'],
  ['B синхронизируется первым', 'b'],
] as const)('операция переехала в категорию, пока вид категории менялся (%s)', (_name, first) => {
  it('A переносит существующую операцию в категорию и правит заметку, B меняет вид этой пустой категории: вид операции и категории согласованы', async () => {
    const { a, b, off } = await pair();
    const cat = await a.store.categories.create({ name: 'Прочее', kind: 'expense', color: '#111111', icon: 'x' });
    const wallet = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 5_000, occurredOn: '2026-10-05' });
    await converge([a, b]);
    off.a = off.b = true;
    await a.store.transactions.update(tx.id, { categoryId: cat.id, note: 'перенёс' });
    await sleep(3);
    await b.store.categories.update(cat.id, { kind: 'income' });
    off.a = off.b = false;
    await converge(first === 'a' ? [a, b] : [b, a]);
    for (const d of [a, b]) {
      const c = (await d.store.db.categories.get(cat.id))!;
      const t = (await d.store.db.transactions.get(tx.id))!;
      if (t.categoryId === cat.id && t.deletedAt === null) expect(t.kind, `${d.deviceId}: категория ${c.kind}, операция ${t.kind}`).toBe(c.kind);
      expect(t.note).toBe('перенёс');
    }
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
  });

  it('A меняет вид операции с расхода на доход (с категорией дохода), B в это время меняет её дату и удаляет категорию-расход: ничего не ломается', async () => {
    const { a, b, off } = await pair();
    const exp = await a.store.categories.create({ name: 'Р', kind: 'expense', color: '#111111', icon: 'x' });
    const inc = await a.store.categories.create({ name: 'Д', kind: 'income', color: '#111111', icon: 'x' });
    const wallet = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 5_000, categoryId: exp.id, occurredOn: '2026-10-05' });
    await converge([a, b]);
    off.a = off.b = true;
    await a.store.transactions.update(tx.id, { kind: 'income', categoryId: inc.id });
    await sleep(3);
    await b.store.transactions.update(tx.id, { occurredOn: '2026-10-01' });
    await b.store.categories.archive(exp.id);
    off.a = off.b = false;
    await converge(first === 'a' ? [a, b] : [b, a]);
    const s = await snapshotOf(a.store);
    expect(await snapshotOf(b.store)).toEqual(s);
    const t = s.transactions.find((x) => x.id === tx.id)!;
    expect([t.kind, t.categoryId, t.occurredOn]).toEqual(['income', inc.id, '2026-10-01']);
    const c = s.categories.find((x) => x.id === t.categoryId)!;
    expect(c.kind).toBe(t.kind);
  });
});

describe('несколько кошельков и перевод между ними', () => {
  it('перевод между кошельками разных валют: A правит сумму списания и заметку, B правит сумму зачисления: сумма и снимок едины', async () => {
    const { a, b, off, server } = await pair();
    const w1 = (await a.store.db.wallets.toArray())[0]!;
    const w2 = await a.store.wallets.create({ name: 'USD', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'c' });
    const tx = await a.store.transactions.create({ kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: 100_00, toAmountMinor: 10_00, occurredOn: '2026-10-05' });
    await converge([a, b]);
    off.a = off.b = true;
    await a.store.transactions.update(tx.id, { amountMinor: 200_00, toAmountMinor: 20_00, note: 'курс 10' });
    await sleep(3);
    await b.store.transactions.update(tx.id, { toAmountMinor: 11_00 });
    off.a = off.b = false;
    await converge([a, b]);
    const s = await snapshotOf(a.store);
    expect(await snapshotOf(b.store)).toEqual(s);
    const row = s.transactions.find((t) => t.id === tx.id)!;
    // сумма и зачисление принадлежат одной группе: либо (200,20), либо (100,11); смесь (200,11) — деньги из воздуха
    expect([[200_00, 20_00], [100_00, 11_00]]).toContainEqual([row.amountMinor, row.toAmountMinor]);
    expect(server.dump(USER, 'transactions').find((t) => t['id'] === tx.id)!['amount_minor']).toBe(row.amountMinor);
  });
});
