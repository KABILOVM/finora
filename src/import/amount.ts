import { exponentOf } from '@/domain/currency';
import { parseAmountToMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { AMOUNT_MAX } from '@/db/validate';

/**
 * Строгий разбор суммы из чужого файла. Никаких float: текст приводится к виду «целая.дробная» и отдаётся в
 * parseAmountToMinor (целочисленная арифметика, переполнение — отказ). Неоднозначное не угадывается:
 * «1,000» — это тысяча или единица? Такая строка уходит в «Нужно проверить».
 */

export type AmountBadCode = 'unreadable' | 'negative' | 'ambiguous' | 'precision' | 'big';

/** Сумма, прочитанная как текст (валюта ещё неизвестна). */
export type AmountScan =
  | { kind: 'zero' }
  | { kind: 'number'; int: string; frac: string }
  | { kind: 'bad'; code: AmountBadCode };

const SPACES = /[\s\u00a0\u202f\u2009']/g;
const GROUPS = /^\d{1,3}$/;
const GROUP3 = /^\d{3}$/;

/** Целая часть «с разделителями тысяч»: первая группа 1–3 цифры, остальные ровно по 3. */
function joinGrouped(whole: string, sep: string): string | null {
  const parts = whole.split(sep);
  const [first, ...rest] = parts;
  if (first === undefined || !GROUPS.test(first) || rest.some((p) => !GROUP3.test(p))) return null;
  return parts.join('');
}

export function scanAmount(raw: string): AmountScan {
  let s = raw.replace(SPACES, '');
  if (s === '') return { kind: 'zero' };
  if (s.startsWith('-') || s.startsWith('−')) {
    // «-» без числа — пустая ячейка; «-0» — ноль; «-12» — отрицательная сумма (в Zenmoney суммы без знака)
    const rest = scanAmount(s.slice(1));
    return rest.kind === 'number' ? { kind: 'bad', code: 'negative' } : rest;
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { kind: 'bad', code: 'unreadable' };
  if (/^[0.,]*0[0.,]*$/.test(s)) return { kind: 'zero' };

  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;

  if (dots === 0 && commas === 0) return { kind: 'number', int: s, frac: '' };

  if (dots > 0 && commas > 0) {
    // Последний знак — десятичный, другой — разделитель тысяч
    const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const dec = s[last]!;
    const thousands = dec === '.' ? ',' : '.';
    const decCount = dec === '.' ? dots : commas;
    const whole = s.slice(0, last);
    const frac = s.slice(last + 1);
    if (decCount !== 1 || whole.includes(dec) || !/^\d+$/.test(frac)) return { kind: 'bad', code: 'unreadable' };
    const int = joinGrouped(whole, thousands);
    return int === null ? { kind: 'bad', code: 'unreadable' } : { kind: 'number', int, frac };
  }

  const sep = dots > 0 ? '.' : ',';
  const count = dots > 0 ? dots : commas;
  if (count >= 2) {
    // Два одинаковых знака подряд не могут быть десятичными: это разделители тысяч
    const int = joinGrouped(s, sep);
    return int === null ? { kind: 'bad', code: 'unreadable' } : { kind: 'number', int, frac: '' };
  }
  const at = s.indexOf(sep);
  const int = s.slice(0, at);
  const frac = s.slice(at + 1);
  if (frac.length === 3 && GROUPS.test(int) && !int.startsWith('0')) return { kind: 'bad', code: 'ambiguous' };
  return { kind: 'number', int: int === '' ? '0' : int, frac };
}

export type AmountMinor = { ok: true; minor: Minor } | { ok: false; code: AmountBadCode };

/** Текстовая сумма → минорные единицы валюты. Знаков после запятой больше, чем у валюты, — отказ (не округляем). */
export function amountToMinor(num: { int: string; frac: string }, currency: CurrencyCode): AmountMinor {
  if (num.frac.length > exponentOf(currency)) return { ok: false, code: 'precision' };
  const int = num.int.replace(/^0+(?=\d)/, ''); // «0000012» — это 12, а не «слишком длинное число»
  const minor = parseAmountToMinor(num.frac === '' ? int : `${int}.${num.frac}`, currency);
  if (minor === null || minor > AMOUNT_MAX) return { ok: false, code: 'big' };
  if (minor === 0) return { ok: false, code: 'unreadable' }; // нули отсеяны раньше: сюда не попадает
  return { ok: true, minor };
}

/** Код валюты из файла: три латинские буквы (в любом регистре) или понятный знак. Иначе null — не гадаем. */
const SYMBOLS: Record<string, CurrencyCode> = {
  $: 'USD',
  '€': 'EUR',
  '₽': 'RUB',
  '£': 'GBP',
  '₸': 'KZT',
  '₺': 'TRY',
  РУБ: 'RUB',
  'РУБ.': 'RUB',
  СОМОНИ: 'TJS',
  СМН: 'TJS',
};

export function parseZenCurrency(raw: string): CurrencyCode | null {
  const s = raw.replace(/[\s\u00a0]/g, '').toLocaleUpperCase('ru');
  if (/^[A-Z]{3}$/.test(s)) return s;
  return SYMBOLS[s] ?? null;
}
