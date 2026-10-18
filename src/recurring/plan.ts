import { occurrencesBetween } from '@/domain/schedule';
import type { IsoDate, RecurringRule } from '@/domain/types';
import { addDays, isValidIsoDate, todayLocal } from '@/lib/dates';

/**
 * Что автопроведение имеет право провести. Чистые функции: ни базы, ни часов (сегодняшняя дата приходит параметром).
 *
 * Правило «не проводить историю»: берём даты не раньше самой поздней из четырёх границ —
 *  1) начало расписания (startOn),
 *  2) день, когда правило создано (по местным часам устройства),
 *  3) день последней правки правила (по местным часам устройства),
 *  4) «сегодня − 60 дней».
 * Всё более раннее остаётся в «Просроченных» и проводится только вручную: человек сам решает, что с этим делать.
 *
 * Зачем третья граница. Операция опознаётся по id = v5(правило, дата): новое расписание (другой день платежа, другая частота)
 * даёт другие даты, и «уже проведено» их не закрывает. Платёж «действует» с того дня, как человек его правил: включил
 * «Проводить само», поменял расписание, вернул из архива (всё это — правка правила, и она ставит новую метку). Дни до правки
 * автоматика не трогает, иначе месяцы, уже проведённые по прежнему расписанию, записались бы второй раз.
 * Цена: если правка пришла раньше, чем проведён пропущенный день (например, с другого устройства), этот день ждёт в «Просроченных».
 */

export const AUTO_POST_MAX_AGE_DAYS = 60;
/** Прогноз «в день» вычитает не проведённые и не пропущенные платежи не старше стольких дней. */
export const FORECAST_OVERDUE_MAX_AGE_DAYS = 31;
/** Не больше стольких новых операций за один проход (дальше — на следующем проходе). */
export const AUTO_POST_MAX_PER_PASS = 200;

export type LocalDateOf = (iso: string) => IsoDate | null;

/** Местная дата устройства для метки времени ISO; null — метка нечитаема. */
export const localDateOf: LocalDateOf = (iso) => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? todayLocal(new Date(ms)) : null;
};

type RuleLike = Pick<RecurringRule, 'frequency' | 'intervalN' | 'startOn' | 'endOn' | 'createdAt' | 'clientUpdatedAt'>;

const later = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b);

/**
 * С какой даты прошлые даты правила считаются «настоящими» (четыре границы из шапки, последняя — «сегодня − maxAgeDays»).
 * Может быть позже сегодняшнего дня (правило начнётся позже или создано «в будущем»). null — сегодняшняя дата нечитаема.
 */
export function historyFrom(rule: RuleLike, today: IsoDate, maxAgeDays: number, toLocal: LocalDateOf = localDateOf): IsoDate | null {
  if (!isValidIsoDate(today)) return null;
  // Время создания не прочитать — историю не трогаем, берём только сегодняшний день.
  const created = toLocal(rule.createdAt) ?? today;
  // То же для последней правки. Метка из будущего (часы устройства убегали вперёд) сегодняшние платежи не откладывает.
  const changedOn = toLocal(rule.clientUpdatedAt) ?? today;
  const changed = changedOn > today ? today : changedOn;
  return later(later(later(rule.startOn, created), changed), addDays(today, -maxAgeDays));
}

/** Отрезок дат, которые можно проводить само; null — проводить нечего (правило начнётся позже или создано «в будущем»). */
export function autoPostWindow(rule: RuleLike, today: IsoDate, toLocal: LocalDateOf = localDateOf): { from: IsoDate; to: IsoDate } | null {
  const from = historyFrom(rule, today, AUTO_POST_MAX_AGE_DAYS, toLocal);
  return from === null || from > today ? null : { from, to: today };
}

/** Даты расписания правила, которые автопроведение может провести (по возрастанию). */
export function autoPostDates(rule: RuleLike, today: IsoDate, toLocal: LocalDateOf = localDateOf): IsoDate[] {
  const w = autoPostWindow(rule, today, toLocal);
  return w ? occurrencesBetween(rule, w.from, w.to) : [];
}

export interface Candidate<R> {
  rule: R;
  date: IsoDate;
}

type EligibleRule = RuleLike & Pick<RecurringRule, 'id' | 'autoPost' | 'archivedAt' | 'deletedAt'>;

/** Правило участвует в автопроведении: «проводить само», живое, не в архиве. */
export const isAutoPostRule = (r: Pick<RecurringRule, 'autoPost' | 'archivedAt' | 'deletedAt'>): boolean =>
  r.autoPost === 1 && r.archivedAt === null && r.deletedAt === null;

/**
 * Все (правило, дата), которые автопроведение вправе провести к сегодняшнему дню; старые даты первыми.
 * Какие из них уже проведены или пропущены, знает только база — это отсеивает вызывающий.
 */
export function collectCandidates<R extends EligibleRule>(
  rules: readonly R[],
  today: IsoDate,
  toLocal: LocalDateOf = localDateOf,
): Candidate<R>[] {
  const out: Candidate<R>[] = [];
  for (const rule of rules) {
    if (!isAutoPostRule(rule)) continue;
    for (const date of autoPostDates(rule, today, toLocal)) out.push({ rule, date });
  }
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.rule.createdAt !== b.rule.createdAt) return a.rule.createdAt < b.rule.createdAt ? -1 : 1;
    return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
  });
}
