import { describe, expect, it } from 'vitest';
import type { BudgetAlert } from '@/domain/budgetAlerts';
import { alertMessage, summaryMessage } from './budgetAlertText';

const nb = (s: string) => s.replace(/ /g, ' ');
const alert = (over: Partial<BudgetAlert>): BudgetAlert => ({
  budgetId: 'b',
  categoryId: 'c',
  level: 'warn',
  percent: 75,
  remainingMinor: 25_000,
  overMinor: 0,
  currency: 'TJS',
  ...over,
});

describe('alertMessage: текст подсказки о лимите', () => {
  it('на исходе: процент и сколько осталось', () => {
    expect(nb(alertMessage(alert({ level: 'danger', percent: 90, remainingMinor: 12_000 }), 'Еда'))).toBe(
      '«Еда»: потрачено 90% лимита. Осталось 120 с.',
    );
  });

  it('превышен: на сколько', () => {
    expect(nb(alertMessage(alert({ level: 'over', percent: 105, remainingMinor: 0, overMinor: 5_000 }), 'Еда'))).toBe(
      'Лимит «Еда» исчерпан: превышен на 50 с.',
    );
  });

  it('потрачено ровно столько, сколько лимит: «исчерпан», без «превышен на 0 с.»', () => {
    const text = nb(alertMessage(alert({ level: 'over', percent: 100, remainingMinor: 0, overMinor: 0 }), 'Еда'));
    expect(text).toBe('Лимит «Еда» исчерпан: потрачено 100%.');
    expect(text).not.toContain('превышен');
  });

  it('сводка склоняет «лимит»', () => {
    expect(summaryMessage(2)).toBe('2 лимита на исходе или превышены');
    expect(summaryMessage(5)).toBe('5 лимитов на исходе или превышены');
  });
});
