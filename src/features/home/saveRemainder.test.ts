import { describe, expect, it } from 'vitest';
import { MIN_NET_SHARE_PERCENT, remainderSuggestion, SAVE_UNTIL_DAY, type RemainderInput } from './saveRemainder';

const wallet = (id: string, over: Partial<RemainderInput['wallets'][number]> = {}) => ({ id, name: id, kind: 'cash' as const, currency: 'TJS', archivedAt: null, ...over });

const input = (over: Partial<RemainderInput> = {}): RemainderInput => ({
  today: '2026-10-03',
  base: 'TJS',
  previous: { incomeMinor: 500_000, expenseMinor: 380_000 }, // осталось 1 200
  wallets: [wallet('cash'), wallet('card', { kind: 'card' }), wallet('trip', { kind: 'savings' })],
  balances: new Map([
    ['cash', 100_000],
    ['card', 400_000],
    ['trip', 50_000],
  ]),
  openGoalIds: ['trip'],
  reachedGoalIds: new Set(),
  transferredTo: new Set(),
  ...over,
});

describe('remainderSuggestion: «Отложить остаток»', () => {
  it('прошлый месяц с плюсом, есть накопление и деньги на обычном кошельке — предложение: сколько, откуда, куда', () => {
    expect(remainderSuggestion(input())).toEqual({
      month: '2026-09',
      netMinor: 120_000,
      amountMinor: 120_000,
      from: { id: 'card', name: 'card' }, // самый большой остаток среди обычных кошельков
      to: { id: 'trip', name: 'trip' },
    });
  });

  it('только в первые дни месяца', () => {
    expect(SAVE_UNTIL_DAY).toBe(7);
    expect(remainderSuggestion(input({ today: '2026-10-07' }))).not.toBeNull();
    expect(remainderSuggestion(input({ today: '2026-10-08' }))).toBeNull();
  });

  it('остаток прошлого месяца: ноль или минус — предлагать нечего; меньше 5% дохода — тоже', () => {
    expect(remainderSuggestion(input({ previous: { incomeMinor: 500_000, expenseMinor: 500_000 } }))).toBeNull();
    expect(remainderSuggestion(input({ previous: { incomeMinor: 500_000, expenseMinor: 600_000 } }))).toBeNull();
    expect(MIN_NET_SHARE_PERCENT).toBe(5);
    expect(remainderSuggestion(input({ previous: { incomeMinor: 500_000, expenseMinor: 475_001 } }))).toBeNull(); // 4,9998%
    expect(remainderSuggestion(input({ previous: { incomeMinor: 500_000, expenseMinor: 475_000 } }))?.netMinor).toBe(25_000); // ровно 5%
  });

  it('сумма — остаток, но не больше денег на кошельке-источнике', () => {
    const s = remainderSuggestion(input({ balances: new Map([['cash', 30_000], ['card', 40_000], ['trip', 0]]) }))!;
    expect(s.amountMinor).toBe(40_000);
    expect(s.netMinor).toBe(120_000);
  });

  it('нет кошелька-накопления, или он не в основной валюте, или в архиве, или цель достигнута — предлагать нечего', () => {
    expect(remainderSuggestion(input({ wallets: [wallet('cash'), wallet('card', { kind: 'card' })] }))).toBeNull();
    expect(remainderSuggestion(input({ wallets: [wallet('cash'), wallet('trip', { kind: 'savings', currency: 'USD' })] }))).toBeNull();
    expect(remainderSuggestion(input({ wallets: [wallet('cash'), wallet('trip', { kind: 'savings', archivedAt: '2026-01-01T00:00:00.000Z' })] }))).toBeNull();
    expect(remainderSuggestion(input({ openGoalIds: [], reachedGoalIds: new Set(['trip']) }))).toBeNull();
  });

  it('цель с ближайшим сроком — первая в списке; без целей — первое накопление', () => {
    const wallets = [wallet('cash'), wallet('a', { kind: 'savings' }), wallet('b', { kind: 'savings' })];
    const balances = new Map([['cash', 200_000]]);
    expect(remainderSuggestion(input({ wallets, balances, openGoalIds: ['b', 'a'] }))?.to.id).toBe('b');
    expect(remainderSuggestion(input({ wallets, balances, openGoalIds: [] }))?.to.id).toBe('a');
  });

  it('уже откладывали на накопление в этом месяце — не предлагаем второй раз', () => {
    expect(remainderSuggestion(input({ transferredTo: new Set(['trip']) }))).toBeNull();
    expect(remainderSuggestion(input({ transferredTo: new Set(['card']) }))).not.toBeNull(); // перевод на обычный кошелёк — не откладывание
  });

  it('не из чего: на обычных кошельках пусто или минус', () => {
    expect(remainderSuggestion(input({ balances: new Map([['cash', 0], ['card', -5_000], ['trip', 90_000]]) }))).toBeNull();
  });

  it('кошельки в другой валюте источником не бывают (перевод между валютами не предлагаем)', () => {
    const wallets = [wallet('usd', { currency: 'USD' }), wallet('trip', { kind: 'savings' })];
    expect(remainderSuggestion(input({ wallets, balances: new Map([['usd', 999_999]]) }))).toBeNull();
  });

  it('граница года: в январе «прошлый месяц» — декабрь прошлого года', () => {
    expect(remainderSuggestion(input({ today: '2027-01-02' }))?.month).toBe('2026-12');
  });
});
