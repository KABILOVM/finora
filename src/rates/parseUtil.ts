import type { IsoDate } from '@/domain/types';

/*
 * ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ: помощники разбора написаны «с запасом» (разные даты, запятая/точка,
 * кодировки), потому что реальные ответы nbt.tj и currency-api в этой среде увидеть было нельзя.
 *
 * Блок между маркерами SHARED:util ДОСЛОВНО скопирован в supabase/functions/fetch-rates/index.ts
 * (Edge-функция должна быть одним файлом). Правишь здесь — правь и там; тест edge.test.ts сравнит текст.
 */

// <<< SHARED:util
/** Допустимый диапазон «единиц опорной валюты за 1 единицу». Всё за пределами — мусор, а не курс. */
export const MIN_PER_UNIT = 1e-9;
export const MAX_PER_UNIT = 1e9;
/** Дата курса может опережать сегодняшнюю UTC-дату не больше чем на столько суток (часовые пояса, курс «на завтра»). */
export const FUTURE_TOLERANCE_DAYS = 1;
export const MAX_BODY_CHARS = 5_000_000;
export const MAX_WARNINGS = 30;

export class RateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateParseError';
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Курс: конечное число в разумных пределах. NaN, Infinity, 0, отрицательные и «огромные» — нет. */
export function isRateValue(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_PER_UNIT && n <= MAX_PER_UNIT;
}

export function isoDateOf(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

function validYmd(y: number, m: number, d: number): IsoDate | null {
  if (!(y >= 1990 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'DD.MM.YYYY', 'YYYY-MM-DD' (и с '/', '-', время после даты) → 'YYYY-MM-DD'; несуществующая дата → null. */
export function normalizeDate(raw: string): IsoDate | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:$|[T\s])/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Сколько календарных суток от `from` до `to` (отрицательно, если `to` раньше). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function isFutureDate(asOf: IsoDate, now: Date): boolean {
  return asOf > addDays(isoDateOf(now), FUTURE_TOLERANCE_DAYS);
}

/**
 * Число из текста: '10,9', '10.9', '1 234,5', '1,234.56', '1.234,56'. Минус, буквы, степени ('1e5') → null.
 * Единственный разделитель считается десятичным ('1,234' = 1.234); несколько одинаковых — тысячами ('1,234,567').
 * Это не проверка диапазона: 0 вернётся как 0, границы проверяет isRateValue.
 */
export function parseDecimal(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s  ']/g, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decDot = lastDot > lastComma;
    const parts = s.split(decDot ? '.' : ',');
    if (parts.length !== 2) return null;
    const intPart = parts[0] ?? '';
    const grouped = decDot ? /^\d{1,3}(?:,\d{3})+$/ : /^\d{1,3}(?:\.\d{3})+$/;
    if (!/^\d+$/.test(intPart) && !grouped.test(intPart)) return null;
    s = `${intPart.replace(/[.,]/g, '')}.${parts[1] ?? ''}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = s.split(lastDot >= 0 ? '.' : ',');
    if (parts.length > 2) {
      const lead = (parts[0] ?? '').length;
      if (!parts.slice(1).every((p) => p.length === 3) || lead < 1 || lead > 3) return null;
      s = parts.join('');
    } else {
      s = parts.join('.');
    }
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Номинал («курс за N единиц») — всегда ЦЕЛОЕ число единиц, поэтому разделитель в нём — только разделитель тысяч:
 * '10', '1 000', '1,000', '1.000', '1,000,000' → 10, 1000, 1000, 1000, 1000000; хвост из нулей ('1.0', '1,00') отбрасывается.
 * Дробный ('0,5', '1,5'), нулевой, со знаком или с буквами → null (запись отбрасывают, а не угадывают масштаб:
 * ошибка в 1000 раз молча испортила бы все суммы).
 */
export function parseNominal(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\s']/g, '');
  let digits: string;
  if (/^\d+$/.test(s)) digits = s;
  else if (/^[1-9]\d{0,2}(?:,\d{3})+$/.test(s) || /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(s)) digits = s.replace(/[.,]/g, '');
  else if (/^\d+[.,]0+$/.test(s)) digits = s.slice(0, s.search(/[.,]/));
  else return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Байты ответа → текст. Порядок: BOM, charset из Content-Type, encoding из <?xml ...?>, иначе UTF-8. */
export function decodeBody(buf: ArrayBuffer | Uint8Array, contentType?: string | null): string {
  const bytes = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  const decode = (label: string): string | null => {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      return null; // неизвестная кодировка
    }
  };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le') ?? '';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be') ?? '';
  let label = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  if (!label) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 200));
    label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
  }
  return (label ? decode(label) : null) ?? decode('utf-8') ?? '';
}

/** Не даёт списку предупреждений разрастись: первые MAX_WARNINGS и строка «…и ещё N». */
export function boundWarnings(list: readonly string[]): string[] {
  if (list.length <= MAX_WARNINGS) return [...list];
  return [...list.slice(0, MAX_WARNINGS), `…и ещё ${list.length - MAX_WARNINGS}`];
}
// SHARED:util >>>
