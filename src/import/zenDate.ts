import { MAX_OCCURRED_ON, MIN_OCCURRED_ON } from '@/db/validate';
import type { IsoDate } from '@/domain/types';
import { isValidIsoDate } from '@/lib/dates';

/**
 * Дата из файла: 'ГГГГ-ММ-ДД' или 'ДД.ММ.ГГГГ', после даты может идти время ('2024-02-29 13:45:00', '29.02.2024 13:45').
 * Берём дату КАК НАПИСАНО в файле, без перевода по часовым поясам: ни Date, ни UTC здесь не участвуют,
 * поэтому часовой пояс устройства на результат не влияет. 29 февраля — только в високосный год.
 */

export type DateParse =
  | { ok: true; date: IsoDate }
  | { ok: false; reason: 'empty' | 'format' | 'calendar' | 'range' };

const TIME = String.raw`(?:[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?`;
const ISO = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${TIME}$`);
const RU = new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})${TIME}$`);

const p2 = (n: string) => n.padStart(2, '0');

export function parseZenDate(raw: string): DateParse {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  let y: string;
  let m: string;
  let d: string;
  const iso = ISO.exec(s);
  const ru = iso ? null : RU.exec(s);
  if (iso) [, y, m, d] = iso as unknown as [string, string, string, string];
  else if (ru) [, d, m, y] = ru as unknown as [string, string, string, string];
  else return { ok: false, reason: 'format' };
  const date = `${y}-${p2(m)}-${p2(d)}`;
  if (!isValidIsoDate(date)) return { ok: false, reason: 'calendar' };
  if (date < MIN_OCCURRED_ON || date > MAX_OCCURRED_ON) return { ok: false, reason: 'range' };
  return { ok: true, date };
}
