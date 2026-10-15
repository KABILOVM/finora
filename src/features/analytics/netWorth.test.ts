import { describe, expect, it } from 'vitest';
import { computeNetWorth, walletHistory, type NetDebt } from './netWorth';

const rates: Record<string, number> = { USD: 10.9 };
const getRate = (from: string, to: string) => (to === 'TJS' ? (rates[from] ?? null) : null);
const wallets = (totalMinor: number, over: Partial<Parameters<typeof computeNetWorth>[0]['wallets']> = {}) => ({ totalMinor, approximate: false, missing: [], ...over });
const debt = (direction: 'lent' | 'borrowed', remainingMinor: number, currency = 'TJS'): NetDebt => ({ direction, currency, remainingMinor });

describe('computeNetWorth: кошельки + мне должны − я должен', () => {
  it('всё в основной валюте: точная сумма, без «≈»', () => {
    const n = computeNetWorth({ wallets: wallets(100_000), debts: [debt('lent', 30_000), debt('lent', 5_000), debt('borrowed', 10_000)], base: 'TJS', getRate });
    expect(n).toEqual({ walletsMinor: 100_000, owedToMeMinor: 35_000, iOweMinor: 10_000, netMinor: 125_000, approximate: false, missing: [] });
  });

  it('долг в другой валюте пересчитывается по курсу, итог помечен приблизительным', () => {
    const n = computeNetWorth({ wallets: wallets(100_000), debts: [debt('lent', 1_000, 'USD')], base: 'TJS', getRate }); // 10 $ × 10,9 = 109 с.
    expect(n.owedToMeMinor).toBe(10_900);
    expect(n.netMinor).toBe(110_900);
    expect(n.approximate).toBe(true);
  });

  it('нет курса: долг НЕ входит в итог, это названо (валюта, сумма, где)', () => {
    const n = computeNetWorth({ wallets: wallets(100_000), debts: [debt('borrowed', 2_500, 'EUR'), debt('lent', 700, 'EUR')], base: 'TJS', getRate });
    expect(n.iOweMinor).toBe(0);
    expect(n.owedToMeMinor).toBe(0);
    expect(n.netMinor).toBe(100_000);
    expect(n.missing).toEqual([
      { currency: 'EUR', amountMinor: 700, where: 'owed' },
      { currency: 'EUR', amountMinor: 2_500, where: 'owe' },
    ]);
    expect(n.approximate).toBe(true);
  });

  it('валюты без курса среди кошельков переходят в missing как есть', () => {
    const n = computeNetWorth({
      wallets: wallets(50_000, { approximate: true, missing: [{ currency: 'EUR', balanceMinor: 9_000 }] }),
      debts: [],
      base: 'TJS',
      getRate,
    });
    expect(n.missing).toEqual([{ currency: 'EUR', amountMinor: 9_000, where: 'wallets' }]);
    expect(n.netMinor).toBe(50_000);
  });

  it('долгов больше денег — чистый капитал отрицательный', () => {
    expect(computeNetWorth({ wallets: wallets(10_000), debts: [debt('borrowed', 50_000)], base: 'TJS', getRate }).netMinor).toBe(-40_000);
  });

  it('нулевые и отрицательные остатки долгов ничего не добавляют', () => {
    const n = computeNetWorth({ wallets: wallets(100), debts: [debt('lent', 0), debt('borrowed', -5)], base: 'TJS', getRate });
    expect(n).toMatchObject({ owedToMeMinor: 0, iOweMinor: 0, netMinor: 100, approximate: false });
  });

  it('нет долгов вообще', () => {
    expect(computeNetWorth({ wallets: wallets(0), debts: [], base: 'TJS', getRate })).toMatchObject({ netMinor: 0, owedToMeMinor: 0, iOweMinor: 0 });
  });

  it('суммы не помещаются в безопасное целое — RangeError', () => {
    expect(() => computeNetWorth({ wallets: wallets(Number.MAX_SAFE_INTEGER), debts: [debt('lent', 10)], base: 'TJS', getRate })).toThrow(RangeError);
    expect(() => computeNetWorth({ wallets: wallets(0), debts: [debt('lent', Number.MAX_SAFE_INTEGER), debt('lent', 1)], base: 'TJS', getRate })).toThrow(RangeError);
  });
});

type Tx = Parameters<typeof walletHistory>[0][number];
let n = 0;
const tx = (over: Partial<Tx> & Pick<Tx, 'occurredOn' | 'kind' | 'baseAmountMinor'>): Tx =>
  ({
    id: `t${++n}`,
    walletId: 'w',
    toWalletId: null,
    categoryId: null,
    note: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    baseCurrency: 'TJS',
    ...over,
  }) as Tx;

describe('walletHistory: деньги в кошельках на конец месяцев', () => {
  const txs = [
    tx({ occurredOn: '2026-08-20', kind: 'expense', baseAmountMinor: 1_000 }),
    tx({ occurredOn: '2026-09-10', kind: 'income', baseAmountMinor: 10_000 }),
    tx({ occurredOn: '2026-10-05', kind: 'expense', baseAmountMinor: 3_000 }),
  ];

  it('обратный ход от сегодняшнего итога: конец августа, сентября и сегодня', () => {
    expect(walletHistory(txs, 20_000, '2026-10-15', 3, 'TJS')).toEqual([
      { month: '2026-08', balanceMinor: 13_000 },
      { month: '2026-09', balanceMinor: 23_000 },
      { month: '2026-10', balanceMinor: 20_000 },
    ]);
  });

  it('операции по долгам двигают кошелёк, хотя в доходы и расходы не входят', () => {
    const withDebt = [...txs, tx({ occurredOn: '2026-09-20', kind: 'expense', baseAmountMinor: 5_000, debtId: 'долг' })];
    // до 20 сентября денег было на 50 с. больше: конец августа — 18 000, конец сентября — те же 23 000
    expect(walletHistory(withDebt, 20_000, '2026-10-15', 3, 'TJS').map((p) => p.balanceMinor)).toEqual([18_000, 23_000, 20_000]);
  });

  it('один месяц — это сегодняшний итог; ни одного — пусто', () => {
    expect(walletHistory(txs, 20_000, '2026-10-15', 1, 'TJS')).toEqual([{ month: '2026-10', balanceMinor: 20_000 }]);
    expect(walletHistory(txs, 20_000, '2026-10-15', 0, 'TJS')).toEqual([]);
  });

  it('нет операций — ровная линия', () => {
    expect(walletHistory([], 777, '2026-10-15', 4, 'TJS').map((p) => p.balanceMinor)).toEqual([777, 777, 777, 777]);
  });

  it('через границу года и високосный февраль', () => {
    expect(walletHistory([], 1, '2027-02-10', 4, 'TJS').map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    const feb = [tx({ occurredOn: '2028-02-29', kind: 'income', baseAmountMinor: 4_000 }), tx({ occurredOn: '2028-03-01', kind: 'expense', baseAmountMinor: 1_500 })];
    // сегодня 10 000; 1 марта потратили 1 500 → на конец 29 февраля было 11 500 (операция 29-го уже учтена в этом числе)
    expect(walletHistory(feb, 10_000, '2028-03-05', 2, 'TJS')).toEqual([
      { month: '2028-02', balanceMinor: 11_500 },
      { month: '2028-03', balanceMinor: 10_000 },
    ]);
  });

  it('первый день нового месяца: прошлый месяц закончился вчера', () => {
    const p = walletHistory([tx({ occurredOn: '2026-10-01', kind: 'expense', baseAmountMinor: 100 })], 900, '2026-10-01', 2, 'TJS');
    expect(p).toEqual([
      { month: '2026-09', balanceMinor: 1_000 },
      { month: '2026-10', balanceMinor: 900 },
    ]);
  });

  it('операции с другой прежней основной валютой и удалённые не двигают линию', () => {
    const noise = [
      tx({ occurredOn: '2026-09-10', kind: 'income', baseAmountMinor: 99_999, baseCurrency: 'USD' }),
      tx({ occurredOn: '2026-09-11', kind: 'income', baseAmountMinor: 88_888, deletedAt: '2026-09-12T00:00:00.000Z' }),
    ];
    expect(walletHistory(noise, 500, '2026-10-15', 2, 'TJS').map((p) => p.balanceMinor)).toEqual([500, 500]);
  });

  it('очень большие суммы — RangeError, а не неверная линия', () => {
    const big = [tx({ occurredOn: '2026-09-10', kind: 'income', baseAmountMinor: Number.MAX_SAFE_INTEGER })];
    expect(() => walletHistory(big, -Number.MAX_SAFE_INTEGER, '2026-10-15', 2, 'TJS')).toThrow(RangeError);
  });
});
