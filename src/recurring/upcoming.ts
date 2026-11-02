import type { UpcomingItem } from '@/db';
import type { IsoDate } from '@/domain/types';
import { addDays, formatDayLabel, isValidIsoDate } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';

/** Чистая работа со списком «Предстоящих»: разбивка по разделам, подписи дат, строки виджета. */

/**
 * Сколько дней вперёд берётся из расписания для экрана «Регулярные платежи» (с запасом): по нему же считается «Следующий платёж»
 * и отсеиваются уже проведённые даты. Сам раздел «Скоро» показывает меньше — до конца месяца (см. `soonUntil`).
 */
export const SOON_DAYS = 30;
/** Ближайшая неделя в «Скоро» видна всегда: в последние дни месяца раздел не пустеет, хотя до начала следующего рукой подать. */
export const SOON_MIN_DAYS = 7;
/** Сколько дней вперёд показывает виджет на «Главной». */
export const WIDGET_DAYS = 7;
/** Строк в виджете. */
export const WIDGET_ROWS = 4;

/** Ключ одного платежа в списке: правило + дата (на нём держатся блокировки кнопок и key в React). */
export const itemKey = (item: Pick<UpcomingItem, 'rule' | 'date'>): string => `${item.rule.id}:${item.date}`;

export interface UpcomingGroups {
  overdue: UpcomingItem[];
  due: UpcomingItem[];
  soon: UpcomingItem[];
}

/**
 * Платежи, которые ещё предстоит провести или пропустить: уже проведённые и пропущенные (alreadyExists) отсеяны.
 * Порядок внутри раздела сохраняется (по возрастанию даты).
 */
export function groupUpcoming(items: readonly UpcomingItem[] | undefined): UpcomingGroups {
  const out: UpcomingGroups = { overdue: [], due: [], soon: [] };
  for (const it of items ?? []) {
    if (it.alreadyExists) continue;
    if (it.status === 'overdue') out.overdue.push(it);
    else if (it.status === 'due') out.due.push(it);
    else out.soon.push(it);
  }
  return out;
}

/** Последний день месяца, в котором лежит `date` («2026-11-02» → «2026-11-30»). Нечитаемая дата возвращается как есть. */
export function monthEnd(date: IsoDate): IsoDate {
  if (!isValidIsoDate(date)) return date;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const last = new Date(0);
  last.setUTCFullYear(y, m, 0); // нулевой день следующего месяца — последний день этого
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(last.getUTCFullYear(), 4)}-${pad(last.getUTCMonth() + 1, 2)}-${pad(last.getUTCDate(), 2)}`;
}

/**
 * До какой даты (включительно) раздел «Скоро» показывает платежи: до конца текущего месяца, но не ближе чем на неделю вперёд.
 * Так 2 ноября в «Скоро» нет декабрьской даты ежемесячного платежа, а 29 ноября ещё видно, что будет 1–6 декабря.
 */
export function soonUntil(today: IsoDate): IsoDate {
  if (!isValidIsoDate(today)) return today;
  const week = addDays(today, SOON_MIN_DAYS);
  const end = monthEnd(today);
  return end > week ? end : week;
}

/**
 * Подписи раздела «Скоро»: заголовок-подсказка, оборот для фраз («… платежей нет») и готовая фраза пустого состояния.
 * До конца месяца; в последние дни месяца, когда действует «неделя вперёд», — «ближайшие 7 дней».
 */
export function soonSpan(today: IsoDate): { hint: string; within: string; empty: string } {
  const toMonthEnd = isValidIsoDate(today) && soonUntil(today) === monthEnd(today);
  const within = toMonthEnd ? 'до конца месяца' : `на ближайшие ${SOON_MIN_DAYS} дней`;
  return {
    hint: toMonthEnd ? 'До конца месяца' : `Ближайшие ${SOON_MIN_DAYS} дней`,
    within,
    empty: `${within.charAt(0).toUpperCase()}${within.slice(1)} платежей нет.`,
  };
}

const DAY_MS = 86_400_000;

function dayNumber(date: IsoDate): number {
  const dt = new Date(0);
  dt.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round(dt.getTime() / DAY_MS);
}

/** Сколько дней от `from` до `to` (положительное — `to` позже). Нечитаемая дата — 0. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return 0;
  return dayNumber(to) - dayNumber(from);
}

/** «Просрочено на 1 день», «Просрочено на 3 дня», «Просрочено на 5 дней». */
export function overdueText(date: IsoDate, today: IsoDate): string {
  const n = Math.max(1, daysBetween(date, today));
  return `Просрочено на ${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
}

/** «сегодня», «просрочено на 3 дня» или «через 5 дней» — как далеко дата платежа от сегодняшнего дня. */
export function relativeText(date: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'сегодня';
  if (n < 0) return overdueText(date, today).toLowerCase();
  return `через ${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
}

/** «Сегодня», «Завтра», иначе «пн, 12 окт» (с годом, если он не текущий). */
export function whenText(date: IsoDate, today: IsoDate): string {
  if (isValidIsoDate(today) && isValidIsoDate(date) && date === addDays(today, 1)) return 'Завтра';
  return formatDayLabel(date, today);
}

export interface WidgetRows {
  rows: UpcomingItem[];
  /** Сколько платежей не поместилось («Ещё N»). */
  more: number;
}

/**
 * Строки виджета «Ближайшие платежи»: просроченные (самые старые первыми) и ближайшие `daysAhead` дней, не больше `max` строк.
 * Остальные считаются в `more`.
 */
export function widgetRows(
  items: readonly UpcomingItem[] | undefined,
  today: IsoDate,
  max: number = WIDGET_ROWS,
  daysAhead: number = WIDGET_DAYS,
): WidgetRows {
  const g = groupUpcoming(items);
  const limit = isValidIsoDate(today) ? addDays(today, daysAhead) : today;
  const all = [...g.overdue, ...g.due, ...g.soon.filter((i) => i.date <= limit)];
  return { rows: all.slice(0, max), more: Math.max(0, all.length - max) };
}
