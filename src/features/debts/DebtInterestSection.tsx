import { useId } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { TextInput } from '@/components/Field';
import { parseTermMonths, suggestedMonthlyMinor } from '@/domain/interest';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, DebtDirection, Minor } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { planOfForm } from './debtForm';

export interface DebtInterestSectionProps {
  direction: DebtDirection;
  currency: CurrencyCode;
  /** Сумма долга (без процентов), как её ввёл человек. */
  principalMinor: Minor | null;
  on: boolean;
  onToggle: (on: boolean) => void;
  rateText: string;
  onRate: (text: string) => void;
  termText: string;
  onTerm: (text: string) => void;
  /** Проценты за весь срок; null — ещё не заданы. */
  interestMinor: Minor | null;
  /** Сумму ввели руками (а не посчитали по ставке и сроку). */
  manual: boolean;
  onInterest: (minor: Minor | null) => void;
  errors: { rate?: string; term?: string; interest?: string };
}

/**
 * «Проценты» у нового долга и в правке: кредит в банке, заём под процент. Ставка (% годовых) и срок (месяцев) считают проценты за весь
 * срок «равными платежами» (аннуитет) — как у большинства банков. Сумму процентов можно поправить руками под договор: у банков бывают
 * комиссии и другие схемы платежей. Остаток долга потом считается от «сумма + проценты».
 */
export function DebtInterestSection({
  direction,
  currency,
  principalMinor,
  on,
  onToggle,
  rateText,
  onRate,
  termText,
  onTerm,
  interestMinor,
  manual,
  onInterest,
  errors,
}: DebtInterestSectionProps) {
  const titleId = useId();
  const hintId = useId();
  const plan = planOfForm({ amountMinor: principalMinor, rateText, termText });
  const term = parseTermMonths(termText);
  const total =
    principalMinor !== null && principalMinor > 0 && interestMinor !== null && interestMinor > 0 && Number.isSafeInteger(principalMinor + interestMinor)
      ? principalMinor + interestMinor
      : null;
  // Платёж в месяц: посчитан по графику банка, пока сумму процентов не меняли руками; иначе — сумма с процентами поровну на срок
  const monthly =
    total === null
      ? null
      : plan !== null && !manual && plan.interestMinor === interestMinor
        ? plan.paymentMinor
        : suggestedMonthlyMinor(total, term);

  const calcHint = manual
    ? 'Введено вручную. Очистите поле — посчитаем по ставке и сроку.'
    : plan !== null
      ? 'Посчитано по ставке и сроку: равными платежами каждый месяц (аннуитет). Если в договоре иначе — поправьте сумму.'
      : 'Введите ставку и срок — посчитаем сами, или впишите сумму процентов из договора.';

  return (
    <section aria-label="Проценты" data-testid="debt-interest-section" className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
          aria-labelledby={titleId}
          aria-describedby={hintId}
          className="mt-0.5 h-6 w-6 shrink-0 accent-brand"
        />
        <span>
          <span id={titleId} className="block font-semibold">
            Есть проценты
          </span>
          <span id={hintId} className="block text-sm text-muted">
            {direction === 'borrowed'
              ? 'Кредит в банке или заём под процент: проценты добавятся к сумме, которую нужно вернуть.'
              : 'Дали под процент: проценты добавятся к сумме, которую должны вернуть вам.'}
          </span>
        </span>
      </label>

      {on && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label="Ставка, % годовых"
              value={rateText}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="Например, 24"
              maxLength={8}
              onChange={(e) => onRate(e.target.value)}
              error={errors.rate}
            />
            <TextInput
              label="Срок, месяцев"
              value={termText}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="Например, 12"
              maxLength={4}
              onChange={(e) => onTerm(e.target.value)}
              error={errors.term}
            />
          </div>

          <FieldGroup label="Проценты за весь срок" hint={calcHint} error={errors.interest}>
            <AmountInput
              label="Проценты за весь срок"
              currency={currency}
              value={interestMinor}
              showKeypad={false}
              dense
              tone="neutral"
              onChange={onInterest}
            />
          </FieldGroup>

          {total !== null && (
            <dl data-testid="interest-preview" className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2/70 p-3 text-sm">
              <dt className="text-muted">Всего к возврату</dt>
              <dd className="money text-right font-semibold">{formatMinor(total, currency)}</dd>
              {monthly !== null && (
                <>
                  <dt className="text-muted">Платёж в месяц</dt>
                  <dd className="money text-right font-semibold" data-testid="interest-monthly">
                    {plan !== null && !manual ? '≈ ' : ''}
                    {formatMinor(monthly, currency)}
                  </dd>
                </>
              )}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
