import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { summarizeDay, useTransactions } from '@/db';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { useAddLink } from '@/layout/nav';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { HomeMoney } from '../hideAmounts';
import { blockCardClass, BlockBusy, BlockTitle } from './BlockParts';

/**
 * Блок «Сегодня» на «Главной» (по умолчанию скрыт, включается в настройке главной): сколько потрачено за сегодня, сколько
 * получено и сколько операций внесено — короткий ответ на «куда попала трата». Суммы — по снимкам в основной валюте, как в
 * итоге дня у «Последних операций»; переводы в «потрачено» не входят (кроме комиссии), но в числе операций считаются.
 * Заголовок открывает «Операции» за сегодняшний день.
 */
export default function TodayHomeCard({ today, base, half = false }: { today: IsoDate; base: CurrencyCode; half?: boolean }) {
  const rows = useTransactions({ from: today, to: today });
  const addLink = useAddLink();
  const query = new URLSearchParams({ period: 'range', from: today, to: today }).toString();
  let sums: { expenseMinor: number; incomeMinor: number } | null = null;
  if (rows) {
    try {
      sums = summarizeDay(rows, base);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e; // суммы не помещаются в расчёт: честно скажем об этом
    }
  }
  const count = rows?.length ?? 0;
  return (
    <Card aria-labelledby="home-today" data-testid="today-card" className={blockCardClass(half)}>
      <BlockTitle id="home-today" to={`/transactions?${query}`} icon="calendar" tone="bg-brand/10 text-brand" label="Сегодня: открыть операции за день" half={half}>
        Сегодня
      </BlockTitle>
      {!rows ? (
        <BlockBusy />
      ) : count === 0 ? (
        <p className="mt-1.5 text-sm text-muted">
          Сегодня операций пока нет.{' '}
          <Link {...addLink} className="font-semibold text-brand">
            Добавить
          </Link>
        </p>
      ) : sums === null ? (
        <p className="mt-1.5 text-sm text-muted">Суммы слишком большие, проверьте данные.</p>
      ) : (
        <>
          <p className="mt-1 text-xs font-medium text-muted">Потрачено</p>
          <p
            data-testid="today-spent"
            className={cn('truncate font-extrabold leading-tight tracking-tight', half ? 'text-[clamp(1.125rem,5.4vw,1.5rem)]' : 'text-[clamp(1.375rem,6.5vw,1.75rem)]')}
          >
            <HomeMoney minor={sums.expenseMinor} currency={base} tone="none" animated />
          </p>
          <p data-testid="today-count" className="mt-0.5 text-sm text-muted">
            <span className="font-semibold text-text">
              {count} {pluralRu(count, 'операция', 'операции', 'операций')}
            </span>
            {sums.incomeMinor > 0 && (
              <>
                {' · получено '}
                <HomeMoney minor={sums.incomeMinor} currency={base} tone="income" sign="always" className="font-semibold" />
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
