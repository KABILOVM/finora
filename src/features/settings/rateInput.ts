import { MAX_PER_UNIT, MIN_PER_UNIT } from '@/rates/parseUtil';

/** Знаков курса после запятой: столько хранит база (domain/money.ts, FX_RATE_DECIMALS = 10). */
const MAX_DECIMALS = 10;

/**
 * '10,9' / '10.9' / '1 000' → число. Только положительные десятичные числа, один разделитель, не больше 10 знаков
 * после запятой, в границах курсового сервиса. Иначе null (ни «1e3», ни «-5», ни «0»).
 */
export function parseRateInput(input: string): number | null {
  const s = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const frac = s.split('.')[1] ?? '';
  if (frac.length > MAX_DECIMALS) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < MIN_PER_UNIT || n > MAX_PER_UNIT) return null;
  return n;
}

/** 10.9 → '10,9'; 0.00085 → '0,00085'. Около четырёх значащих цифр, без хвостовых нулей. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  const decimals = rate >= 1 ? 4 : Math.min(MAX_DECIMALS, 4 - Math.floor(Math.log10(rate)));
  const fixed = rate.toFixed(decimals);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  const [int = '0', frac] = trimmed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

export const RATE_SOURCE_LABELS: Record<string, string> = {
  nbt: 'Нацбанк Таджикистана',
  server: 'сервер Finora',
  api: 'интернет-курс',
  manual: 'задан вручную',
  same: 'одна валюта',
};

export const rateSourceLabel = (source: string): string => RATE_SOURCE_LABELS[source] ?? source;
