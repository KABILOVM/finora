import { NAME_MAX, QTY_MAX, QTY_MIN, SHOPPING_UNITS } from './shopping';
import type { ShoppingUnit } from './types';

/**
 * Список покупок от ИИ (Edge Function parse-shopping): ответ сервера НЕ доверенный, поэтому каждую позицию приводим к тем же
 * правилам, что и ручной ввод (название до NAME_MAX, количество в тысячных долях, штуки только целые). Мусор отбрасывается.
 */
export interface ParsedItem {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
}

export const MAX_PARSED_ITEMS = 100;
/** Сколько символов можно отправить на разбор за раз (сервер отвечает отказом на большее). */
export const MAX_AI_TEXT = 2000;

const capitalize = (s: string): string => (s === '' ? s : s[0]!.toLocaleUpperCase('ru') + s.slice(1));

export function normalizeAiItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedItem[] = [];
  for (const r of raw) {
    if (out.length >= MAX_PARSED_ITEMS) break;
    if (typeof r !== 'object' || r === null) continue;
    const { name, qty, unit } = r as { name?: unknown; qty?: unknown; unit?: unknown };
    if (typeof name !== 'string') continue;
    const clean = capitalize(name.replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).trim();
    if (clean === '') continue;
    const u: ShoppingUnit = SHOPPING_UNITS.includes(unit as ShoppingUnit) ? (unit as ShoppingUnit) : 'pcs';
    let milli = typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? Math.round(qty * 1000) : 1000;
    if (u === 'pcs') milli = Math.max(1, Math.round(milli / 1000)) * 1000;
    if (milli < QTY_MIN) milli = QTY_MIN;
    if (milli > QTY_MAX) continue;
    out.push({ name: clean, qtyMilli: milli, unit: u });
  }
  return out;
}
