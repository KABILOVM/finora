import { describe, expect, it } from 'vitest';
import { basics, makeStore } from '../../tests/db/helpers';
import { runAutoPost } from './autoPost';

/**
 * Атаки, которые код ВЫДЕРЖАЛ (зелёные регрессионные тесты): гонка проходов, переполнение курса, 29 февраля, странные тексты.
 */

const toLocal = (iso: string) => iso.slice(0, 10);
const LONG_AGO = '2026-01-01T00:00:00.000Z';
type TestStore = Awaited<ReturnType<typeof makeStore>>;

const run = (store: TestStore, today: string, getRate: Parameters<typeof runAutoPost>[0]['getRate'] = () => null) =>
  runAutoPost({ store, today, getRate, toLocal });

async function oldRule(store: TestStore, input: Parameters<TestStore['recurring']['create']>[0], createdAt = LONG_AGO) {
  const rule = await store.recurring.create({ autoPost: 1, ...input });
  await store.db.recurring_rules.update(rule.id, { createdAt, clientUpdatedAt: createdAt });
  return rule;
}

describe('автопроведение выдерживает', () => {
  it('десять проходов одновременно: операций ровно столько, сколько дат, дублей нет', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await oldRule(store, { kind: 'expense', walletId: cash.id, amountMinor: 100, frequency: 'daily', startOn: '2026-01-01', note: 'а' });
    await oldRule(store, { kind: 'expense', walletId: cash.id, amountMinor: 200, frequency: 'daily', startOn: '2026-01-01', note: 'б' });
    await Promise.all(Array.from({ length: 10 }, () => run(store, '2026-10-11')));
    // окно: 2026-08-12 … 2026-10-11 = 61 день у каждого из двух правил
    expect(await store.db.transactions.count()).toBe(122);
    expect(new Set((await store.db.transactions.toArray()).map((t) => t.id)).size).toBe(122);
  });

  it('сумма, которая в базовой валюте не помещается в границы сервера: ошибка у этого правила, остальные проведены, правило цело', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const huge = await oldRule(store, { kind: 'expense', walletId: usd.id, amountMinor: 999_999_999_999_999, frequency: 'daily', startOn: '2026-10-11', note: 'огромный' });
    await oldRule(store, { kind: 'expense', walletId: cash.id, amountMinor: 100, frequency: 'daily', startOn: '2026-10-11', note: 'обычный' });
    const rate = { rate: 10.9, source: 'nbt', asOf: '2026-10-10', stale: false, manual: false };
    const r = await run(store, '2026-10-11', (a, b) => (a === 'USD' && b === 'TJS' ? rate : null));
    expect(r.posted).toBe(1);
    expect(r.failures.get(huge.id)?.kind).toBe('error');
    expect(await store.db.recurring_rules.get(huge.id)).toMatchObject({ amountMinor: 999_999_999_999_999, autoPost: 1 });
    expect((await store.db.transactions.toArray()).map((t) => t.note)).toEqual(['обычный']);
  });

  it('29 февраля: годовой платёж в невисокосный год проводится 28 февраля, в високосный — 29-го, и по одному разу', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await oldRule(store, { kind: 'expense', walletId: cash.id, amountMinor: 100, frequency: 'yearly', startOn: '2024-02-29', note: 'страховка' }, '2024-02-01T00:00:00.000Z');
    await run(store, '2027-02-28');
    await run(store, '2027-03-01');
    await run(store, '2028-02-29');
    await run(store, '2028-02-29');
    expect((await store.db.transactions.toArray()).map((t) => t.occurredOn).sort()).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('название с ё, эмодзи, правосторонними символами и длинным словом попадает в операцию как есть', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const note = 'Ёлка 🎄 ‏שלום‎ ' + 'Ж'.repeat(60);
    await oldRule(store, { kind: 'expense', walletId: cash.id, amountMinor: 100, frequency: 'daily', startOn: '2026-10-11', note });
    await run(store, '2026-10-11');
    expect((await store.db.transactions.toArray())[0]?.note).toBe(note.trim());
  });
});
