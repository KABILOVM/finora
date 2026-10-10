/**
 * Склонение по числу: pluralRu(1, 'запись', 'записи', 'записей') → 'запись'; 2 → 'записи'; 5 → 'записей'; 21 → 'запись'.
 * Дробные и отрицательные числа обрабатываются по модулю целой части.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
