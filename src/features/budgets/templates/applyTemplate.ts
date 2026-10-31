import type { Store } from '@/db';
import type { TemplateRow } from './budgetTemplates';
import { rowKey } from './budgetTemplates';

export interface TemplateApplyResult {
  created: number;
  updated: number;
  /** Сколько выбранных лимитов поставить не удалось (после первой ошибки остальные не ставятся). */
  failed: number;
  /** Первая ошибка, если была. */
  error: unknown;
}

/**
 * Ставит выбранные лимиты по очереди. Лимит на ту же категорию (или общий) обновляется, а не дублируется: так устроен репозиторий бюджетов
 * (детерминированный id). Строки без отметки не трогаются. Один общий «откат» здесь невозможен: репозиторий считает id (асинхронно) до
 * своей записи, а внутри чужой транзакции это её закрывает. Поэтому каждый лимит пишется сам по себе, а при ошибке рассказываем, сколько
 * уже поставлено: поставленное остаётся, остальное можно повторить (повтор ничего не дублирует).
 */
export async function applyTemplateRows(store: Store, rows: readonly TemplateRow[], selected: ReadonlySet<string>): Promise<TemplateApplyResult> {
  const result: TemplateApplyResult = { created: 0, updated: 0, failed: 0, error: null };
  const chosen = rows.filter((r) => selected.has(rowKey(r)));
  for (const [i, r] of chosen.entries()) {
    try {
      await store.budgets.create({ categoryId: r.categoryId, amountMinor: r.amountMinor });
      if (r.currentMinor === null) result.created++;
      else result.updated++;
    } catch (e) {
      result.failed = chosen.length - i;
      result.error = e;
      break;
    }
  }
  return result;
}

/** «Поставлено лимитов: 5, обновлено: 2». */
export function templateApplyText(r: TemplateApplyResult): string {
  const parts: string[] = [];
  if (r.created > 0) parts.push(`поставлено лимитов: ${r.created}`);
  if (r.updated > 0) parts.push(`обновлено: ${r.updated}`);
  if (parts.length === 0) return 'Ничего не изменилось';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
