import type { WalletKind } from '@/domain/types';

export const WALLET_KINDS: readonly WalletKind[] = ['cash', 'card', 'bank', 'savings', 'other'];

export const WALLET_KIND_LABELS: Record<WalletKind, string> = {
  cash: 'Наличные',
  card: 'Карта',
  bank: 'Счёт в банке',
  savings: 'Накопления',
  other: 'Другое',
};

export const DEFAULT_ICON_BY_KIND: Record<WalletKind, string> = {
  cash: '💵',
  card: '💳',
  bank: '🏦',
  savings: '🪙',
  other: '💰',
};

/** Цвета для кошельков и категорий. Каждый виден и на светлом, и на тёмном фоне. */
export const COLOR_CHOICES: readonly { value: string; name: string }[] = [
  { value: '#16a34a', name: 'Зелёный' },
  { value: '#2563eb', name: 'Синий' },
  { value: '#7c3aed', name: 'Фиолетовый' },
  { value: '#db2777', name: 'Розовый' },
  { value: '#ea580c', name: 'Оранжевый' },
  { value: '#ca8a04', name: 'Жёлтый' },
  { value: '#0891b2', name: 'Бирюзовый' },
  { value: '#475569', name: 'Серый' },
];

/** Названия сравниваем без учёта регистра и лишних пробелов: «Нал» и «нал » — одно и то же. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru');
}
