import { currencyInfo } from '@/domain/currency';
import { formatMinor, isMinor, type FormatOptions } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { cn } from '@/lib/cn';

export interface MoneyTextProps extends Omit<FormatOptions, 'symbol'> {
  minor: Minor;
  currency: CurrencyCode;
  /**
   * Цвет: 'auto' — по знаку (плюс — доход, минус — расход, ноль — приглушённый);
   * 'none' — цвет текста вокруг; 'income' / 'expense' — принудительно.
   */
  tone?: 'auto' | 'none' | 'income' | 'expense';
  /** Показывать символ валюты (по умолчанию да). */
  symbol?: boolean;
  className?: string;
}

const TONE_CLASS = { income: 'text-income', expense: 'text-expense', zero: 'text-muted', none: '' } as const;

/** Сумма с форматированием через formatMinor. Цифры одной ширины (tabular-nums), строка не переносится. */
export function MoneyText({ minor, currency, tone = 'auto', symbol = true, fraction, sign, className }: MoneyTextProps) {
  if (!isMinor(minor)) {
    // Одна битая сумма не должна ронять весь экран (как и в расчёте остатков, см. domain/balances.ts).
    console.error('MoneyText: некорректная сумма', minor);
    return (
      <span className={cn('money text-muted', className)} aria-label="Некорректная сумма">
        —
      </span>
    );
  }
  const toneKey = tone === 'auto' ? (minor > 0 ? 'income' : minor < 0 ? 'expense' : 'zero') : tone;
  return (
    <span className={cn('money', TONE_CLASS[toneKey], className)} data-currency={currencyInfo(currency).code}>
      {formatMinor(minor, currency, { symbol, fraction, sign })}
    </span>
  );
}
