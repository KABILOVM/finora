import type { BudgetLevel } from '@/domain/budgetProgress';
import { levelOf, percentOf } from '@/domain/budgetLevels';
import type { PlanFact, PlanStatus } from '@/domain/dailyAverage';
import { pluralRu } from '@/lib/plural';

/** Слова и уровни для экранов «Траты в день» (чистые функции, без React). */

export const STATUS_WORD: Record<PlanStatus, string> = {
  ok: 'В норме',
  'above-plan': 'Сегодня выше плана',
  over: 'Перерасход',
};

export const STATUS_TONE: Record<PlanStatus, 'brand' | 'warning' | 'danger'> = { ok: 'brand', 'above-plan': 'warning', over: 'danger' };

type Plan = Extract<PlanFact, { kind: 'plan' }>;

/**
 * Уровень полосы месяца: сколько плана с начала месяца уже потрачено. Ровно в план (запас 0) — ещё не «исчерпано»: потратить до
 * среднего можно, превысить нельзя, поэтому красным полоса становится только при настоящем перерасходе.
 */
export function planLevel(plan: Plan): { percent: number; level: BudgetLevel } {
  const percent = percentOf(plan.spentToDateMinor, plan.planToDateMinor);
  if (plan.status === 'over') return { percent, level: 'over' };
  const level = levelOf(percent);
  return { percent, level: level === 'over' ? 'danger' : level };
}

/** «5 дней», «1 день». */
export const daysWord = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;

/** Почему плана нет: сегодня поездка или у человека ещё нет операций. */
export function unavailableText(reason: 'trip' | 'no-history'): string {
  return reason === 'trip' ? 'Сегодня вы в поездке: её траты в среднюю не входят' : 'Когда появятся траты, здесь будет план и факт';
}

export const PERIOD_LABEL = { today: 'Сегодня', week: '7 дней', last30: '30 дней', month: 'Месяц' } as const;
