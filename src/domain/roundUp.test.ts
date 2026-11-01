import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUND_UP_STEP,
  ROUND_UP_FIRST_DAYS,
  ROUND_UP_NOTE_PREFIX,
  ROUND_UP_STEPS,
  isRoundUpStep,
  parseRoundUpNote,
  roundUpDiffMinor,
  roundUpNote,
  roundUpStepMinor,
  roundUpTotal,
  roundUpWindow,
  sweptThrough,
} from './roundUp';
import { ADJUSTMENT_SOURCE } from './adjustment';

describe('roundUpDiffMinor', () => {
  it('до ближайшей круглой суммы вверх; круглая сумма мелочи не даёт', () => {
    expect(roundUpDiffMinor(4_700, 500)).toBe(300); // 47 → 50
    expect(roundUpDiffMinor(5_000, 500)).toBe(0);
    expect(roundUpDiffMinor(5_001, 500)).toBe(499);
    expect(roundUpDiffMinor(1, 100)).toBe(99);
    expect(roundUpDiffMinor(12_345, 100)).toBe(55);
  });

  it('мусор не ломает: нулевая, отрицательная, дробная сумма или шаг дают 0', () => {
    expect(roundUpDiffMinor(0, 500)).toBe(0);
    expect(roundUpDiffMinor(-5, 500)).toBe(0);
    expect(roundUpDiffMinor(10.5, 500)).toBe(0);
    expect(roundUpDiffMinor(100, 0)).toBe(0);
    expect(roundUpDiffMinor(100, -5)).toBe(0);
    expect(roundUpDiffMinor(Number.NaN, 500)).toBe(0);
    expect(roundUpDiffMinor(Number.MAX_SAFE_INTEGER + 1, 500)).toBe(0);
  });

  it('свойство: 0 ≤ мелочь < шаг, а сумма с мелочью кратна шагу', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000_000 }), fc.integer({ min: 1, max: 100_000 }), (amount, step) => {
        const diff = roundUpDiffMinor(amount, step);
        expect(diff).toBeGreaterThanOrEqual(0);
        expect(diff).toBeLessThan(step);
        expect((amount + diff) % step).toBe(0);
      }),
    );
  });
});

describe('roundUpStepMinor / roundUpStep', () => {
  it('шаг в минимальных единицах валюты', () => {
    expect(roundUpStepMinor(5, 'TJS')).toBe(500);
    expect(roundUpStepMinor(10, 'USD')).toBe(1_000);
    expect(roundUpStepMinor(5, 'JPY')).toBe(5); // у иены нет дробной части
    expect(DEFAULT_ROUND_UP_STEP).toBe(5);
    expect([...ROUND_UP_STEPS]).toEqual([1, 5, 10]);
    expect(isRoundUpStep(5)).toBe(true);
    expect(isRoundUpStep(7)).toBe(false);
    expect(isRoundUpStep('5')).toBe(false);
  });
});

describe('заметка сбора', () => {
  it('собирается и читается обратно', () => {
    const note = roundUpNote('2026-10-31');
    expect(note).toBe(`${ROUND_UP_NOTE_PREFIX} · до 2026-10-31`);
    expect(parseRoundUpNote(note)).toBe('2026-10-31');
    expect(parseRoundUpNote(`  ${note}  `)).toBe('2026-10-31');
  });

  it('чужие заметки и ненастоящие даты — null', () => {
    expect(parseRoundUpNote('')).toBeNull();
    expect(parseRoundUpNote('Копилка из мелочи')).toBeNull();
    expect(parseRoundUpNote('Копилка из мелочи · до 2026-02-30')).toBeNull();
    expect(parseRoundUpNote('Моя Копилка из мелочи · до 2026-10-31')).toBeNull();
    expect(parseRoundUpNote('Копилка из мелочи · до 2026-10-31 и ещё')).toBeNull();
  });
});

describe('sweptThrough', () => {
  const t = (over: Record<string, unknown> = {}) => ({ kind: 'transfer' as const, toWalletId: 'box', note: roundUpNote('2026-10-10'), deletedAt: null, ...over });

  it('наибольшая дата среди живых сборов на кошелёк цели', () => {
    expect(sweptThrough([t(), t({ note: roundUpNote('2026-10-20') }), t({ note: roundUpNote('2026-09-30') })], 'box')).toBe('2026-10-20');
  });

  it('удалённые, чужие кошельки, не переводы и обычные заметки не считаются', () => {
    expect(sweptThrough([t({ deletedAt: '2026-10-11T00:00:00.000Z', note: roundUpNote('2026-10-25') })], 'box')).toBeNull();
    expect(sweptThrough([t({ toWalletId: 'other', note: roundUpNote('2026-10-25') })], 'box')).toBeNull();
    expect(sweptThrough([t({ kind: 'expense', note: roundUpNote('2026-10-25') })], 'box')).toBeNull();
    expect(sweptThrough([t({ note: 'Отпуск' })], 'box')).toBeNull();
    expect(sweptThrough([], 'box')).toBeNull();
  });
});

describe('roundUpWindow', () => {
  it('со следующего дня после сбора; сборов не было — последние 30 дней', () => {
    expect(roundUpWindow('2026-10-10', '2026-10-15')).toEqual({ from: '2026-10-11', to: '2026-10-15' });
    expect(roundUpWindow(null, '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' });
    expect(ROUND_UP_FIRST_DAYS).toBe(30);
  });

  it('сбор сегодня (или дата из будущего) — собирать нечего', () => {
    expect(roundUpWindow('2026-10-15', '2026-10-15')).toBeNull();
    expect(roundUpWindow('2026-11-01', '2026-10-15')).toBeNull();
  });
});

describe('roundUpTotal', () => {
  const tx = (over: Record<string, unknown> = {}) => ({
    kind: 'expense' as const,
    walletId: 'cash',
    occurredOn: '2026-10-10',
    deletedAt: null,
    baseCurrency: 'TJS',
    baseAmountMinor: 4_700,
    debtId: null,
    fxSource: 'same',
    ...over,
  });
  const args = { from: '2026-10-01', to: '2026-10-15', stepMinor: 500, base: 'TJS' };

  it('складывает мелочь по расходам периода', () => {
    // 47 → 3, 12 → 3, 50 → 0
    expect(roundUpTotal([tx(), tx({ baseAmountMinor: 1_200 }), tx({ baseAmountMinor: 5_000 })], args)).toBe(300 + 300 + 0);
  });

  it('границы периода включительно, вне периода не считается', () => {
    expect(roundUpTotal([tx({ occurredOn: '2026-10-01' }), tx({ occurredOn: '2026-10-15' }), tx({ occurredOn: '2026-09-30' }), tx({ occurredOn: '2026-10-16' })], args)).toBe(600);
  });

  it('не считаются: удалённые, доходы и переводы, долги, корректировки, другая основная валюта, кошелёк цели', () => {
    const skipped = [
      tx({ deletedAt: '2026-10-11T00:00:00.000Z' }),
      tx({ kind: 'income' }),
      tx({ kind: 'transfer' }),
      tx({ debtId: 'debt-1' }),
      tx({ fxSource: ADJUSTMENT_SOURCE }),
      tx({ baseCurrency: 'USD' }),
      tx({ walletId: 'box' }),
    ];
    expect(roundUpTotal(skipped, { ...args, excludeWalletId: 'box' })).toBe(0);
    // а без исключения кошелька цели его расход считался бы
    expect(roundUpTotal([tx({ walletId: 'box' })], args)).toBe(300);
  });

  it('суммы не помещаются — RangeError, а не неверный итог', () => {
    const huge = { ...args, stepMinor: Number.MAX_SAFE_INTEGER };
    // мелочь с одной траты в 1 при таком шаге — MAX − 1: одна помещается, две — нет
    expect(roundUpTotal([tx({ baseAmountMinor: 1 })], huge)).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(() => roundUpTotal([tx({ baseAmountMinor: 1 }), tx({ baseAmountMinor: 1 })], huge)).toThrow(RangeError);
  });
});
