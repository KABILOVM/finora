import type { Store } from '@/db';
import { isAdjustment } from '@/domain/adjustment';
import type { Transaction } from '@/domain/types';
import { humanError } from './txActions';

/**
 * Массовые действия над выделенными операциями списка «Операции».
 * Каждая операция меняется отдельной записью в базе (как и при правке по одной), поэтому при сбое посреди списка
 * уже сделанное остаётся сделанным: результат честно говорит, сколько операций прошло, а сколько нет.
 */

/** Что нужно знать об операции, чтобы решить, можно ли ей менять категорию. */
export type BulkTx = Pick<Transaction, 'kind' | 'debtId' | 'fxSource'>;

export type CategoryEligibility = { ok: true; kind: 'expense' | 'income' } | { ok: false; reason: string };

/**
 * Можно ли выделенным операциям одним движением поставить категорию. Категория бывает у расходов и доходов (у переводов её нет;
 * у движений денег по долгам и у «Корректировки остатка» она по замыслу пустая), и подходит только категория их вида —
 * поэтому все выделенные должны быть одного вида.
 */
export function categoryEligibility(selected: readonly BulkTx[]): CategoryEligibility {
  if (selected.length === 0) return { ok: false, reason: 'Выделите операции' };
  if (selected.some((t) => t.kind === 'transfer')) return { ok: false, reason: 'У переводов категории нет' };
  if (selected.some((t) => (t.debtId ?? null) !== null)) return { ok: false, reason: 'У операций по долгам категории нет' };
  if (selected.some((t) => isAdjustment(t))) return { ok: false, reason: 'Корректировке остатка категорию не ставят' };
  const kinds = new Set(selected.map((t) => t.kind));
  if (kinds.size > 1) return { ok: false, reason: 'Выделите только расходы или только доходы' };
  return { ok: true, kind: selected[0]?.kind === 'income' ? 'income' : 'expense' };
}

export interface BulkResult {
  /** id операций, с которыми действие удалось (в порядке выделения). */
  done: string[];
  /** Сколько не удалось. */
  failed: number;
  /** Понятный текст первой ошибки (если были). */
  error: string | null;
}

/** Выполняет действие по очереди; одна ошибка не останавливает остальные. */
async function eachOf(ids: readonly string[], act: (id: string) => Promise<unknown>, fallback: string): Promise<BulkResult> {
  const done: string[] = [];
  let failed = 0;
  let error: string | null = null;
  for (const id of ids) {
    try {
      await act(id);
      done.push(id);
    } catch (e) {
      console.error('Массовое действие: операция пропущена:', e);
      failed += 1;
      error ??= humanError(e, fallback);
    }
  }
  return { done, failed, error };
}

/** Мягкое удаление (операции остаются в базе скрытыми, как и при удалении по одной). */
export function deleteMany(store: Store, ids: readonly string[]): Promise<BulkResult> {
  return eachOf(ids, (id) => store.transactions.softDelete(id), 'Не удалось удалить операцию');
}

/** «Отменить» удаление: возвращает операции (если долг операции за это время удалён, её вернуть нельзя — это попадёт в error). */
export function restoreMany(store: Store, ids: readonly string[]): Promise<BulkResult> {
  return eachOf(ids, (id) => store.transactions.restore(id), 'Не удалось вернуть операцию');
}

export interface CategoryChange extends BulkResult {
  /** Что было у изменённых операций до правки: по нему делается «Отменить». */
  previous: Map<string, string | null>;
}

/** Ставит одну категорию всем указанным операциям. Прежние категории запоминаются для «Отменить». */
export async function setCategoryMany(
  store: Store,
  items: readonly { id: string; categoryId: string | null }[],
  categoryId: string,
): Promise<CategoryChange> {
  const before = new Map(items.map((t) => [t.id, t.categoryId] as const));
  const res = await eachOf(
    items.map((t) => t.id),
    (id) => store.transactions.update(id, { categoryId }),
    'Не удалось сменить категорию',
  );
  return { ...res, previous: new Map(res.done.map((id) => [id, before.get(id) ?? null] as const)) };
}

/** «Отменить» смену категории: каждой операции возвращается прежняя. */
export function revertCategories(store: Store, previous: ReadonlyMap<string, string | null>): Promise<BulkResult> {
  const ids = [...previous.keys()];
  return eachOf(ids, (id) => store.transactions.update(id, { categoryId: previous.get(id) ?? null }), 'Не удалось вернуть категорию');
}
