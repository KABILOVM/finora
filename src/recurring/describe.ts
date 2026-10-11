import type { Frequency, IsoDate } from '@/domain/types';
import { isValidIsoDate } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';

/**
 * Расписание регулярного платежа словами («Каждый месяц, 5-го»). Чистые функции: ни базы, ни часов, ни часового пояса.
 * Дни недели и месяцы берутся из самой даты начала (день недели — якорь недельного платежа).
 */

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** «по …»: дательный падеж множественного числа, индекс = getUTCDay() (0 — воскресенье). */
const WEEKDAYS_PO = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'] as const;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parse(date: IsoDate): Ymd | null {
  if (!isValidIsoDate(date)) return null;
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

/** День недели даты (0 — воскресенье) без участия часового пояса. */
export function weekdayOf(date: IsoDate): number | null {
  const p = parse(date);
  if (!p) return null;
  const dt = new Date(0);
  dt.setUTCFullYear(p.y, p.m - 1, p.d);
  return dt.getUTCDay();
}

/** «5 марта» — день и месяц даты начала (для годового платежа). */
export function dayAndMonth(date: IsoDate): string | null {
  const p = parse(date);
  return p ? `${p.d} ${MONTHS_GENITIVE[p.m - 1] ?? ''}` : null;
}

export interface ScheduleLike {
  frequency: Frequency;
  intervalN: number;
  startOn: IsoDate;
}

/**
 * «Каждый день», «Каждые 3 дня», «Каждую неделю по пятницам», «Каждые 2 недели по пятницам»,
 * «Каждый месяц, 5-го», «Каждые 2 месяца, 5-го», «Раз в год 1 марта», «Раз в 2 года 1 марта».
 * Шаг, которого быть не может (0, дробный), считается за 1: экран не должен падать из-за одной плохой строки.
 */
export function describeSchedule(rule: ScheduleLike): string {
  const n = Number.isSafeInteger(rule.intervalN) && rule.intervalN >= 1 ? rule.intervalN : 1;
  const p = parse(rule.startOn);
  switch (rule.frequency) {
    case 'daily':
      return n === 1 ? 'Каждый день' : `Каждые ${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
    case 'weekly': {
      const wd = weekdayOf(rule.startOn);
      const on = wd === null ? '' : ` по ${WEEKDAYS_PO[wd]}`;
      return n === 1 ? `Каждую неделю${on}` : `Каждые ${n} ${pluralRu(n, 'неделю', 'недели', 'недель')}${on}`;
    }
    case 'monthly': {
      const day = p ? `, ${p.d}-го` : '';
      return n === 1 ? `Каждый месяц${day}` : `Каждые ${n} ${pluralRu(n, 'месяц', 'месяца', 'месяцев')}${day}`;
    }
    case 'yearly': {
      const on = dayAndMonth(rule.startOn);
      const tail = on ? ` ${on}` : '';
      return n === 1 ? `Раз в год${tail}` : `Раз в ${n} ${pluralRu(n, 'год', 'года', 'лет')}${tail}`;
    }
    default:
      return 'Расписание не задано';
  }
}

/**
 * Подсказка про короткие месяцы: платёж на 29–31 число в месяце, где такого дня нет, проводится в последний день месяца.
 * Для годового платежа на 29 февраля — отдельная фраза. Иначе null.
 */
export function shortMonthHint(rule: Pick<ScheduleLike, 'frequency' | 'startOn'>): string | null {
  const p = parse(rule.startOn);
  if (!p) return null;
  if (rule.frequency === 'monthly' && p.d >= 29) return 'В коротких месяцах платёж будет в последний день месяца';
  if (rule.frequency === 'yearly' && p.m === 2 && p.d === 29) {
    return 'В невисокосный год платёж будет 28 февраля';
  }
  return null;
}
