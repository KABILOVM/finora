import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useStore, type Store } from '@/db';
import type { Category, IsoDate, LocalRow, Transaction, Wallet } from '@/domain/types';
import { addDays, todayLocal } from '@/lib/dates';
import { FREQUENT_DAYS } from './txForm';

/** Что шит «Новая операция» узнаёт о недавних операциях: «частые» категории и последний использованный кошелёк. */
export interface RecentStats {
  lastWalletId: string | null;
  /** Сколько раз за последние FREQUENT_DAYS дней использовалась каждая категория, отдельно для расходов и доходов. */
  counts: { expense: Map<string, number>; income: Map<string, number> };
}

const emptyStats = (): RecentStats => ({ lastWalletId: null, counts: { expense: new Map(), income: new Map() } });

/**
 * Читается по индексу даты. Последний использованный кошелёк — у операции, внесённой позже всех, среди 200 самых
 * свежих по дате (отдельного индекса по времени внесения нет; на подсказку кошелька это не влияет, он меняется чипом).
 */
export async function loadRecentStats(store: Store, today: IsoDate): Promise<RecentStats> {
  const stats = emptyStats();
  const since = addDays(today, -FREQUENT_DAYS);
  const recent = await store.db.transactions.where('occurredOn').aboveOrEqual(since).toArray();
  for (const t of recent) {
    if (t.deletedAt !== null || t.categoryId === null) continue;
    if (t.kind === 'expense' || t.kind === 'income') {
      const map = stats.counts[t.kind];
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1);
    }
  }
  const newest = await store.db.transactions.orderBy('occurredOn').reverse().limit(200).toArray();
  let last: LocalRow<Transaction> | null = null;
  for (const t of newest) {
    if (t.deletedAt === null && (last === null || t.createdAt > last.createdAt)) last = t;
  }
  stats.lastWalletId = last?.walletId ?? null;
  return stats;
}

/**
 * Один раз при открытии и ещё раз после каждого `version` (после сохранения). Не «живой» запрос: чипы категорий
 * не должны прыгать под пальцем, пока человек вводит операцию. Сбой чтения не мешает вносить деньги — берём пустую статистику.
 */
export function useRecentStats(version = 0): RecentStats | undefined {
  const store = useStore();
  const [stats, setStats] = useState<RecentStats>();
  useEffect(() => {
    let alive = true;
    loadRecentStats(store, todayLocal())
      .then((s) => alive && setStats(s))
      .catch((e: unknown) => {
        console.error('Не удалось прочитать недавние операции:', e);
        if (alive) setStats(emptyStats());
      });
    return () => {
      alive = false;
    };
  }, [store, version]);
  return stats;
}

/** Все кошельки по id, включая архивные и удалённые: у старой операции название кошелька должно находиться. */
export function useWalletIndex(): Map<string, LocalRow<Wallet>> | undefined {
  const store = useStore();
  return useLiveQuery(async () => new Map((await store.db.wallets.toArray()).map((w) => [w.id, w])), [store]);
}

/** Все категории по id, включая архивные и удалённые. */
export function useCategoryIndex(): Map<string, LocalRow<Category>> | undefined {
  const store = useStore();
  return useLiveQuery(async () => new Map((await store.db.categories.toArray()).map((c) => [c.id, c])), [store]);
}
