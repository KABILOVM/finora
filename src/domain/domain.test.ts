import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addMinor,
  convertMinor,
  formatMinor,
  fxSnapshot,
  minorToInputString,
  parseAmountToMinor,
  sumMinor,
} from './money';
import { computeBalances, findBalanceIssues } from './balances';
import { crossRate, pickRate } from './rates';
import type { RateTable } from './types';

const NBSP = ' ';

describe('parseAmountToMinor', () => {
  it('разбирает запятую, точку и пробелы тысяч', () => {
    expect(parseAmountToMinor('12,5', 'TJS')).toBe(1250);
    expect(parseAmountToMinor('12.50', 'TJS')).toBe(1250);
    expect(parseAmountToMinor('1 234,56', 'TJS')).toBe(123456);
    expect(parseAmountToMinor(`1${NBSP}234`, 'TJS')).toBe(123400);
    expect(parseAmountToMinor('0', 'TJS')).toBe(0);
    expect(parseAmountToMinor('.5', 'TJS')).toBe(50);
    expect(parseAmountToMinor('7', 'JPY')).toBe(7);
  });

  it('двусмысленное «1,000» НЕ читается молча как 1 (ошибка в 1000 раз)', () => {
    expect(parseAmountToMinor('1,000', 'TJS')).toBeNull();
    expect(parseAmountToMinor('1.000', 'TJS')).toBeNull();
    expect(parseAmountToMinor('5,000', 'JPY')).toBeNull();
    expect(parseAmountToMinor('12.500', 'TJS')).toBeNull();
  });

  it('отвергает мусор, минус, степени, несколько разделителей', () => {
    for (const bad of ['', ' ', '-5', '+5', '1e5', 'abc', '1,2,3', '1.234,56', '12,505', '--', '١٢٣', '0x10']) {
      expect(parseAmountToMinor(bad, 'TJS'), bad).toBeNull();
    }
  });

  it('отвергает числа, не помещающиеся в безопасное целое', () => {
    expect(parseAmountToMinor('90071992547409.92', 'TJS')).toBeNull(); // 2^53 — уже небезопасно
    expect(parseAmountToMinor('9999999999999999', 'JPY')).toBeNull();
    expect(parseAmountToMinor('90071992547409.91', 'TJS')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('круговой обмен: format → input → parse не меняет сумму', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), fc.constantFrom('TJS', 'USD', 'JPY', 'KRW'), (n, cur) => {
        expect(parseAmountToMinor(minorToInputString(n, cur), cur)).toBe(n);
      }),
    );
  });
});

describe('formatMinor', () => {
  it('группирует тысячи, прячет «,00», ставит символ после суммы', () => {
    expect(formatMinor(123450, 'TJS')).toBe(`1${NBSP}234,50${NBSP}с.`);
    expect(formatMinor(100000, 'TJS')).toBe(`1${NBSP}000${NBSP}с.`);
    expect(formatMinor(100000, 'TJS', { fraction: 'always' })).toBe(`1${NBSP}000,00${NBSP}с.`);
    expect(formatMinor(5, 'USD')).toBe(`0,05${NBSP}$`);
    expect(formatMinor(1500, 'JPY')).toBe(`1${NBSP}500${NBSP}JP¥`);
  });

  it('знаки', () => {
    expect(formatMinor(-250, 'TJS')).toBe(`−2,50${NBSP}с.`);
    expect(formatMinor(250, 'TJS', { sign: 'always' })).toBe(`+2,50${NBSP}с.`);
    expect(formatMinor(-250, 'TJS', { sign: 'never', symbol: false })).toBe('2,50');
    expect(formatMinor(0, 'TJS', { sign: 'always', symbol: false })).toBe('0');
  });

  it('не принимает дробные и небезопасные числа', () => {
    expect(() => formatMinor(1.5, 'TJS')).toThrow(RangeError);
    expect(() => formatMinor(Number.MAX_SAFE_INTEGER + 2, 'TJS')).toThrow(RangeError);
    expect(() => formatMinor(NaN, 'TJS')).toThrow(RangeError);
  });
});

describe('сложение и пересчёт', () => {
  it('addMinor/sumMinor ловят переполнение', () => {
    expect(addMinor(1, 2)).toBe(3);
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => addMinor(0.5, 1)).toThrow(RangeError);
  });

  it('convertMinor: курс, разные знаки после запятой, округление от нуля', () => {
    expect(convertMinor(10000, 'USD', 'TJS', 10.9)).toBe(109000); // $100 → 1090 сомони
    expect(convertMinor(100, 'TJS', 'JPY', 16)).toBe(16); // 1 сомони → 16 иен (у иены нет дробной части)
    expect(convertMinor(1, 'USD', 'TJS', 10.9)).toBe(11); // 0,01$ → 0,109 сомони → 0,11
    expect(convertMinor(-10000, 'USD', 'TJS', 10.9)).toBe(-109000);
    expect(convertMinor(500, 'TJS', 'TJS', 123)).toBe(500);
  });

  it('convertMinor отвергает плохой курс и переполнение', () => {
    for (const r of [0, -1, NaN, Infinity]) expect(() => convertMinor(100, 'USD', 'TJS', r)).toThrow(RangeError);
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'TJS', 1000)).toThrow(RangeError);
  });

  it('fxSnapshot: та же валюта = курс 1; иначе нужен курс; курс округляется до 10 знаков как в базе', () => {
    expect(fxSnapshot(500, 'TJS', 'TJS', null)).toEqual({ baseAmountMinor: 500, fxRate: 1 });
    expect(() => fxSnapshot(500, 'USD', 'TJS', null)).toThrow(RangeError);
    expect(() => fxSnapshot(500, 'USD', 'TJS', 0)).toThrow(RangeError);
    const s = fxSnapshot(10000, 'TJS', 'USD', 1 / 10.9);
    expect(s.fxRate).toBe(Number((1 / 10.9).toFixed(10)));
    expect(s.baseAmountMinor).toBe(convertMinor(10000, 'TJS', 'USD', s.fxRate));
    expect(() => fxSnapshot(1, 'USD', 'TJS', 1e-12)).toThrow(RangeError);
  });
});

describe('computeBalances', () => {
  const w = (id: string, opening = 0) => ({ id, openingBalanceMinor: opening });
  const tx = (o: Record<string, unknown>) =>
    ({ kind: 'expense', walletId: 'a', toWalletId: null, amountMinor: 100, toAmountMinor: null, deletedAt: null, ...o }) as never;

  it('остаток = начальный + доходы − расходы ± переводы', () => {
    const b = computeBalances(
      [w('a', 1000), w('b', 0)],
      [
        tx({ kind: 'income', amountMinor: 500 }),
        tx({ kind: 'expense', amountMinor: 200 }),
        tx({ kind: 'transfer', toWalletId: 'b', amountMinor: 300, toAmountMinor: 295 }),
      ],
    );
    expect(b.get('a')).toBe(1000 + 500 - 200 - 300);
    expect(b.get('b')).toBe(295);
  });

  it('перевод без toAmountMinor зачисляет столько же, сколько списал', () => {
    const b = computeBalances([w('a', 500), w('b')], [tx({ kind: 'transfer', toWalletId: 'b', amountMinor: 200 })]);
    expect(b.get('a')).toBe(300);
    expect(b.get('b')).toBe(200);
  });

  it('удалённые, битые и чужие операции не влияют', () => {
    const b = computeBalances(
      [w('a', 100)],
      [
        tx({ deletedAt: '2026-01-01T00:00:00.000Z', amountMinor: 50 }),
        tx({ amountMinor: -5 }),
        tx({ amountMinor: 0 }),
        tx({ amountMinor: 1.5 }),
        tx({ walletId: 'zzz', amountMinor: 70 }),
      ],
    );
    expect(b.get('a')).toBe(100);
  });

  it('сумма всех остатков при переводах в одной валюте сохраняется', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { maxLength: 30 }), (amounts) => {
        const wallets = [w('a', 5000), w('b', 7000), w('c', 0)];
        const ids = ['a', 'b', 'c'];
        const txs = amounts.map((amt, i) =>
          tx({ kind: 'transfer', walletId: ids[i % 3], toWalletId: ids[(i + 1) % 3], amountMinor: amt, toAmountMinor: amt }),
        );
        const total = [...computeBalances(wallets, txs).values()].reduce((x, y) => x + y, 0);
        expect(total).toBe(12000);
      }),
    );
  });

  it('findBalanceIssues сообщает о том, что computeBalances пропустил', () => {
    const issues = findBalanceIssues(
      [{ id: 'a' }],
      [
        { id: '1', ...(tx({ amountMinor: -1 }) as object) } as never,
        { id: '2', ...(tx({ walletId: 'x' }) as object) } as never,
        { id: '3', ...(tx({ kind: 'transfer', toWalletId: 'a', walletId: 'a' }) as object) } as never,
      ],
    );
    expect(issues.map((i) => i.txId).sort()).toEqual(['1', '2', '3']);
  });
});

describe('курсы', () => {
  const t = (asOf: string, perUnit: Record<string, number>): RateTable => ({
    asOf,
    pivot: 'TJS',
    perUnit: { TJS: 1, ...perUnit },
    source: 'test',
    fetchedAt: `${asOf}T00:00:00.000Z`,
  });

  it('crossRate через опорную валюту', () => {
    const table = t('2026-10-10', { USD: 10.9, EUR: 12.0 });
    expect(crossRate(table, 'USD', 'TJS')).toBe(10.9);
    expect(crossRate(table, 'TJS', 'USD')).toBeCloseTo(1 / 10.9, 12);
    expect(crossRate(table, 'USD', 'EUR')).toBeCloseTo(10.9 / 12, 12);
    expect(crossRate(table, 'USD', 'USD')).toBe(1);
    expect(crossRate(table, 'USD', 'GBP')).toBeNull();
    expect(crossRate(t('2026-10-10', { USD: 0 }), 'USD', 'TJS')).toBeNull();
  });

  it('pickRate берёт самую свежую таблицу, где есть обе валюты', () => {
    const old = t('2026-10-01', { USD: 10.0, GBP: 14 });
    const fresh = t('2026-10-09', { USD: 10.9 });
    expect(pickRate([old, fresh], 'USD', 'TJS')?.table.asOf).toBe('2026-10-09');
    expect(pickRate([old, fresh], 'GBP', 'TJS')?.table.asOf).toBe('2026-10-01');
    expect(pickRate([old, fresh], 'KZT', 'TJS')).toBeNull();
    expect(pickRate([old, fresh], 'USD', 'USD')).toBeNull();
  });
});
