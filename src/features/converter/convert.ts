/** Разбор суммы из поля: пробелы любого вида отбрасываются, запятая = точка. null — это не положительное число. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Сколько знаков после запятой показать: крупным суммам хватает двух, мелким (курс 0,00012) нужны значащие цифры. */
function digitsFor(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 100) return 2;
  if (abs >= 1) return 2;
  return Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(abs)) + 1));
}

/** Число по-русски: «1 234,56». Копейки у крупных чисел всегда две, у мелких — значащие цифры. */
export function formatNumber(value: number, fixedDigits?: number): string {
  if (!Number.isFinite(value)) return '—';
  const d = fixedDigits ?? digitsFor(value);
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d }).format(value);
}

/** Курс 1 единицы: 4 значащие цифры у малых, 2–4 знака у обычных. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  const d = rate >= 100 ? 2 : rate >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(rate)));
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: d }).format(rate);
}
