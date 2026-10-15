import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState } from 'react';
import { useStore } from '@/db';
import { detectRecurring, WINDOW_DAYS, type SubscriptionCandidate } from '@/domain/subscriptions';
import type { IsoDate } from '@/domain/types';
import { addDays } from '@/lib/dates';
import type { RecurringLookups } from './useRecurringData';

/** Сколько отказов помним: старые вытесняются, чтобы список не рос бесконечно. */
const DISMISSED_MAX = 200;
const storageKey = (userId: string): string => `finora:dismissed-subs:${userId}`;

/** «Не показывать» хранится на этом устройстве (localStorage); если хранилище недоступно, отказ живёт до перезагрузки страницы. */
function readDismissed(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string').slice(-DISMISSED_MAX) : [];
  } catch {
    return [];
  }
}

function writeDismissed(userId: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(keys.slice(-DISMISSED_MAX)));
  } catch {
    // хранилище недоступно (приватный режим, переполнено): отказ действует, пока страница открыта
  }
}

export interface Subscriptions {
  items: SubscriptionCandidate[];
  dismiss: (key: string) => void;
}

/**
 * Повторяющиеся расходы, похожие на подписки и ещё не заведённые регулярным платежом (domain/subscriptions.ts), без тех, от кого человек
 * отказался. Только кошельки, которые не в архиве. undefined — ещё читается.
 */
export function useSubscriptions(lookups: RecurringLookups | null | undefined, today: IsoDate): Subscriptions | undefined {
  const store = useStore();
  const [dismissed, setDismissed] = useState<readonly string[]>(() => readDismissed(store.userId));
  const raw = useLiveQuery(async () => {
    const { db } = store;
    const [txs, rules] = await Promise.all([
      db.transactions
        .where('occurredOn')
        .between(addDays(today, -WINDOW_DAYS), today, true, true)
        .filter((t) => t.deletedAt === null && t.kind === 'expense')
        .toArray(),
      db.recurring_rules.toArray(),
    ]);
    return { txs, rules };
  }, [store, today]);

  const dismiss = useCallback(
    (key: string) =>
      setDismissed((cur) => {
        if (cur.includes(key)) return cur;
        const next = [...cur, key].slice(-DISMISSED_MAX);
        writeDismissed(store.userId, next);
        return next;
      }),
    [store.userId],
  );

  return useMemo(() => {
    if (!raw || !lookups) return undefined;
    const hidden = new Set(dismissed);
    const items = detectRecurring(raw.txs, raw.rules, today).filter((c) => {
      const wallet = lookups.wallets.get(c.walletId);
      return !hidden.has(c.key) && wallet !== undefined && wallet.deletedAt === null && wallet.archivedAt === null;
    });
    return { items, dismiss };
  }, [raw, dismissed, lookups, today, dismiss]);
}
