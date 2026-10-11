import { MAX_PER_UNIT, MIN_PER_UNIT } from '@/rates/parseUtil';

/**
 * Курс, набранный руками: '10,9' / '10.9' / '1 000'. Один разделитель, положительное число в границах курсового сервиса,
 * не больше 10 знаков после запятой (столько хранит база). Иначе null: ни «1e3», ни «-5», ни «0».
 */
export function parseRateInput(input: string): number | null {
  const s = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  if ((s.split('.')[1] ?? '').length > 10) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= MIN_PER_UNIT && n <= MAX_PER_UNIT ? n : null;
}

/** Курс для поля ввода: до 6 знаков, без хвоста нулей, запятая. */
export function rateToText(rate: number): string {
  return String(Number(rate.toFixed(6))).replace('.', ',');
}
