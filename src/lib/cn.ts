export type ClassValue = string | number | false | null | undefined | ClassValue[] | { [className: string]: unknown };

/** Склейка CSS-классов: строки, массивы и объекты вида { 'класс': условие }. Пустые значения пропускаются. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v && v !== 0) return;
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v));
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === 'object') {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  };
  for (const v of values) walk(v);
  return out.join(' ');
}
