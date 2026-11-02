import { describe, expect, it } from 'vitest';
import {
  dailyAllowance,
  daysLeft,
  rateFromAmounts,
  tripExchanges,
  tripNetCost,
  tripRates,
  tripWalletIds,
  tripWalletMoney,
  type Exchange,
} from './tripRates';
import type { TripTx } from './trips';

const BASE = 'TJS';
let seq = 0;
const transfer = (over: Partial<TripTx> & { walletId: string; toWalletId: string; amountMinor: number; toAmountMinor: number }): TripTx => ({
  id: `x${String(++seq).padStart(4, '0')}`,
  kind: 'transfer',
  categoryId: null,
  baseAmountMinor: 0,
  baseCurrency: BASE,
  occurredOn: '2026-10-01',
  note: 'Обмен #Самарканд',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  createdAt: `2026-10-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  ...over,
});
const currencyOf = new Map<string, 'TJS' | 'USD' | 'AED' | 'UZS'>([
  ['tjs', 'TJS'],
  ['tjs2', 'TJS'],
  ['usd', 'USD'],
  ['aed', 'AED'],
  ['uzs', 'UZS'],
]);

describe('rateFromAmounts', () => {
  it('курс = отдано сомони ÷ получено валюты (в основных единицах)', () => {
    // 1000 с. = 100000 дирамов, 90 $ = 9000 центов → 11,111… с. за доллар
    expect(rateFromAmounts(9000, 100000, 'USD', 'TJS')).toBeCloseTo(11.1111111111, 9);
  });
  it('валюта без копеек (вона): единицы считаются по её знакам', () => {
    // 10 с. = 1000 дирамов за 4000 вон → 0,0025 с. за вону
    expect(rateFromAmounts(4000, 1000, 'KRW', 'TJS')).toBeCloseTo(0.0025, 10);
  });
  it('нулевые суммы — null', () => {
    expect(rateFromAmounts(0, 100, 'USD', 'TJS')).toBeNull();
    expect(rateFromAmounts(100, 0, 'USD', 'TJS')).toBeNull();
  });
});

describe('tripExchanges', () => {
  it('берёт только живые переводы между РАЗНЫМИ валютами с меткой поездки', () => {
    const txs: TripTx[] = [
      transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 100000, toAmountMinor: 9000 }),
      transfer({ walletId: 'tjs', toWalletId: 'tjs2', amountMinor: 5000, toAmountMinor: 5000 }), // одна валюта
      transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 5000, toAmountMinor: 400, note: 'без метки' }),
      transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 5000, toAmountMinor: 400, note: '#Баку' }),
      transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 5000, toAmountMinor: 400, deletedAt: '2026-10-02T00:00:00.000Z' }),
    ];
    const ex = tripExchanges(txs, 'самарканд', currencyOf);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 9000 });
  });

  it('идут по порядку дат, а при равных датах — по времени внесения', () => {
    const late = transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 2, toAmountMinor: 1, occurredOn: '2026-10-03' });
    const early = transfer({ walletId: 'tjs', toWalletId: 'usd', amountMinor: 3, toAmountMinor: 1, occurredOn: '2026-10-01' });
    expect(tripExchanges([late, early], 'самарканд', currencyOf).map((e) => e.fromMinor)).toEqual([3, 2]);
  });

  it('кошелёк неизвестен (удалён из списка) — перевод пропускается', () => {
    const t = transfer({ walletId: 'tjs', toWalletId: 'ghost', amountMinor: 100, toAmountMinor: 10 });
    expect(tripExchanges([t], 'самарканд', currencyOf)).toEqual([]);
  });
});

const ex = (over: Partial<Exchange> & Pick<Exchange, 'fromCurrency' | 'toCurrency' | 'fromMinor' | 'toMinor'>): Exchange => ({
  txId: `e${++seq}`,
  occurredOn: '2026-10-01',
  fromWalletId: over.fromCurrency === 'TJS' ? 'tjs' : over.fromCurrency.toLowerCase(),
  toWalletId: over.toCurrency === 'TJS' ? 'tjs' : over.toCurrency.toLowerCase(),
  ...over,
});

describe('tripRates: средневзвешенный курс', () => {
  it('один обмен: 1000 с. → 90 $', () => {
    const r = tripRates([ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 9000 })], BASE);
    expect(r.rates.get('USD')?.rate).toBeCloseTo(11.1111111111, 9);
    expect(r.paidMinor).toBe(100000);
  });

  it('два обмена по разным курсам: всего отдано ÷ всего получено', () => {
    // 100 $ за 1100 с. (11,0) и 50 $ за 565 с. (11,3) → 1665 с. за 150 $ = 11,1
    const r = tripRates(
      [
        ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 110000, toMinor: 10000 }),
        ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 56500, toMinor: 5000 }),
      ],
      BASE,
    );
    const usd = r.rates.get('USD');
    expect(usd?.rate).toBeCloseTo(11.1, 9);
    expect(usd?.unitsMinor).toBe(15000);
    expect(usd?.costMinor).toBe(166500);
    expect(usd?.exchanges).toBe(2);
  });

  it('цепочка сомони → доллары → дирхамы: дирхам оценивается по цене отданных долларов', () => {
    // 1000 с. → 100 $ (10 с. за $); 50 $ → 183 AED: 50 $ стоят 500 с., значит 1 AED = 500 / 183 с.
    const r = tripRates(
      [
        ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 10000 }),
        ex({ fromCurrency: 'USD', toCurrency: 'AED', fromMinor: 5000, toMinor: 18300 }),
      ],
      BASE,
    );
    expect(r.rates.get('USD')?.rate).toBeCloseTo(10, 9);
    expect(r.rates.get('AED')?.rate).toBeCloseTo(500 / 183, 9);
    expect(r.paidMinor).toBe(100000); // с долларов на дирхамы сомони не добавились
  });

  it('несколько валют в одной поездке: у каждой свой курс', () => {
    const r = tripRates(
      [
        ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 110000, toMinor: 10000 }),
        ex({ fromCurrency: 'TJS', toCurrency: 'UZS', fromMinor: 10000, toMinor: 1200000 }),
      ],
      BASE,
    );
    expect(r.rates.get('USD')?.rate).toBeCloseTo(11, 9);
    expect(r.rates.get('UZS')?.rate).toBeCloseTo(100 / 12000, 9);
  });

  it('возврат остатка в сомони курс не меняет, но считает курсовую потерю', () => {
    // 100 $ за 1000 с.; потом 30 $ вернули за 285 с. (по курсу поездки они стоили 300 с.)
    const r = tripRates(
      [
        ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 10000 }),
        ex({ fromCurrency: 'USD', toCurrency: 'TJS', fromMinor: 3000, toMinor: 28500 }),
      ],
      BASE,
    );
    expect(r.rates.get('USD')?.rate).toBeCloseTo(10, 9);
    expect(r.returnedMinor).toBe(28500);
    expect(r.returnCostMinor).toBe(30000);
    expect(tripNetCost(123400, r)).toEqual({ netMinor: 124900, lossMinor: 1500 });
  });

  it('без возврата итог «с учётом возврата» не нужен', () => {
    const r = tripRates([ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 10000 })], BASE);
    expect(tripNetCost(5000, r)).toBeNull();
  });

  it('валюта, которой нет в обменах поездки, оценивается запасным курсом; нет его — обмен пропускается', () => {
    const chain = [ex({ fromCurrency: 'USD', toCurrency: 'AED', fromMinor: 5000, toMinor: 18300 })];
    expect(tripRates(chain, BASE).rates.size).toBe(0);
    const withFallback = tripRates(chain, BASE, (c) => (c === 'USD' ? 11 : null));
    expect(withFallback.rates.get('AED')?.rate).toBeCloseTo(550 / 183, 9);
  });

  it('нет обменов — нет курсов', () => {
    const r = tripRates([], BASE);
    expect(r.rates.size).toBe(0);
    expect(r.paidMinor).toBe(0);
  });
});

describe('кошельки поездки и остаток в сомони', () => {
  const exchanges = [
    ex({ fromCurrency: 'TJS', toCurrency: 'USD', fromMinor: 100000, toMinor: 10000 }),
    ex({ fromCurrency: 'USD', toCurrency: 'AED', fromMinor: 5000, toMinor: 18300 }),
    ex({ fromCurrency: 'USD', toCurrency: 'TJS', fromMinor: 1000, toMinor: 9000 }),
  ];

  it('tripWalletIds: куда обменивали (кроме основной валюты)', () => {
    const ids = tripWalletIds(exchanges, BASE);
    expect([...ids.keys()].sort()).toEqual(['AED', 'USD']);
    expect(ids.get('USD')).toEqual(['usd']);
  });

  it('остаток 320 $ по курсу 11 — в сомони; нет курса — null; пустой кошелёк — 0', () => {
    const ids = new Map([
      ['USD', ['usd']],
      ['AED', ['aed']],
    ]);
    const rates = new Map([['USD', { currency: 'USD', rate: 11, unitsMinor: 1, costMinor: 1, exchanges: 1, lastOn: '2026-10-01' }]]);
    const balances = new Map([
      ['usd', 32000],
      ['aed', 0],
    ]);
    const money = tripWalletMoney(ids, balances, rates, BASE);
    expect(money.find((m) => m.currency === 'USD')).toMatchObject({ balanceMinor: 32000, valueMinor: 352000 });
    expect(money.find((m) => m.currency === 'AED')).toMatchObject({ balanceMinor: 0, valueMinor: 0 });
    const noRate = tripWalletMoney(ids, new Map([['aed', 500]]), rates, BASE);
    expect(noRate.find((m) => m.currency === 'AED')?.valueMinor).toBeNull();
  });
});

describe('«сколько можно тратить в день»', () => {
  const plan = { startOn: '2026-10-01', days: 10 };

  it('daysLeft: считая сегодняшний; до начала — все дни; после конца — один', () => {
    expect(daysLeft(plan, '2026-09-30')).toBe(10);
    expect(daysLeft(plan, '2026-10-01')).toBe(10);
    expect(daysLeft(plan, '2026-10-04')).toBe(7);
    expect(daysLeft(plan, '2026-10-10')).toBe(1);
    expect(daysLeft(plan, '2026-10-20')).toBe(1);
  });

  it('остаток на начало дня делится на оставшиеся дни, вниз', () => {
    // остался 320 $, сегодня уже потратили 20 $, до конца 7 дней: (320 + 20) / 7 = 48,57 → 48 $
    const a = dailyAllowance(32000, 2000, 7);
    expect(a.perDayMinor).toBe(4857);
    expect(a.leftTodayMinor).toBe(4857 - 2000);
    expect(a.daysLeft).toBe(7);
  });

  it('потратили больше дневной нормы — «осталось на сегодня» отрицательное', () => {
    const a = dailyAllowance(1000, 9000, 5);
    expect(a.perDayMinor).toBe(2000);
    expect(a.leftTodayMinor).toBe(-7000);
  });

  it('остаток ушёл в минус — норма не отрицательная', () => {
    expect(dailyAllowance(-500, 0, 3).perDayMinor).toBe(0);
  });

  it('дней меньше единицы считается как один', () => {
    expect(dailyAllowance(1000, 0, 0).perDayMinor).toBe(1000);
  });
});
