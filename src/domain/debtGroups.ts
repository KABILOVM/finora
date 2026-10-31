import type { Debt, UUID } from './types';

/**
 * Объединение долгов: главный долг и его составляющие. У каждой составляющей остаются свои сумма, проценты, ставка, срок, даты,
 * платежи и планы — это обычные долги, у которых в `mergedIntoId` записан главный. В списке они идут одним долгом, а общая сумма
 * и остаток — сумма по составляющим (features/debts/debtSummary.ts). Чистые функции, без React и без базы.
 *
 * Связь действует, только если одновременно верно всё:
 *  - главный долг есть и не удалён, и это не сам долг;
 *  - главный сам ни в чей состав не входит (вложенности нет, циклы тоже невозможны);
 *  - направление и валюта те же (суммы разных валют не складываются).
 * Репозиторий создаёт только такие связи, но устройства работают независимо: пока одно объединяет, другое может удалить главный долг
 * или тоже объединить его с чем-то. Такая связь после синхронизации «не действует»: долг показывается сам по себе, ничего не пропадает.
 */

export type MergeLinked = Pick<Debt, 'id' | 'direction' | 'currency' | 'deletedAt'> & { mergedIntoId?: UUID | null };

export interface MergeLinks<D extends MergeLinked> {
  /** id составляющей → id главного долга. Только действующие связи. */
  rootOf: Map<UUID, UUID>;
  /** id главного долга → его составляющие (без самого главного), в порядке, в каком долги пришли. */
  parts: Map<UUID, D[]>;
}

export function mergeLinks<D extends MergeLinked>(debts: readonly D[]): MergeLinks<D> {
  const live = new Map<UUID, D>();
  for (const d of debts) if (d.deletedAt === null) live.set(d.id, d);
  const rootOf = new Map<UUID, UUID>();
  const parts = new Map<UUID, D[]>();
  for (const d of live.values()) {
    const rootId = d.mergedIntoId ?? null;
    if (rootId === null || rootId === d.id) continue;
    const root = live.get(rootId);
    if (root === undefined) continue; // главный удалён или ещё не пришёл
    if ((root.mergedIntoId ?? null) !== null) continue; // главный сам в чьём-то составе: вложенности нет
    if (root.direction !== d.direction || root.currency !== d.currency) continue;
    rootOf.set(d.id, rootId);
    const list = parts.get(rootId);
    if (list) list.push(d);
    else parts.set(rootId, [d]);
  }
  return { rootOf, parts };
}

/** Живые составляющие главного долга (без него самого). Пусто — объединения нет. */
export const partsOf = <D extends MergeLinked>(debts: readonly D[], rootId: UUID): D[] => mergeLinks(debts).parts.get(rootId) ?? [];
