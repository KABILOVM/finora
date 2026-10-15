import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { formatMinor } from '@/domain/money';
import type { SubscriptionCandidate } from '@/domain/subscriptions';
import type { Frequency } from '@/domain/types';
import { longDate } from '@/features/budgets/budgetText';
import { pluralRu } from '@/lib/plural';
import type { RecurringLookups } from './useRecurringData';

/** Сколько подсказок показываем сразу; остальные — по кнопке. */
const SHOWN = 3;

export const stepWords = (frequency: Frequency, intervalN: number): string =>
  frequency === 'monthly' ? 'раз в месяц' : frequency === 'weekly' && intervalN === 2 ? 'раз в две недели' : 'каждую неделю';

/** Название подсказки: заметка из операций, иначе категория. */
export function candidateLabel(c: SubscriptionCandidate, lookups: Pick<RecurringLookups, 'categories'>): string {
  return c.note !== '' ? c.note : ((c.categoryId !== null ? lookups.categories.get(c.categoryId)?.name : undefined) ?? 'Расход');
}

export interface SubscriptionsCardProps {
  items: readonly SubscriptionCandidate[];
  lookups: RecurringLookups;
  onCreate: (c: SubscriptionCandidate) => void;
  onDismiss: (key: string) => void;
}

/**
 * «Похоже на подписки»: расходы, которые повторяются с одной и той же суммой, но не заведены регулярным платежом. «Создать платёж»
 * открывает обычное окно с заполненными полями; «Не показывать» убирает подсказку на этом устройстве.
 */
export function SubscriptionsCard({ items, lookups, onCreate, onDismiss }: SubscriptionsCardProps) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  const more = items.length - shown.length;
  return (
    <section aria-labelledby="rec-subs" data-testid="subscriptions-card" className="mb-6">
      <h2 id="rec-subs" className="mb-1 px-1 text-lg font-bold">
        Похоже на подписки
      </h2>
      <p className="mb-2 px-1 text-sm text-muted">Эти расходы повторяются, но не заведены как регулярный платёж. Если это подписка — заведите её, и приложение напомнит о платеже.</p>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {shown.map((c) => {
            const label = candidateLabel(c, lookups);
            const wallet = lookups.wallets.get(c.walletId);
            const currency = wallet?.currency ?? lookups.base;
            return (
              <li key={c.key} data-testid="subscription-item" className="flex flex-col gap-2 px-4 py-3">
                <div>
                  <p className="line-clamp-2 break-words font-semibold">{label}</p>
                  <p className="text-sm text-muted">
                    <span className="money">{formatMinor(c.amountMinor, currency)}</span> {stepWords(c.frequency, c.intervalN)} · {c.count}{' '}
                    {pluralRu(c.count, 'платёж', 'платежа', 'платежей')}, последний {longDate(c.lastOn)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" aria-label={`Создать платёж: ${label}`} onClick={() => onCreate(c)}>
                    Создать платёж
                  </Button>
                  <Button variant="ghost" aria-label={`Не показывать: ${label}`} onClick={() => onDismiss(c.key)}>
                    Не показывать
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        {more > 0 && (
          <div className="border-t border-border px-4 py-2">
            <Button variant="ghost" fullWidth onClick={() => setAll(true)}>
              Показать ещё {more}
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
