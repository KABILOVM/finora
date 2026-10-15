import type { BudgetAlert } from '@/domain/budgetAlerts';
import { formatMinor } from '@/domain/money';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';

/** Текст подсказки: «Еда»: потрачено 90% лимита. Осталось 120 с. / Лимит «Еда» превышен на 45 с. */
export function alertMessage(a: BudgetAlert, name: string): string {
  if (a.level === 'over') return `Лимит «${name}» исчерпан: превышен на ${endSentence(formatMinor(a.overMinor, a.currency))}`;
  return `«${name}»: потрачено ${a.percent}% лимита. Осталось ${endSentence(formatMinor(a.remainingMinor, a.currency))}`;
}

/** Когда лимитов на исходе много сразу — одна общая подсказка вместо вороха. */
export const summaryMessage = (n: number): string => `${n} ${pluralRu(n, 'лимит', 'лимита', 'лимитов')} на исходе или превышены`;
