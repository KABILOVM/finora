import { useEffect, useState } from "react";
import { useStore, type Store } from "@/db";
import { sortByOrderThenName } from "@/db/sort";
import type {
  Category,
  CategoryKind,
  IsoDate,
  LocalRow,
  Wallet,
} from "@/domain/types";
import { addDays, todayLocal } from "@/lib/dates";

/** За сколько последних дней считаем «популярность» категорий и кошельков. */
export const POPULAR_DAYS = 365;

/** Сколько живых операций за POPULAR_DAYS дней приходится на категорию (по виду) и на кошелёк. */
export interface Popularity {
  categories: { expense: Map<string, number>; income: Map<string, number> };
  /** Кошелёк считается и как «откуда», и как «куда» (у перевода — оба). */
  wallets: Map<string, number>;
}

export const emptyPopularity = (): Popularity => ({
  categories: { expense: new Map(), income: new Map() },
  wallets: new Map(),
});

const bump = (m: Map<string, number>, id: string) =>
  m.set(id, (m.get(id) ?? 0) + 1);

/**
 * Считает по индексу даты: операции с датой не раньше `today − 365` (локальные даты, граница включена).
 * Удалённые не считаются. Архивные категории/кошельки тоже попадают в счёт — их просто нет в списках.
 */
export async function loadPopularity(
  store: Store,
  today: IsoDate,
): Promise<Popularity> {
  const out = emptyPopularity();
  const since = addDays(today, -POPULAR_DAYS);
  const rows = await store.db.transactions
    .where("occurredOn")
    .aboveOrEqual(since)
    .toArray();
  for (const t of rows) {
    if (t.deletedAt !== null) continue;
    if (t.kind === "expense" || t.kind === "income") {
      if (t.categoryId !== null) bump(out.categories[t.kind], t.categoryId);
    }
    bump(out.wallets, t.walletId);
    if (
      t.kind === "transfer" &&
      t.toWalletId !== null &&
      t.toWalletId !== t.walletId
    )
      bump(out.wallets, t.toWalletId);
  }
  return out;
}

/**
 * Один раз при открытии формы и ещё раз после каждого `version` (после сохранения). Не «живой» запрос:
 * чипы не должны прыгать под пальцем. undefined — ещё считается. Сбой чтения не мешает работе: берём пустой счёт.
 */
export function usePopularity(version = 0): Popularity | undefined {
  const store = useStore();
  const [pop, setPop] = useState<Popularity>();
  useEffect(() => {
    let alive = true;
    loadPopularity(store, todayLocal())
      .then((p) => alive && setPop(p))
      .catch((e: unknown) => {
        console.error("Не удалось посчитать частоту операций:", e);
        if (alive) setPop(emptyPopularity());
      });
    return () => {
      alive = false;
    };
  }, [store, version]);
  return pop;
}

/** Чаще — раньше; при равенстве (в т.ч. ноль) прежний порядок списка. Сортировка устойчивая, исходный список не меняется. */
export function rankByPopularity<T extends { id: string }>(
  items: readonly T[],
  counts: ReadonlyMap<string, number>,
): T[] {
  return [...items].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
  );
}

/** Категории одного вида: по убыванию популярности, при равенстве — sortOrder, затем название. */
export function rankCategories<T extends LocalRow<Category>>(
  categories: readonly T[],
  kind: CategoryKind,
  pop: Popularity,
): T[] {
  return rankByPopularity(
    sortByOrderThenName(categories.filter((c) => c.kind === kind)),
    pop.categories[kind],
  );
}

/** Кошельки: самый используемый первым, при равенстве — прежний порядок входного списка. */
export function rankWallets<T extends Pick<LocalRow<Wallet>, "id">>(
  wallets: readonly T[],
  pop: Popularity,
): T[] {
  return rankByPopularity(wallets, pop.wallets);
}
