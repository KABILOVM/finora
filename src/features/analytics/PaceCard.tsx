import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { formatMinor } from '@/domain/money';
import { budgetLabel, dayOfMonthText } from '@/features/budgets/budgetText';
import { endSentence } from '@/features/transactions/txDisplay';
import type { AnalyticsData } from './useAnalyticsData';

/** Есть ли что показать в карточке «Темп трат» (прогноз, лимиты на исходе или необычные траты). */
export const hasPaceContent = (d: Pick<AnalyticsData, 'pace' | 'budgetPaces' | 'unusual'>): boolean =>
  d.pace !== null || d.budgetPaces.length > 0 || d.unusual.length > 0;

/**
 * «Темп трат» для идущего месяца: во что выльются расходы к концу месяца при прежнем темпе, какие лимиты кончатся раньше и где уже
 * потрачено больше обычного. Прогноз линейный: сказано прямо, как он получен и чем может обмануть.
 */
export function PaceCard({ data }: { data: AnalyticsData }) {
  const { pace, budgetPaces, unusual, base, categories, month } = data;
  return (
    <Card aria-labelledby="analytics-pace" data-testid="pace-card" className="!py-4 md:!p-5">
      <h2 id="analytics-pace" className="mb-3 text-base font-semibold">
        Темп трат
      </h2>

      {pace && (
        <div data-testid="pace-projection">
          <p className="text-sm text-muted">К концу месяца при таком темпе расходы составят</p>
          <p className="mt-0.5 text-[clamp(1.5rem,7vw,2rem)] font-extrabold leading-tight tracking-tight">
            ≈ <span className="money">{formatMinor(pace.projectedMinor, base)}</span>
          </p>
          {pace.previousMinor > 0 && (
            <p className="mt-0.5 text-sm text-muted" data-testid="pace-previous">
              В прошлом месяце было <span className="money font-semibold text-text">{formatMinor(pace.previousMinor, base)}</span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            Считаем так: расходы ÷ прошедшие дни ({pace.elapsedDays} из {pace.totalDays}) × дней в месяце. Разовые крупные траты — аренда, покупка — искажают
            прогноз.
          </p>
        </div>
      )}

      {budgetPaces.length > 0 && (
        <section aria-label="Лимиты, которые закончатся раньше конца месяца" className={pace ? 'mt-4' : ''}>
          <h3 className="text-sm font-semibold text-warning">Лимиты не дотянут до конца месяца</h3>
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {budgetPaces.map((b) => {
              const label = budgetLabel(b.categoryId, categories);
              return (
                <li key={b.id} data-testid="pace-budget" className="flex items-start gap-3 py-2">
                  <Glyph value={label.icon} color={label.color ?? undefined} size={32} />
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{label.name}</span>: лимит {formatMinor(b.limitMinor, base)} закончится около {dayOfMonthText(month, b.pace.exhaustDay)}.
                    К концу месяца выйдет на {formatMinor(b.pace.overByMinor, base)} больше лимита.
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {unusual.length > 0 && (
        <section aria-label="Необычно много" className={pace || budgetPaces.length > 0 ? 'mt-4' : ''}>
          <h3 className="text-sm font-semibold">Необычно много в этом месяце</h3>
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {unusual.map((u) => {
              const label = budgetLabel(u.categoryId, categories);
              return (
                <li key={u.categoryId} data-testid="pace-unusual" className="flex items-start gap-3 py-2">
                  <Glyph value={label.icon} color={label.color ?? undefined} size={32} />
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{label.name}</span>: уже {formatMinor(u.spentMinor, base)}, а обычно за месяц около{' '}
                    {endSentence(formatMinor(u.usualMinor, base))}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Card>
  );
}
