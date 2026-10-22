import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { capitalize, DeltaLine } from './PeriodDelta';
import { comparePhrase, type CompareMode, type PeriodReport } from './periods';
import { periodTitle, rangeText } from './periodText';

export interface PeriodSummaryCardProps {
  report: PeriodReport;
  base: CurrencyCode;
  mode: CompareMode;
}

/** Что значит норма сбережений словами. */
function savingsText(rate: number | null): string {
  if (rate === null) return 'Доходов за период нет — считать не с чего.';
  if (rate > 0) return `Вы сохранили ${rate}% дохода: остальное потрачено.`;
  if (rate === 0) return 'Потратили ровно столько, сколько получили.';
  return `Потратили больше, чем получили: на ${-rate}% сверх дохода.`;
}

/**
 * Итоги периода: расходы крупно, доходы, разница и норма сбережений (доля дохода, которая не потрачена). Всё против сравниваемого
 * периода, если он выбран: «▲ +12% · в прошлом году 53 000 с.». Под цифрами — какие именно даты сравниваются.
 */
export function PeriodSummaryCard({ report, base, mode }: PeriodSummaryCardProps) {
  const { period, current, compare } = report;
  const phrase = comparePhrase(period, mode);
  const prev = compare?.summary ?? null;
  const rate = current.savingsRate;
  const rateTone = rate === null || rate === 0 ? 'text-muted' : rate > 0 ? 'text-income' : 'text-expense';
  return (
    <Card aria-label="Итоги периода" data-testid="period-summary" className="!py-4 md:!p-5">
      <p className="text-sm text-muted">Расходы за {periodTitle(period)}</p>
      <p className="mt-0.5 text-[clamp(1.75rem,8vw,2.25rem)] font-extrabold leading-tight tracking-tight">
        <MoneyText minor={current.expenseMinor} currency={base} tone="none" />
      </p>
      {prev && <DeltaLine testId="period-expense-delta" current={current.expenseMinor} previous={prev.expenseMinor} base={base} phrase={phrase} noun="расходов" goodWhen="down" />}
      <p className="mt-1 text-xs text-muted" data-testid="period-range">
        {period.kind !== 'custom' && <>{rangeText(period)}{period.partial ? ', период ещё идёт' : ''}. </>}
        {compare && <>Сравниваем с {rangeText(compare.range)}.</>}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-surface-2/70 px-3 py-2">
          <dt className="text-xs text-muted">Доходы</dt>
          <dd className="font-semibold">
            <MoneyText minor={current.incomeMinor} currency={base} tone="income" sign="always" />
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-2/70 px-3 py-2">
          <dt className="text-xs text-muted">Разница</dt>
          <dd className="font-semibold">
            <MoneyText minor={current.netMinor} currency={base} tone="auto" sign="always" />
          </dd>
        </div>
      </dl>
      {prev && <DeltaLine testId="period-income-delta" current={current.incomeMinor} previous={prev.incomeMinor} base={base} phrase={phrase} noun="доходов" goodWhen="up" />}
      <div className="mt-3 rounded-2xl bg-surface-2/70 px-3 py-2" data-testid="savings-rate">
        <p className="text-xs text-muted">Норма сбережений</p>
        <p className={`text-2xl font-extrabold leading-tight ${rateTone}`}>{rate === null ? '—' : `${rate}%`}</p>
        <p className="text-sm text-muted">{savingsText(rate)}</p>
        {prev && prev.savingsRate !== null && (
          <p className="text-sm text-muted" data-testid="savings-rate-prev">
            {capitalize(phrase)} было {prev.savingsRate}%
          </p>
        )}
      </div>
      {current.excludedCount > 0 && (
        <p className="mt-3 text-sm font-medium text-warning">
          Не учтено {current.excludedCount} {pluralRu(current.excludedCount, 'операция', 'операции', 'операций')}: они внесены в другой основной
          валюте, чем сейчас ({base}).
        </p>
      )}
    </Card>
  );
}
