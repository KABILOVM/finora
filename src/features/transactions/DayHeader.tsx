import { MoneyText } from '@/components/MoneyText';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import type { dayTotal } from './txFilters';

export interface DayHeaderProps {
  /** Подпись дня: «Сегодня», «Вчера», «пн, 5 окт». */
  label: string;
  /** Итог дня (см. dayTotal); null — посчитать нельзя, показываем прочерк. */
  total: ReturnType<typeof dayTotal>;
  base: CurrencyCode;
  /** Уровень заголовка дня: на странице «Операции» он второй, на главной (под «Последними операциями») — третий. */
  level?: 2 | 3;
}

/** Шапка дня в списке операций: подпись слева, итог дня в основной валюте справа. */
export function DayHeader({ label, total, base, level = 2 }: DayHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className="flex items-baseline justify-between gap-2 px-1 pb-1">
      <Heading className="text-sm font-semibold text-muted">{label}</Heading>
      <span className="text-sm">
        {total ? (
          <>
            {total.excluded > 0 && (
              <span className="mr-2 text-xs text-muted">
                без {total.excluded} {pluralRu(total.excluded, 'операции', 'операций', 'операций')} в другой валюте
              </span>
            )}
            <MoneyText minor={total.netMinor} currency={base} sign="always" className="font-semibold" />
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </span>
    </header>
  );
}
