import type { ProductGroup, RawProduct } from './types';

/** Разделы в порядке показа. */
export const PRODUCT_GROUPS: readonly ProductGroup[] = [
  { id: 'veg', label: 'Овощи' },
  { id: 'fruit', label: 'Фрукты и ягоды' },
  { id: 'greens', label: 'Зелень' },
  { id: 'meat', label: 'Мясо и птица' },
  { id: 'fish', label: 'Рыба и морепродукты' },
  { id: 'dairy', label: 'Молочное и яйца' },
  { id: 'bread', label: 'Хлеб и выпечка' },
  { id: 'grain', label: 'Крупы и бакалея' },
  { id: 'oil', label: 'Масло, соусы, специи' },
  { id: 'drinks', label: 'Напитки' },
  { id: 'sweets', label: 'Сладкое' },
  { id: 'nuts', label: 'Орехи и сухофрукты' },
  { id: 'home', label: 'Дом и гигиена' },
];

/** Встроенный каталог. ВРЕМЕННО короткий: полный список (~300) пишется отдельным шагом. */
export const RAW_PRODUCTS: readonly RawProduct[] = [
  ['kartofel', 'Картофель', 'veg', 'kg', ['картошка']],
  ['moloko', 'Молоко', 'dairy', 'l'],
  ['hleb', 'Хлеб', 'bread', 'pcs'],
];
