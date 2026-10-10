import type { IsoDate } from '@/domain/types';

/**
 * Календарные даты 'YYYY-MM-DD' в часовом поясе пользователя.
 * Главное правило: НИКОГДА не брать дату через toISOString() — это UTC, и в Таджикистане (UTC+5)
 * с полуночи до 5 утра «сегодня» оказалось бы вчерашним днём.
 * Арифметика дат идёт через Date.UTC, поэтому не зависит ни от часового пояса, ни от перехода на летнее время.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;
/** Родительный падеж, коротко: «5 окт», «5 мая». */
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;
const MONTHS_TITLE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parseYmd(s: unknown): Ymd | null {
  if (typeof s !== 'string') return null;
  const match = ISO_DATE.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  // Реальная проверка календаря (30 февраля, 31 апреля, 29 февраля не в високосный год).
  const check = new Date(ymdToUtcMs({ y, m, d }));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Полночь UTC этой даты. Date.UTC для годов 0–99 даёт 1900–1999, поэтому год выставляем через setUTCFullYear. */
function ymdToUtcMs({ y, m, d }: Ymd): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getTime();
}

function requireYmd(s: string): Ymd {
  const ymd = parseYmd(s);
  if (!ymd) throw new RangeError(`Некорректная дата: ${String(s)}`);
  return ymd;
}

/** Строго настоящая дата 'YYYY-MM-DD' (отсекает 2026-02-30, 2026-13-01, 2026-1-5, пустые и не-строки). */
export function isValidIsoDate(s: unknown): s is IsoDate {
  return parseYmd(s) !== null;
}

/** Сегодняшняя дата по местным часам устройства. `now` — для тестов. */
export function todayLocal(now: Date = new Date()): IsoDate {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Сдвиг на n дней (можно отрицательное). Бросает RangeError на некорректной дате или нецелом n. */
export function addDays(date: IsoDate, n: number): IsoDate {
  if (!Number.isInteger(n)) throw new RangeError(`Число дней должно быть целым: ${n}`);
  const ms = ymdToUtcMs(requireYmd(date)) + n * 86_400_000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) throw new RangeError('Дата вне допустимого диапазона');
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Подпись дня для списков: «Сегодня», «Вчера», иначе «пн, 5 окт» (с годом, если он не текущий: «пн, 5 окт 2025»).
 * Некорректную дату возвращает как есть — экран не должен падать из-за одной плохой строки.
 */
export function formatDayLabel(date: IsoDate, today: IsoDate = todayLocal()): string {
  const ymd = parseYmd(date);
  if (!ymd) return String(date);
  if (date === today) return 'Сегодня';
  if (isValidIsoDate(today)) {
    if (date === addDays(today, -1)) return 'Вчера';
  }
  const weekday = WEEKDAYS_SHORT[new Date(ymdToUtcMs(ymd)).getUTCDay()] ?? '';
  const month = MONTHS_SHORT[ymd.m - 1] ?? '';
  const todayYear = parseYmd(today)?.y;
  const year = todayYear !== undefined && todayYear === ymd.y ? '' : ` ${ymd.y}`;
  return `${weekday}, ${ymd.d} ${month}${year}`;
}

/** '2026-10-05' → '2026-10'. Бросает RangeError на некорректной дате. */
export function monthKey(date: IsoDate): string {
  const { y, m } = requireYmd(date);
  return `${pad(y, 4)}-${pad(m)}`;
}

/** '2026-10' или '2026-10-05' → 'Октябрь 2026'. Бросает RangeError на некорректном входе. */
export function monthTitle(keyOrDate: string): string {
  const match = MONTH_KEY.exec(keyOrDate);
  let y: number;
  let m: number;
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
  } else {
    ({ y, m } = requireYmd(keyOrDate));
  }
  const name = MONTHS_TITLE[m - 1];
  if (!name) throw new RangeError(`Некорректный месяц: ${keyOrDate}`);
  return `${name} ${y}`;
}
