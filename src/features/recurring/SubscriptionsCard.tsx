import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
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

/** На сколько процентов подорожало: (стало − было) / было, целым. */
export const risePercent = (now: number, was: number): number => Math.round(((now - was) * 100) / was);

/** Сколько всего в год по подсказкам: по валюте кошелька, «≈ 14 400 с. + ≈ 120 $». Пусто, если подсказок нет. */
export function yearlyTotals(items: readonly SubscriptionCandidate[], lookups: Pick<RecurringLookups, 'wallets' | 'base'>): string {
  const byCurrency = new Map<string, number>();
  for (const c of items) {
    const currency = lookups.wallets.get(c.walletId)?.currency ?? lookups.base;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + c.yearlyMinor);
  }
  return [...byCurrency.entries()].map(([currency, minor]) => `≈ ${formatMinor(minor, currency)}`).join(' + ');
}

export interface SubscriptionsCardProps {
  items: readonly SubscriptionCandidate[];
  /** Раскрыта ли карточка. Состояние держит страница: карточка переезжает с места на место (нет платежей → есть платежи) и иначе сворачивалась бы. */
  open: boolean;
  onToggle: () => void;
  lookups: RecurringLookups;
  onCreate: (c: SubscriptionCandidate) => void;
  onDismiss: (key: string) => void;
}

/**
 * «Похоже на подписки»: расходы, которые повторяются с одной и той же суммой, но не заведены регулярным платежом. Свёрнуто в одну
 * строку «Похоже на подписки · N» (подсказки не вытесняют ближайшие платежи); по нажатию раскрывается. «Создать платёж» открывает
 * обычное окно с заполненными полями; «Не показывать» убирает подсказку на этом устройстве.
 */
export function SubscriptionsCard({ items, open, onToggle, lookups, onCreate, onDismiss }: SubscriptionsCardProps) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  const more = items.length - shown.length;
  const total = yearlyTotals(items, lookups);
  const risen = items.filter((c) => c.previousAmountMinor !== null).length;
  return (
    <section aria-labelledby="rec-subs" data-testid="subscriptions-card" className="mb-6">
      <h2 id="rec-subs">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left text-sm font-bold uppercase tracking-wide text-muted"
        >
          <span>Похоже на подписки · {items.length}</span>
          <Icon name="chevron" size={18} className={open ? 'rotate-90' : ''} />
        </button>
      </h2>
      {!open && (
        <p className="px-1 text-sm text-muted">
          Расходы, которые повторяются, но не заведены как регулярный платёж. В сумме {total} в год.
          {risen > 0 && ` Подорожало: ${risen}.`}
        </p>
      )}
      {open && (
        <>
          <p className="mb-2 px-1 text-sm text-muted">Эти расходы повторяются, но не заведены как регулярный платёж. Если это подписка — заведите её, и приложение напомнит о платеже.</p>
          <p data-testid="subscriptions-total" className="mb-2 px-1 text-base font-semibold">
            Всего в год: <span className="money">{total}</span>
          </p>
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
                      <p className="text-sm text-muted">
                        В год ≈ <span className="money">{formatMinor(c.yearlyMinor, currency)}</span>
                      </p>
                      {c.previousAmountMinor !== null && (
                        <p data-testid="subscription-rise" className="text-sm font-medium text-warning">
                          Подорожало: было <span className="money">{formatMinor(c.previousAmountMinor, currency)}</span>, стало{' '}
                          <span className="money">{formatMinor(c.amountMinor, currency)}</span> (+{risePercent(c.amountMinor, c.previousAmountMinor)}%)
                        </p>
                      )}
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
        </>
      )}
    </section>
  );
}
