import type { Frequency, IsoDate, RecurringRule } from './types';

/**
 * Расписание регулярных платежей — ЧИСТЫЕ функции (без базы, без часов, без часовых поясов).
 *
 * Правило задаёт «якорь» startOn и шаг: каждые intervalN дней / недель / месяцев / лет. k-я дата считается ОТ ЯКОРЯ
 * (а не от предыдущей даты), поэтому зажим не накапливается: 31 января → 28 (29) февраля → 31 марта → 30 апреля → 31 мая.
 * Месячное/годовое правило с 29–31 числом в коротком месяце срабатывает в последний день этого месяца
 * (29 февраля в невисокосный год → 28 февраля). Все даты лежат в 2000-01-01 … 2100-01-01 — как на сервере.
 * Даты — строки 'YYYY-MM-DD'; арифметика идёт через номера дней (Date.UTC), перехода на летнее время нет.
 */

/** Границы дат операции на сервере (включительно). */
export const SCHEDULE_MIN_DATE: IsoDate = '2000-01-01';
export const SCHEDULE_MAX_DATE: IsoDate = '2100-01-01';
/** Допустимый шаг: каждые 1…1000 периодов (как CHECK interval_n на сервере). */
export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 1000;

export type ScheduleRule = Pick<RecurringRule, 'frequency' | 'intervalN' | 'startOn' | 'endOn'>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const DAY_MS = 86_400_000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number, len: number) => String(n).padStart(len, '0');

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseYmd(s: unknown): Ymd | null {
  if (typeof s !== 'string') return null;
  const mt = DATE_RE.exec(s);
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Номер дня от 1970-01-01. Годы 2000…2100 — безопасно через Date.UTC. */
const dayNum = ({ y, m, d }: Ymd): number => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

function fromDayNum(n: number): IsoDate {
  const dt = new Date(n * DAY_MS);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

const fromYmd = ({ y, m, d }: Ymd): IsoDate => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

const MIN_DAY = dayNum(parseYmd(SCHEDULE_MIN_DATE) as Ymd);
const MAX_DAY = dayNum(parseYmd(SCHEDULE_MAX_DATE) as Ymd);

/** Настоящая дата в границах сервера (2000-01-01 … 2100-01-01). */
export function isScheduleDate(s: unknown): s is IsoDate {
  const ymd = parseYmd(s);
  if (!ymd) return false;
  const n = dayNum(ymd);
  return n >= MIN_DAY && n <= MAX_DAY;
}

/** Правило пригодно для расчёта: вид, шаг и даты в допустимых границах, конец не раньше начала. */
export function isValidSchedule(rule: ScheduleRule): boolean {
  if (!FREQUENCIES.includes(rule.frequency)) return false;
  if (!Number.isSafeInteger(rule.intervalN) || rule.intervalN < INTERVAL_MIN || rule.intervalN > INTERVAL_MAX) return false;
  if (!isScheduleDate(rule.startOn)) return false;
  if (rule.endOn !== null) {
    if (!isScheduleDate(rule.endOn)) return false;
    if (rule.endOn < rule.startOn) return false;
  }
  return true;
}

/** Сдвиг даты на n дней; null — вышли за границы сервера. */
function shiftDay(date: IsoDate, n: number): IsoDate | null {
  const ymd = parseYmd(date);
  if (!ymd) return null;
  const v = dayNum(ymd) + n;
  return v < MIN_DAY || v > MAX_DAY ? null : fromDayNum(v);
}

/** Дата k-го срабатывания (k ≥ 0); null — за верхней границей сервера. */
function dateAt(rule: ScheduleRule, start: Ymd, k: number): IsoDate | null {
  const n = rule.intervalN;
  switch (rule.frequency) {
    case 'daily':
    case 'weekly': {
      const v = dayNum(start) + k * n * (rule.frequency === 'weekly' ? 7 : 1);
      return v > MAX_DAY ? null : fromDayNum(v);
    }
    case 'monthly': {
      const idx = start.y * 12 + (start.m - 1) + k * n;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      if (y > 2100) return null;
      return fromYmd({ y, m, d: Math.min(start.d, daysInMonth(y, m)) });
    }
    case 'yearly': {
      const y = start.y + k * n;
      if (y > 2100) return null;
      return fromYmd({ y, m: start.m, d: Math.min(start.d, daysInMonth(y, start.m)) });
    }
  }
}

/** Верхний предел поиска: конец правила или граница сервера. */
const lastAllowed = (rule: ScheduleRule): IsoDate =>
  rule.endOn !== null && rule.endOn < SCHEDULE_MAX_DATE ? rule.endOn : SCHEDULE_MAX_DATE;

/** Приблизительный номер срабатывания, с которого стоит искать дату ≥ from (с запасом назад: дальше шагаем вперёд). */
function startIndex(rule: ScheduleRule, start: Ymd, from: IsoDate): number {
  const f = parseYmd(from);
  if (!f) return 0;
  const n = rule.intervalN;
  let k: number;
  switch (rule.frequency) {
    case 'daily':
      k = Math.floor((dayNum(f) - dayNum(start)) / n);
      break;
    case 'weekly':
      k = Math.floor((dayNum(f) - dayNum(start)) / (7 * n));
      break;
    case 'monthly':
      k = Math.floor(((f.y - start.y) * 12 + (f.m - start.m)) / n);
      break;
    case 'yearly':
      k = Math.floor((f.y - start.y) / n);
      break;
  }
  return Math.max(0, k - 1);
}

/**
 * Даты срабатывания правила в отрезке [from, to] (обе границы включительно), по возрастанию, без повторов.
 * Не раньше startOn, не позже endOn и не позже 2100-01-01. Пустой отрезок (from > to), некорректное правило или даты → [].
 */
export function occurrencesBetween(rule: ScheduleRule, from: IsoDate, to: IsoDate): IsoDate[] {
  if (!isValidSchedule(rule) || !isScheduleDate(from) || !isScheduleDate(to) || from > to) return [];
  const start = parseYmd(rule.startOn) as Ymd;
  const stop = to < lastAllowed(rule) ? to : lastAllowed(rule);
  const out: IsoDate[] = [];
  for (let k = startIndex(rule, start, from); ; k++) {
    const d = dateAt(rule, start, k);
    if (d === null || d > stop) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Ближайшее срабатывание СТРОГО после даты `after` (сама дата не считается); null — больше не будет. */
export function nextOccurrence(rule: ScheduleRule, after: IsoDate): IsoDate | null {
  if (!isValidSchedule(rule) || !parseYmd(after)) return null;
  const from = after < rule.startOn ? rule.startOn : shiftDay(after, 1);
  if (from === null) return null;
  const start = parseYmd(rule.startOn) as Ymd;
  const stop = lastAllowed(rule);
  for (let k = startIndex(rule, start, from); ; k++) {
    const d = dateAt(rule, start, k);
    if (d === null || d > stop) return null;
    if (d >= from) return d;
  }
}

/** Входит ли дата в расписание правила. */
export function isOccurrence(rule: ScheduleRule, date: IsoDate): boolean {
  return isScheduleDate(date) && occurrencesBetween(rule, date, date).length === 1;
}

export type UpcomingStatus = 'due' | 'overdue' | 'upcoming';

/** Статус даты относительно «сегодня»: сегодня — due, раньше — overdue, позже — upcoming. */
export function statusOf(date: IsoDate, today: IsoDate): UpcomingStatus {
  return date === today ? 'due' : date < today ? 'overdue' : 'upcoming';
}

export interface UpcomingEntry<R> {
  rule: R;
  date: IsoDate;
  status: UpcomingStatus;
}

/** Сколько дней вперёд и назад смотрят «Предстоящие» не дальше (защита от слишком больших окон). */
export const UPCOMING_MAX_DAYS_AHEAD = 3660;
export const UPCOMING_DEFAULT_LOOKBACK_DAYS = 366;

const clampDays = (n: number, max: number): number => (Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), max) : 0);

/**
 * Срабатывания правил в окне [сегодня − lookbackDays, сегодня + daysAhead], по возрастанию даты (при равных датах — в порядке правил).
 * Просроченные — с датой раньше сегодняшней, due — сегодняшние, upcoming — будущие. Какие из них уже проведены или пропущены,
 * здесь неизвестно (это знает база): см. useUpcoming. Правила в архиве и удалённые вызывающий отфильтровывает сам.
 */
export function upcomingOccurrences<R extends ScheduleRule & { id: string }>(
  rules: readonly R[],
  today: IsoDate,
  daysAhead: number,
  lookbackDays: number = UPCOMING_DEFAULT_LOOKBACK_DAYS,
): UpcomingEntry<R>[] {
  if (!parseYmd(today)) return [];
  const clampTo = (n: number, to: IsoDate | null, fallback: IsoDate): IsoDate => shiftDay(today, n) ?? to ?? fallback;
  const ahead = clampDays(daysAhead, UPCOMING_MAX_DAYS_AHEAD);
  const back = clampDays(lookbackDays, UPCOMING_MAX_DAYS_AHEAD);
  const from = clampTo(-back, null, SCHEDULE_MIN_DATE);
  const to = clampTo(ahead, null, SCHEDULE_MAX_DATE);
  const out: UpcomingEntry<R>[] = [];
  for (const rule of rules) {
    for (const date of occurrencesBetween(rule, from, to)) out.push({ rule, date, status: statusOf(date, today) });
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : 0));
}
