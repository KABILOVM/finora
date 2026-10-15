import { useState } from 'react';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { CALENDAR_DAYS, type CalendarEvent, type CashCalendarOk } from '@/domain/cashCalendar';
import { formatMinor } from '@/domain/money';
import { longDate } from '@/features/budgets/budgetText';
import { skippedText } from '@/features/budgets/ForecastCard';
import { endSentence } from '@/features/transactions/txDisplay';
import { formatDayLabel } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { BalanceDays, shortDay } from './charts/BalanceDays';
import { useCashCalendar } from './useCashCalendar';

const KIND_WORD: Record<CalendarEvent['kind'], string> = {
  payment: 'платёж',
  income: 'доход',
  'debt-pay': 'вернуть долг',
  'debt-receive': 'вернут долг',
};

function Check({ id, checked, disabled, onChange, label, hint }: { id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className={`flex min-h-[44px] items-start gap-3 py-1 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-brand" />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** «Денег не хватит с 27 октября…» или «Денег хватает на все 30 дней…». */
export function verdictText(c: CashCalendarOk): { text: string; bad: boolean } {
  const low = `${formatMinor(c.minBalanceMinor, c.base)} (${longDate(c.minDate)})`;
  if (c.firstNegativeDate !== null) return { bad: true, text: `Денег не хватит с ${longDate(c.firstNegativeDate)}. Самый низкий остаток: ${endSentence(low)}` };
  return { bad: false, text: `Денег хватает на все ${c.days.length} ${pluralRu(c.days.length, 'день', 'дня', 'дней')}. Меньше всего будет ${endSentence(low)}` };
}

function Days({ c }: { c: CashCalendarOk }) {
  const withEvents = c.days.filter((d) => d.events.length > 0);
  if (withEvents.length === 0) {
    return <p className="text-muted">В ближайшие {CALENDAR_DAYS} дней нет платежей, доходов и сроков по долгам.</p>;
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="События календаря">
      {withEvents.map((d) => (
        <li key={d.date} data-testid={`cal-day-${d.date}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <h3 className="font-semibold">{formatDayLabel(d.date, c.today)}</h3>
            <span className={`text-xs ${d.balanceMinor < 0 ? 'font-semibold text-danger' : 'text-muted'}`}>
              Остаток <span className="money">{formatMinor(d.balanceMinor, c.base)}</span>
            </span>
          </div>
          <ul className="mt-1 divide-y divide-border rounded-2xl bg-surface-2/60 px-3">
            {d.events.map((e) => (
              <li key={`${e.kind}-${e.id}-${e.date}`} className="flex items-center gap-3 py-2" data-testid="cal-event">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.label}</span>
                  <span className="block text-xs text-muted">
                    {KIND_WORD[e.kind]}
                    {e.overdue && ' · просрочен, считаем на сегодня'}
                  </span>
                </span>
                <MoneyText minor={e.deltaMinor} currency={c.base} tone="auto" sign="always" className="shrink-0 font-semibold" />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * «Денежный календарь»: как будут меняться деньги на руках ближайшие 30 дней — регулярные платежи и доходы, сроки долгов, по желанию
 * обычные траты и возвраты вам. Деньги на руках — те же, что в «Можно тратить в день»: без накоплений.
 */
export function CashCalendarView() {
  const [includeUsual, setIncludeUsual] = useState(true);
  const [includeReceivables, setIncludeReceivables] = useState(false);
  const calendar = useCashCalendar({ includeUsual, includeReceivables });

  if (calendar === undefined) {
    return (
      <p role="status" className="py-10 text-center text-muted">
        Считаем…
      </p>
    );
  }
  if (calendar === null) {
    return (
      <p role="status" className="py-10 text-center text-muted">
        Настройки ещё не загружены
      </p>
    );
  }
  if (calendar.status === 'no-wallets') {
    return <EmptyState icon="wallet" title="Пока нечего считать" text="Создайте кошелёк и внесите остаток — тогда появится календарь денег." />;
  }
  if (calendar.status === 'only-savings') {
    return <EmptyState icon="wallet" title="Тратить нечего" text="Все ваши кошельки — накопления, а их календарь не считает. Добавьте обычный кошелёк." />;
  }
  if (calendar.status !== 'ok') {
    return <EmptyState icon="alert" title="Не удалось посчитать" text="Суммы слишком большие или дата некорректна. Проверьте данные." />;
  }

  const c = calendar;
  const verdict = verdictText(c);
  const usualKnown = c.usualPerDayMinor !== null;
  return (
    <div className="stagger flex flex-col gap-4">
      <Card aria-label="Итог календаря" data-testid="calendar-summary" className="!py-4 md:!p-5">
        <p className="text-sm text-muted">Деньги на руках сейчас</p>
        <p className="mt-0.5 text-[clamp(1.75rem,8vw,2.25rem)] font-extrabold leading-tight tracking-tight" data-testid="calendar-start">
          {c.approximate && <span title="Приблизительно: часть сумм пересчитана по курсу или не вошла в расчёт">≈ </span>}
          <MoneyText minor={c.startMinor} currency={c.base} tone={c.startMinor < 0 ? 'expense' : 'none'} />
        </p>
        <p className="mt-0.5 text-sm text-muted" data-testid="calendar-end">
          К {shortDay(c.endDate)} будет <span className="money font-semibold text-text">{formatMinor(c.endMinor, c.base)}</span>
        </p>
        <p className={`mt-2 text-sm font-medium ${verdict.bad ? 'text-danger' : 'text-income'}`} data-testid="calendar-verdict" role={verdict.bad ? 'alert' : undefined}>
          {verdict.text}
        </p>
        {c.skipped.length > 0 && <p className="mt-2 text-sm font-medium text-warning">Не вошло в расчёт — нет курса: {endSentence(skippedText(c.skipped))}</p>}
        {c.unknownWalletPayments > 0 && (
          <p className="mt-2 text-sm font-medium text-warning">
            Не удалось учесть {c.unknownWalletPayments} {pluralRu(c.unknownWalletPayments, 'платёж', 'платежа', 'платежей')}: кошелёк не найден.
          </p>
        )}
      </Card>

      <Card aria-label="Настройки календаря" className="!py-3 md:!p-5">
        <Check
          id="cal-usual"
          checked={includeUsual && usualKnown}
          disabled={!usualKnown}
          onChange={setIncludeUsual}
          label="Тратить как обычно"
          hint={usualKnown ? `Каждый день минус ${formatMinor(c.usualPerDayMinor ?? 0, c.base)}: столько в среднем уходит за день` : 'Пока нет истории расходов, считать нечем'}
        />
        <Check id="cal-receivables" checked={includeReceivables} onChange={setIncludeReceivables} label="Мне вернут долги в срок" hint="Остаток долга «мне должны» придёт в день срока. Это только ожидание" />
      </Card>

      <Card aria-labelledby="calendar-chart-title" className="!py-4 md:!p-5">
        <h2 id="calendar-chart-title" className="mb-3 text-base font-semibold">
          Деньги на руках по дням
        </h2>
        <BalanceDays days={c.days} base={c.base} />
      </Card>

      <Card aria-labelledby="calendar-events-title" className="!py-4 md:!p-5">
        <h2 id="calendar-events-title" className="mb-3 text-base font-semibold">
          Что будет по дням
        </h2>
        <Days c={c} />
      </Card>
    </div>
  );
}
