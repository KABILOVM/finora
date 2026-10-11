/**
 * Банки для быстрого выбора при создании кошелька: знак (иконка bank-* в iconData.ts) и фирменные цвета.
 * Знаки нарисованы вручную, цвета приблизительные; чтобы поправить — меняйте здесь и в iconData.ts (scripts/gen-icons.cjs).
 * В кошельке банк хранится в поле icon как «b:<id>», поэтому схема данных не меняется.
 */
export interface Bank {
  id: string;
  name: string;
  /** Цвет кошелька (поле color), он же — основной цвет плитки. */
  color: string;
  /** Градиент плитки: от светлого (справа сверху) к тёмному. */
  from: string;
  to: string;
}

export const BANKS: readonly Bank[] = [
  { id: 'alif', name: 'Алиф', color: '#0a7a56', from: '#05ab65', to: '#0a7a56' },
  { id: 'dc', name: 'Душанбе Сити', color: '#1d4ed8', from: '#3b82f6', to: '#1d4ed8' },
  { id: 'humo', name: 'Хумо', color: '#ea580c', from: '#ffa03a', to: '#f0561e' },
];

export const bankById = (id: string): Bank | undefined => BANKS.find((b) => b.id === id);

/** Значение поля icon для банка. */
export const bankIcon = (id: string): string => `b:${id}`;
