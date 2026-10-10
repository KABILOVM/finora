import { TextInput } from '@/components/Field';
import { currencyInfo } from '@/domain/currency';
import { formatMinor, fxSnapshot } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import type { FxView } from './useTxFormController';
import { formatRate, rateSourceLabel, ruDate } from './txForm';

export interface FxNoticeProps {
  fx: FxView;
  amountMinor: Minor | null;
  rateText: string;
  onRateText: (text: string) => void;
  error?: string | null;
}

const NOTE = 'rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted';
const WARN = 'font-medium text-warning';

/** «1 $ = 10,9 с.» */
function rateLine(from: CurrencyCode, to: CurrencyCode, rate: number): string {
  return `1 ${currencyInfo(from).symbol} = ${formatRate(rate)} ${currencyInfo(to).symbol}`;
}

/** Сколько получится в основной валюте (ровно так же, как посчитает репозиторий). null — считать нечего или не помещается. */
function basePreview(amount: Minor | null, from: CurrencyCode, to: CurrencyCode, rate: number): string | null {
  if (amount === null || amount <= 0) return null;
  try {
    return formatMinor(fxSnapshot(amount, from, to, rate).baseAmountMinor, to);
  } catch {
    return null;
  }
}

/**
 * Что нужно знать о курсе, когда кошелёк не в основной валюте: каким курсом сохранится операция,
 * устарел ли он, и поле «Курс» для ручного ввода, если курса нет совсем (ввод денег от сети не зависит).
 */
export function FxNotice({ fx, amountMinor, rateText, onRateText, error }: FxNoticeProps) {
  if (fx.kind === 'none') return null;

  if (fx.kind === 'keep') {
    return (
      <div className={NOTE} data-testid="fx-notice">
        <p>
          Курс при внесении: {rateLine(fx.from, fx.to, fx.rate)} ({rateSourceLabel(fx.source)}).
        </p>
        <p>Операцию не переоцениваем: новый курс к ней не применяется.</p>
      </div>
    );
  }

  if (fx.kind === 'rate') {
    const { lookup } = fx;
    const base = basePreview(amountMinor, fx.from, fx.to, lookup.rate);
    return (
      <div className={NOTE} data-testid="fx-notice">
        <p>
          Курс: {rateLine(fx.from, fx.to, lookup.rate)} ({lookup.manual ? 'задан вручную' : rateSourceLabel(lookup.source)}, {ruDate(lookup.asOf)})
        </p>
        {base && <p>В основной валюте: ≈ {base}</p>}
        {lookup.stale && (
          <p className={WARN}>
            Курс устарел: он на {ruDate(lookup.asOf)}. Сумма в основной валюте может быть неточной.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="fx-notice">
      <p className={`${NOTE} ${WARN}`}>
        Курса {currencyInfo(fx.from).symbol} → {currencyInfo(fx.to).symbol} пока нет (возможно, не было интернета). Введите курс сами —
        он запишется только в эту операцию. Чтобы курс действовал всегда, задайте «Свой курс» в настройках.
      </p>
      <TextInput
        label={`Курс: сколько ${currencyInfo(fx.to).symbol} за 1 ${currencyInfo(fx.from).symbol}`}
        value={rateText}
        onChange={(e) => onRateText(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="Например, 10,9"
        error={error}
      />
    </div>
  );
}
