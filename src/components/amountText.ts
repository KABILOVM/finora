import { exponentOf } from '@/domain/currency';
import { minorToInputString, parseAmountToMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';

/**
 * Черновик суммы — строка вида '12,5' (запятая — десятичный разделитель, других символов нет).
 * В число (Minor) она превращается ТОЛЬКО через parseAmountToMinor из domain/money.ts.
 *
 * Лимит: не больше 15 цифр в минорных единицах (целая часть + знаки валюты).
 * Для сомони это до 13 цифр до запятой (9 999 999 999 999,99), для иены — 15.
 * Так любая введённая сумма гарантированно безопасна для Number и разбирается без null.
 */
export const MAX_DIGITS = 15;

export type AmountKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'backspace';

const NBSP = '\u00A0';

function split(text: string): { int: string; frac: string; hasComma: boolean } {
  const i = text.indexOf(',');
  if (i < 0) return { int: text, frac: '', hasComma: false };
  return { int: text.slice(0, i), frac: text.slice(i + 1), hasComma: true };
}

/** Применяет одно нажатие к черновику. Недопустимое нажатие возвращает черновик без изменений. */
export function applyKey(text: string, key: AmountKey, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  const { int, frac, hasComma } = split(text);

  if (key === 'backspace') return text.slice(0, -1);

  if (key === ',') {
    if (exp === 0 || hasComma) return text;
    return text === '' ? '0,' : text + ',';
  }

  // Цифра.
  if (hasComma) {
    if (frac.length >= exp) return text; // больше знаков, чем у валюты, ввести нельзя
    return text + key;
  }
  if (int === '0') return key === '0' ? text : key; // без ведущих нулей: '0' + '5' → '5'
  if (int.length + exp >= MAX_DIGITS) return text; // 15 цифр в минорных единицах — предел
  return text + key;
}

/**
 * Число в тексте: цифры, внутри них пробелы (не переводы строк), точки, запятые, апострофы;
 * сразу перед цифрами или сразу после них — один разделитель («,5», «12.»). Всё остальное вокруг — мусор.
 */
const NUMBER_TOKEN = /[.,]?\d(?:(?:[\d.,'’]|[^\S\r\n])*\d)?[.,]?/g;

/** Разбор числа с разделителями на целую и дробную части. null — однозначно прочитать нельзя. */
function readNumber(token: string): { int: string; frac: string | null } | null {
  let u = token.replace(/[^\d.,]/g, ''); // пробелы и апострофы — разделители тысяч, цифры/точки/запятые остаются
  // Лишний разделитель в конце («12,50.» — точка из конца фразы) — отбрасываем, если разделитель уже есть.
  if (/[.,]$/.test(u) && /[.,]/.test(u.slice(0, -1))) u = u.slice(0, -1);

  const seps = u.match(/[.,]/g) ?? [];
  const first = seps[0];
  const last = seps[seps.length - 1];
  if (first === undefined || last === undefined) return { int: u, frac: null };
  // Один разделитель — десятичный (как в parseAmountToMinor): «1.234» — это 1,234, а не 1234.
  if (seps.length === 1) {
    const i = u.search(/[.,]/);
    return { int: u.slice(0, i), frac: u.slice(i + 1) };
  }

  // Несколько разделителей. Одинаковые («1.234.567») — только тысячи. Разные («1.234,56», «1,234.56») —
  // последний десятичный, остальные тысячи. Любая другая смесь («1,2,3», «12.03.2026») — не число.
  const mixed = last !== first;
  if (mixed && !seps.slice(0, -1).every((c) => c === first)) return null;
  const cut = mixed ? u.lastIndexOf(last) : u.length;
  const groups = u.slice(0, cut).split(first);
  const [head = '', ...rest] = groups;
  if (!/^\d{1,3}$/.test(head) || !rest.every((g) => /^\d{3}$/.test(g))) return null;
  return { int: groups.join(''), frac: mixed ? u.slice(cut + 1) : null };
}

/**
 * Превращает произвольную строку (вставка из буфера, набор на клавиатуре ПК) в черновик суммы.
 * Читает строку целиком и по тем же правилам, что parseAmountToMinor: если число нельзя прочитать
 * однозначно или без потери копеек — возвращает '' (отказ), а не «что получилось».
 *  - «1 234,56», «1.234,56», «1,234.56» → «1234,56»; «1.234.567» → «1234567»;
 *  - «1.234» и «1,000» (три цифры после одного разделителя), «12.5» (иена), «12,505», «1e5» (два числа), 16+ цифр → '';
 *  - буквы, знак и символ валюты вокруг числа отбрасываются: «1 234,56 с.» → «1234,56».
 * Висящий разделитель оставляется, пока сумму набирают: «12.» → «12,». У иены после него цифры не принимаются.
 */
export function sanitizeAmountText(raw: string, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  const tokens = raw.match(NUMBER_TOKEN) ?? [];
  if (tokens.length === 0) return exp > 0 && /^\s*[.,]\s*$/.test(raw) ? '0,' : '';
  const [token] = tokens;
  if (tokens.length !== 1 || token === undefined) return '';

  const num = readNumber(token);
  if (!num) return '';
  const int = num.int.replace(/^0+(?=\d)/, '') || '0';
  if (int.length + exp > MAX_DIGITS) return '';
  if (num.frac === null) return int;
  if (num.frac.length > exp && /[1-9]/.test(num.frac.slice(exp))) return ''; // копейки пропали бы
  // Ровно три цифры после единственного разделителя — это почти всегда тысячи («5,000 ₩», «1.000»):
  // принять как «5» или «1» значит ошибиться в 1000 раз. Отказываем, даже если по цифрам копеек не теряется.
  if (num.frac.length === 3 && exp < 3) return '';
  if (exp === 0) return num.frac === '' ? `${int},` : int;
  return `${int},${num.frac.slice(0, exp)}`;
}

/**
 * Подгоняет черновик под другую валюту (в форме сменили кошелёк, пока сумма набрана).
 * Лишние знаки после запятой отбрасываются («12,5» → «12» для иены), а не склеиваются с целой частью («125»):
 * иначе сумма выросла бы в десять раз. Если целая часть не помещается в предел новой валюты — очищаем.
 */
export function clampToCurrency(text: string, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  const { int, frac, hasComma } = split(text);
  if (int.length + exp > MAX_DIGITS) return '';
  if (!hasComma) return text;
  if (exp === 0) return int;
  return `${int},${frac.slice(0, exp)}`;
}

/** Черновик → Minor | null (пустой или нераспознанный → null). Единственная точка разбора. */
export function draftToMinor(text: string, currency: CurrencyCode): Minor | null {
  if (text === '') return null;
  return parseAmountToMinor(text, currency);
}

/** Minor → черновик (1250 → '12,5'). Отрицательные и нецелые значения для ввода недопустимы → ''. */
export function minorToDraft(value: Minor | null, currency: CurrencyCode): string {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return '';
  const text = minorToInputString(value, currency);
  // Если сумма длиннее лимита ввода — показывать её как черновик нельзя, иначе её не получится править.
  return sanitizeAmountText(text, currency) === text ? text : '';
}

/** Черновик для крупного отображения: '1234567,5' → '1 234 567,5' (неразрывные пробелы, как в formatMinor). */
export function formatDraft(text: string): string {
  const { int, frac, hasComma } = split(text);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return hasComma ? `${grouped},${frac}` : grouped;
}
