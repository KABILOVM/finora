import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import type { DailyLine } from './dailyStats';
import { STATUS_TONE, unavailableText } from './dailyText';
import { useDailyStats } from './useDailyStats';

/** Сколько категорий показываем на «Главной»: самые «горячие»; остальные — на экране «Бюджеты». */
export const HOME_DAILY_ROWS = 3;

const TONE_TEXT = { brand: 'text-text', warning: 'text-warning', danger: 'text-danger' } as const;

function Row({ line, base }: { line: DailyLine; base: CurrencyCode }) {
  const plan = line.plan?.kind === 'plan' ? line.plan : null;
  const tone = plan ? TONE_TEXT[STATUS_TONE[plan.status]] : 'text-text';
  return (
    <li data-testid={`daily-home-${line.key}`} className="flex items-center gap-3 py-1.5">
      <Glyph value={line.icon} color={line.color ?? undefined} size={32} />
      <span className="min-w-0 flex-1 truncate font-medium">{line.name}</span>
      <span className={cn('shrink-0 text-right tabular-nums', tone)}>
        <MoneyText minor={line.today.totalMinor} currency={base} tone="none" className="font-semibold" />
        {line.limitPerDayMinor !== null && (
          <span className="text-muted">
            {' / '}
            <MoneyText minor={line.limitPerDayMinor} currency={base} tone="none" />
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * «Траты в день» на «Главной»: сегодня потрачено из лимита и накопленный запас месяца, а ниже — самые «горячие» ежедневные категории.
 * Нет ни одной ежедневной категории — карточки нет (как её включить, рассказывает экран «Бюджеты»).
 */
export default function DailyHomeCard() {
  const state = useDailyStats();
  if (!state || state.overflow || !state.stats.hasDaily) return null;
  const { stats } = state;
  const { total } = stats;
  const plan = total.plan?.kind === 'plan' ? total.plan : null;
  const rows = stats.lines.slice(0, HOME_DAILY_ROWS);
  return (
    <section aria-labelledby="home-daily" data-testid="daily-home-card" data-bento="half" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon name="chart" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="home-daily" className="text-base font-semibold">
              Траты в день
            </h2>
            <p className="text-sm text-muted">Только ежедневные категории</p>
          </div>
          <Link to="/budgets" className="shrink-0 text-sm font-semibold text-brand">
            Подробнее
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">Сегодня потрачено</p>
        <p className="text-[clamp(1.5rem,7vw,2rem)] font-extrabold leading-tight tracking-tight" data-testid="daily-home-today">
          <MoneyText minor={total.today.totalMinor} currency={stats.base} tone={plan && plan.todayLeftMinor < 0 ? 'expense' : 'none'} />
          {total.limitPerDayMinor !== null && (
            <span className="text-base font-medium text-muted">
              {' из '}
              <MoneyText minor={total.limitPerDayMinor} currency={stats.base} tone="none" />
            </span>
          )}
        </p>
        {plan ? (
          <p className="mt-0.5 text-sm" data-testid="daily-home-reserve">
            {plan.reserveMinor >= 0 ? 'Запас месяца' : 'Перерасход месяца'}:{' '}
            <MoneyText minor={Math.abs(plan.reserveMinor)} currency={stats.base} tone={plan.reserveMinor >= 0 ? 'income' : 'expense'} className="font-semibold" />
          </p>
        ) : total.plan?.kind === 'unavailable' ? (
          <p className="mt-0.5 text-sm text-muted">{unavailableText(total.plan.reason)}</p>
        ) : (
          total.month.perDayMinor !== null && (
            <p className="mt-0.5 text-sm text-muted" data-testid="daily-home-average">
              В среднем за месяц <MoneyText minor={total.month.perDayMinor} currency={stats.base} tone="none" className="font-semibold" /> в день
            </p>
          )
        )}

        {rows.length > 0 && (
          <ul className="mt-2 divide-y divide-border/60">
            {rows.map((l) => (
              <Row key={l.key} line={l} base={stats.base} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
