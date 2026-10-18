/** «  Алишер  Ё » и «алишер е» — один человек: пробелы схлопываются, регистр и «ё/е» не различаются. */
export const normName = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
