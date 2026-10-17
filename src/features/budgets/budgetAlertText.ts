import type { BudgetAlert } from '@/domain/budgetAlerts';
import { formatMinor } from '@/domain/money';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';

/**
 * Текст подсказки: «Еда»: потрачено 90% лимита. Осталось 120 с. / Лимит «Еда» исчерпан: превышен на 45 с.
 * Ровно на лимите превышать не на что — «Лимит «Еда» исчерпан: потрачено 100%.» (а не «превышен на 0 с.»).
 */
export function alertMessage(a: BudgetAlert, name: string): string {
  if (a.level === 'over' && a.overMinor === 0) return `Лимит «${name}» исчерпан: потрачено 100%.`;
  if (a.level === 'over') return `Лимит «${name}» исчерпан: превышен на ${endSentence(formatMinor(a.overMinor, a.currency))}`;
  return `«${name}»: потрачено ${a.percent}% лимита. Осталось ${endSentence(formatMinor(a.remainingMinor, a.currency))}`;
}

/** Когда лимитов на исходе много сразу — одна общая подсказка вместо вороха. */
export const summaryMessage = (n: number): string =>
  `${n} ${pluralRu(n, 'лимит', 'лимита', 'лимитов')} на исходе или ${pluralRu(n, 'превышен', 'превышены', 'превышены')}`;
