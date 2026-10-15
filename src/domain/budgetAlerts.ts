import type { BudgetLevel, BudgetProgress } from './budgetProgress';
import type { CurrencyCode, Minor, UUID } from './types';

/**
 * Когда сказать «лимит на исходе»: сравниваем уровни бюджетов при прошлой проверке и сейчас (levelOf: 70 / 90 / 100%).
 * ЧИСТАЯ функция: без базы, React и часов. Сообщаем только о ПОДЪЁМЕ уровня; первая проверка и новые бюджеты запоминаются молча
 * (иначе при каждом запуске приложения человек получал бы напоминание про лимит, который превышен давно).
 */

export type AlertLevel = Exclude<BudgetLevel, 'ok'>;

export interface BudgetAlert {
  budgetId: UUID;
  /** null — общий лимит на все расходы. */
  categoryId: UUID | null;
  level: AlertLevel;
  /** Целый процент, округление вниз (может быть больше 100). */
  percent: number;
  /** Сколько ещё можно потратить (0, если лимит исчерпан). */
  remainingMinor: Minor;
  /** На сколько лимит превышен (0, если не превышен). */
  overMinor: Minor;
  currency: CurrencyCode;
}

export type LevelMap = ReadonlyMap<UUID, BudgetLevel>;

const RANK: Record<BudgetLevel, number> = { ok: 0, warn: 1, danger: 2, over: 3 };

export interface AlertCheck {
  alerts: BudgetAlert[];
  /** Уровни сейчас: передаются в следующую проверку. */
  next: Map<UUID, BudgetLevel>;
}

/**
 * previous — уровни прошлой проверки того же месяца; null — проверка первая (или месяц сменился): только запоминаем.
 * Бюджет в другой валюте (comparable: false) не проверяется и в `next` не попадает. Самые тяжёлые уровни — первыми.
 */
export function crossedThresholds(previous: LevelMap | null, items: readonly BudgetProgress[]): AlertCheck {
  const next = new Map<UUID, BudgetLevel>();
  const alerts: BudgetAlert[] = [];
  for (const p of items) {
    if (!p.comparable) continue;
    next.set(p.id, p.level);
    if (previous === null) continue;
    const before = previous.get(p.id);
    if (before === undefined) continue; // бюджет только что появился: человек сам его поставил
    if (p.level !== 'ok' && RANK[p.level] > RANK[before]) {
      alerts.push({
        budgetId: p.id,
        categoryId: p.categoryId,
        level: p.level,
        percent: p.percent,
        remainingMinor: p.remainingMinor,
        overMinor: p.overMinor,
        currency: p.currency,
      });
    }
  }
  alerts.sort((a, b) => RANK[b.level] - RANK[a.level] || b.percent - a.percent || (a.budgetId < b.budgetId ? -1 : 1));
  return { alerts, next };
}
