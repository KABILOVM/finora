import { describe, expect, it } from 'vitest';
import type { DebtInfo, DebtTx } from '@/domain/debts';
import { overpayGrowth } from './editOverpay';

const wallets = [
  { id: 'w-tjs', currency: 'TJS' },
  { id: 'w-usd', currency: 'USD' },
];

const lent: DebtInfo = { id: 'd1', direction: 'lent', principalMinor: 50_000, currency: 'TJS' };
const borrowed: DebtInfo = { ...lent, direction: 'borrowed' };

const tx = (id: string, kind: 'income' | 'expense', amountMinor: number, over: Partial<DebtTx> = {}): DebtTx => ({
  id,
  kind,
  walletId: 'w-tjs',
  amountMinor,
  occurredOn: '2026-10-05',
  createdAt: `2026-10-05T00:00:0${id.length}.000Z`,
  deletedAt: null,
  debtId: 'd1',
  ...over,
});

/** Правка: берём операцию как есть и меняем нужные поля. */
const edit = (t: DebtTx, over: Partial<Pick<DebtTx, 'kind' | 'walletId' | 'amountMinor' | 'occurredOn'>>) => ({
  kind: t.kind === 'transfer' ? 'expense' : t.kind,
  walletId: t.walletId,
  amountMinor: t.amountMinor,
  occurredOn: t.occurredOn,
  ...over,
});

describe('overpayGrowth: правка платежа делает переплату больше?', () => {
  const issue = tx('i', 'expense', 50_000);
  const pay = tx('p', 'income', 20_000);

  it('«200» → «2000» при долге 500: переплата 1500 — спрашиваем', () => {
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { amountMinor: 200_000 }))).toBe(150_000);
  });

  it('граница: платёж ровно на весь долг — не переплата, на одну диру больше — переплата', () => {
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { amountMinor: 50_000 }))).toBe(0);
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { amountMinor: 50_001 }))).toBe(1);
  });

  it('уменьшение, правка даты и той же суммы вопроса не вызывают', () => {
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { amountMinor: 100 }))).toBe(0);
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { occurredOn: '2026-10-09' }))).toBe(0);
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, {}))).toBe(0);
  });

  it('остальные платежи тоже считаются: 300 уже оплачено, ещё 300 → переплата 100', () => {
    const other = tx('q', 'income', 30_000);
    expect(overpayGrowth(lent, [issue, other, pay], wallets, 'p', edit(pay, { amountMinor: 30_000 }))).toBe(10_000);
    expect(overpayGrowth(lent, [issue, other, pay], wallets, 'p', edit(pay, { amountMinor: 20_000 }))).toBe(0);
  });

  it('удалённые платежи не считаются', () => {
    const gone = tx('g', 'income', 90_000, { deletedAt: '2026-10-06T00:00:00.000Z' });
    expect(overpayGrowth(lent, [issue, gone, pay], wallets, 'p', edit(pay, { amountMinor: 40_000 }))).toBe(0);
  });

  it('платёж, который уже был с переплатой: правка даты или уменьшение не спрашивают, рост — спрашивает', () => {
    const big = tx('b', 'income', 80_000); // переплата 300
    expect(overpayGrowth(lent, [issue, big], wallets, 'b', edit(big, { occurredOn: '2026-10-09' }))).toBe(0);
    expect(overpayGrowth(lent, [issue, big], wallets, 'b', edit(big, { amountMinor: 70_000 }))).toBe(0);
    expect(overpayGrowth(lent, [issue, big], wallets, 'b', edit(big, { amountMinor: 90_000 }))).toBe(40_000);
  });

  it('долг уже переплачен другим платежом: любое увеличение этого платежа — рост переплаты', () => {
    const big = tx('b', 'income', 60_000); // переплата 100 сама по себе
    const small = tx('s', 'income', 1_000);
    expect(overpayGrowth(lent, [issue, big, small], wallets, 's', edit(small, {}))).toBe(0);
    expect(overpayGrowth(lent, [issue, big, small], wallets, 's', edit(small, { amountMinor: 2_000 }))).toBe(12_000);
  });

  it('смена вида: выдача (расход) превращена в доход — это уже платёж, и он может переплатить', () => {
    expect(overpayGrowth(lent, [issue, pay], wallets, 'i', edit(issue, { kind: 'income', amountMinor: 40_000 }))).toBe(10_000);
    expect(overpayGrowth(lent, [issue, pay], wallets, 'i', edit(issue, { kind: 'income', amountMinor: 10_000 }))).toBe(0);
  });

  it('платёж, превращённый в выдачу или переведённый в кошелёк другой валюты, из платежей уходит: переплаты нет', () => {
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { kind: 'expense', amountMinor: 900_000 }))).toBe(0);
    expect(overpayGrowth(lent, [issue, pay], wallets, 'p', edit(pay, { walletId: 'w-usd', amountMinor: 900_000 }))).toBe(0);
  });

  it('«я должен»: платёж — расход, выдача — доход', () => {
    const got = tx('i', 'income', 50_000);
    const out = tx('p', 'expense', 20_000);
    expect(overpayGrowth(borrowed, [got, out], wallets, 'p', edit(out, { amountMinor: 200_000 }))).toBe(150_000);
    expect(overpayGrowth(borrowed, [got, out], wallets, 'i', edit(got, { amountMinor: 900_000 }))).toBe(0);
  });

  it('долг без платежей и операция чужого долга: чужая операция в расчёт не входит', () => {
    const foreign = tx('f', 'income', 900_000, { debtId: 'other' });
    expect(overpayGrowth(lent, [issue, foreign], wallets, 'f', edit(foreign, { amountMinor: 1 }))).toBe(0);
    expect(overpayGrowth(lent, [], wallets, 'nothing', { kind: 'income', walletId: 'w-tjs', amountMinor: 5, occurredOn: '2026-10-05' })).toBe(0);
  });

  it('переполнение: после правки суммы не помещаются в число — RangeError, а не неверный ответ', () => {
    const huge = tx('h', 'income', 9_000_000_000_000_000);
    const small = tx('s', 'income', 100);
    expect(() => overpayGrowth(lent, [issue, huge, small], wallets, 's', edit(small, { amountMinor: 9_000_000_000_000_000 }))).toThrow(RangeError);
  });

  it('переполнение уже было, а правка его чинит: спрашиваем про переплату, а не падаем', () => {
    const a = tx('a', 'income', 9_000_000_000_000_000);
    const b = tx('b', 'income', 9_000_000_000_000_000);
    expect(overpayGrowth(lent, [issue, a, b], wallets, 'b', edit(b, { amountMinor: 100 }))).toBe(9_000_000_000_000_100 - 50_000);
  });
});
