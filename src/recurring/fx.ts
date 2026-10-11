import type { CurrencyCode, Minor, TxKind } from '@/domain/types';
import { fxSourceOf, parseRateText } from '@/features/transactions/txForm';
import type { FxView } from '@/features/transactions/useTxFormController';
import type { RateLookup } from '@/rates/types';

/**
 * Нужен ли курс, чтобы записать операцию по регулярному платежу. Зеркало правил репозитория операций (buildSnapshot):
 *  - расход/доход в кошельке не в базовой валюте — курс нужен всегда;
 *  - перевод — только если кошельки одной небазовой валюты и зачислено меньше, чем списано (разница — комиссия, её нужно
 *    оценить в базовой валюте); обмен между валютами и перевод без комиссии курса не требуют.
 */
export function needsFx(
  f: { kind: TxKind; amountMinor: Minor; toAmountMinor: Minor | null },
  wallet: { currency: CurrencyCode } | undefined,
  toWallet: { currency: CurrencyCode } | null | undefined,
  base: CurrencyCode,
): boolean {
  if (!wallet) return false;
  if (f.kind !== 'transfer') return wallet.currency !== base;
  if (!toWallet || f.toAmountMinor === null) return false;
  const fee = wallet.currency === toWallet.currency && f.toAmountMinor < f.amountMinor;
  return fee && wallet.currency !== base;
}

export type AutoRate =
  | { ok: true; fx: { rate: number; source: string } }
  /** missing — курса нет (или есть только введённый вручную в операции, ему автоматика не верит); stale — курс старше 3 суток. */
  | { ok: false; reason: 'missing' | 'stale' };

/**
 * Какой курс годится для автопроведения: свежий автоматический или «Свой курс» из Настроек. Курс, который человек когда-то
 * набрал в операции (`entered`), и устаревший курс — нет: автоплатёж не должен молча записать деньги по случайному курсу.
 */
export function pickAutoRate(lookup: RateLookup | null): AutoRate {
  if (!lookup || !Number.isFinite(lookup.rate) || lookup.rate <= 0) return { ok: false, reason: 'missing' };
  if (lookup.manual) return { ok: true, fx: { rate: lookup.rate, source: 'manual' } };
  if (lookup.entered === true) return { ok: false, reason: 'missing' };
  if (lookup.stale) return { ok: false, reason: 'stale' };
  return { ok: true, fx: { rate: lookup.rate, source: fxSourceOf(lookup) } };
}

/** «USD → TJS» */
export const pairText = (from: CurrencyCode, to: CurrencyCode): string => `${from} → ${to}`;

/** Что показать про курс в окне «Провести» / «Пропустить»: как в форме операции (FxNotice). */
export function fxViewFor(
  need: boolean,
  wallet: { currency: CurrencyCode } | undefined,
  base: CurrencyCode,
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null,
): FxView {
  if (!need || !wallet) return { kind: 'none' };
  const lookup = getRate(wallet.currency, base);
  return lookup
    ? { kind: 'rate', lookup, from: wallet.currency, to: base }
    : { kind: 'missing', from: wallet.currency, to: base };
}

export interface FxInput {
  /** Курс для записи в операцию (его принимает репозиторий). Нет — курс не нужен. */
  fx?: { rate: number; source: string };
  /** Курс, который человек набрал сам: после успешной записи его можно запомнить. */
  typed?: { from: CurrencyCode; to: CurrencyCode; rate: number };
  /** Текст ошибки у поля «Курс». */
  error?: string;
}

const RATE_FORMAT_ERROR = 'Курс — число больше нуля, например 10,9';

/**
 * Курс для записи: найденный (свежий, устаревший с предупреждением, «Свой курс») берётся как есть; введённый ранее в операции
 * можно поправить в поле; если курса нет совсем, его вводят руками — молча без курса платёж не проводится.
 */
export function resolveFxInput(fx: FxView, rateText: string): FxInput {
  if (fx.kind === 'rate') {
    const found = { rate: fx.lookup.rate, source: fxSourceOf(fx.lookup) };
    if (fx.lookup.entered === true && rateText.trim() !== '') {
      const rate = parseRateText(rateText);
      if (rate === null) return { error: RATE_FORMAT_ERROR };
      if (rate !== fx.lookup.rate) return { fx: { rate, source: 'manual' }, typed: { from: fx.from, to: fx.to, rate } };
    }
    return { fx: found };
  }
  if (fx.kind === 'missing') {
    const rate = parseRateText(rateText);
    if (rate === null) {
      return {
        error:
          rateText.trim() === ''
            ? 'Курса пока нет — введите его, чтобы пересчитать сумму в основную валюту'
            : RATE_FORMAT_ERROR,
      };
    }
    return { fx: { rate, source: 'manual' }, typed: { from: fx.from, to: fx.to, rate } };
  }
  return {};
}
