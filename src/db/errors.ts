import type { CurrencyCode } from '@/domain/types';

/** Любая ошибка проверки данных. Текст — по-русски, его можно показывать человеку как есть. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Валюта кошелька отличается от базовой, а курс не передан: без курса снимок суммы сделать нельзя. */
export class FxRequiredError extends ValidationError {
  readonly walletCurrency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
  constructor(walletCurrency: CurrencyCode, baseCurrency: CurrencyCode) {
    super(`Нужен курс ${walletCurrency} → ${baseCurrency}: валюта кошелька отличается от базовой`);
    this.name = 'FxRequiredError';
    this.walletCurrency = walletCurrency;
    this.baseCurrency = baseCurrency;
  }
}

export function fail(message: string): never {
  throw new ValidationError(message);
}
