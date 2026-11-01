import { draftToMinor, minorToDraft } from '@/components/amountText';
import { isValidIsoDate } from '@/lib/dates';
import { factorOf } from '@/domain/currency';
import { CATEGORY_NAME_MAX, matchByName, type DictCategory } from '@/domain/expensesAi';
import { groceryCategoryFor, matchProduct, productByName } from '@/domain/products/catalog';
import { addMinor } from '@/domain/money';
import { formatQty, NAME_MAX, parseQty, SHOPPING_UNITS } from '@/domain/shopping';
import type { CurrencyCode, IsoDate, Minor, ShoppingUnit } from '@/domain/types';

/**
 * Чек по фото (Edge Function parse-receipt) или вручную: позиции с ценой и категорией. Ответ сервера НЕ доверенный: каждую строку
 * приводим к тем же правилам, что и ручной ввод, мусор отбрасываем. Дальше позиции группируются по категориям: на каждую категорию —
 * один расход со своим «чеком» (ShoppingRepo.recordReceipt). Чистые функции, без React и базы.
 */

export const MAX_RECEIPT_LINES = 120;
export const MERCHANT_MAX = 80;

export interface ReceiptContext {
  /** Категории расходов. */
  categories: readonly DictCategory[];
  today: IsoDate;
  /** Валюта чека (кошелька, в который его вносят). */
  currency: CurrencyCode;
}

/** Строка чека: всё, что человек может поправить, хранится текстом. */
export interface ReceiptLineDraft {
  /** Номер строки: не меняется при правке и удалении других строк. */
  rid: number;
  name: string;
  /** Количество как в поле ввода ('1,4'). */
  qtyText: string;
  unit: ShoppingUnit;
  /** Цена за всю позицию в валюте чека ('18,2'). */
  priceText: string;
  /** '' — без категории. */
  categoryId: string;
  /** Название новой категории, если подходящей нет ('' — не создавать). Действует, пока categoryId = ''. */
  newCategory: string;
}

export interface ReceiptDraft {
  merchant: string;
  date: IsoDate;
  /** Итог, напечатанный на чеке (текст; '' — не видно): для сверки с суммой позиций. */
  totalText: string;
  lines: ReceiptLineDraft[];
}

const norm = (s: string): string => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
const capitalize = (s: string): string => (s === '' ? s : s[0]!.toLocaleUpperCase('ru') + s.slice(1));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Пустая строка чека (кнопка «Добавить позицию»). */
export const emptyLine = (rid: number): ReceiptLineDraft => ({ rid, name: '', qtyText: '1', unit: 'pcs', priceText: '', categoryId: '', newCategory: '' });

/** Ответ сервера → черновик чека. Любой мусор вместо ответа — пустой чек. */
export function normalizeAiReceipt(raw: unknown, ctx: ReceiptContext, firstRid = 1): ReceiptDraft {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const toText = (n: number | null): string => {
    if (n === null || n === 0) return '';
    const minor = Math.round(n * factorOf(ctx.currency));
    return Number.isSafeInteger(minor) ? minorToDraft(minor, ctx.currency) : '';
  };
  const items = Array.isArray(o.items) ? (o.items as unknown[]) : [];
  const lines: ReceiptLineDraft[] = [];
  for (const r of items) {
    if (lines.length >= MAX_RECEIPT_LINES) break;
    if (typeof r !== 'object' || r === null) continue;
    const it = r as Record<string, unknown>;
    const rawName = capitalize(clean(it.name, NAME_MAX));
    // «картошки» → «Картофель»: цены одного продукта складываются в одну историю. Название уже каталожное или с цифрами
    // («Молоко 2,5%», «Яйца С1») оставляем как напечатано: подробности чека не теряем
    const product = productByName(rawName) === undefined && !/\d/.test(rawName) ? matchProduct(rawName) : null;
    const name = product?.name ?? rawName;
    const price = num(it.price);
    if (name === '' && (price === null || price === 0)) continue;
    const unitRaw = clean(it.unit, 6);
    const unit: ShoppingUnit = (SHOPPING_UNITS as readonly string[]).includes(unitRaw) ? (unitRaw as ShoppingUnit) : 'pcs';
    const qtyRaw = num(it.qty);
    // количество — до трёх знаков; штуки — целые; не прочиталось — одна единица
    let qtyMilli = qtyRaw === null || qtyRaw === 0 ? 1000 : Math.round(qtyRaw * 1000);
    if (unit === 'pcs') qtyMilli = Math.max(1000, Math.round(qtyMilli / 1000) * 1000);
    if (!Number.isSafeInteger(qtyMilli) || qtyMilli < 1 || qtyMilli > 1_000_000_000) qtyMilli = 1000;
    const catName = clean(it.category, CATEGORY_NAME_MAX);
    const cat = matchByName(catName, ctx.categories);
    // ИИ категорию не назвал, а позиция — продукт питания из каталога: кладём в «Продукты»
    const groceryId = cat === null && catName === '' ? groceryCategoryFor(name, ctx.categories) : null;
    lines.push({
      rid: firstRid + lines.length,
      name,
      qtyText: formatQty(qtyMilli),
      unit,
      priceText: toText(price),
      categoryId: cat?.id ?? groceryId ?? '',
      newCategory: cat || catName === '' ? '' : capitalize(catName),
    });
  }
  const date = typeof o.date === 'string' && isValidIsoDate(o.date) && o.date <= ctx.today ? (o.date as IsoDate) : ctx.today;
  return { merchant: clean(o.merchant, MERCHANT_MAX), date, totalText: toText(num(o.total)), lines };
}

export interface ReceiptLine {
  rid: number;
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  priceMinor: Minor;
}

/** Позиции одной категории: из них получится один расход. */
export interface ReceiptGroup {
  /** Стабильный ключ группы: id категории, 'new:название' или '' (без категории). */
  key: string;
  categoryId: string;
  newCategory: string;
  lines: ReceiptLine[];
  totalMinor: Minor;
}

export interface ReceiptCheck {
  /** rid → текст ошибки (под строкой как есть). */
  errors: Map<number, string>;
  groups: ReceiptGroup[];
  /** Сумма позиций (null — есть ошибки в строках или не помещается). */
  sumMinor: Minor | null;
  /** Итог на чеке, если он указан и верен. */
  totalMinor: Minor | null;
  /** Итог на чеке минус сумма позиций (плюс — позиций не хватает); null — нечего сверять. */
  diffMinor: Minor | null;
  /** Ошибка чека целиком (нет позиций, нулевая сумма). */
  error: string | null;
}

const groupKey = (l: ReceiptLineDraft): string => (l.categoryId !== '' ? l.categoryId : l.newCategory !== '' ? `new:${norm(l.newCategory)}` : '');

/** Проверка чека перед сохранением и разбивка на группы по категориям. */
export function checkReceipt(d: ReceiptDraft, currency: CurrencyCode): ReceiptCheck {
  const errors = new Map<number, string>();
  const groups = new Map<string, ReceiptGroup>();
  for (const l of d.lines) {
    const name = l.name.replace(/\s+/g, ' ').trim();
    if (name === '') {
      errors.set(l.rid, 'Введите название');
      continue;
    }
    if ([...name].length > NAME_MAX) {
      errors.set(l.rid, `Название не длиннее ${NAME_MAX} символов`);
      continue;
    }
    const qtyMilli = parseQty(l.qtyText, l.unit);
    if (qtyMilli === null) {
      errors.set(l.rid, l.unit === 'pcs' ? 'Штуки — целое число больше нуля' : 'Количество — число больше нуля, не больше трёх знаков после запятой');
      continue;
    }
    const price = l.priceText.trim() === '' ? null : draftToMinor(l.priceText.trim(), currency);
    if (price === null || price < 0) {
      errors.set(l.rid, 'Укажите цену позиции');
      continue;
    }
    const key = groupKey(l);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, categoryId: l.categoryId, newCategory: l.categoryId === '' ? l.newCategory : '', lines: [], totalMinor: 0 }));
    try {
      g.totalMinor = addMinor(g.totalMinor, price);
    } catch {
      errors.set(l.rid, 'Слишком большая сумма');
      continue;
    }
    g.lines.push({ rid: l.rid, name, qtyMilli, unit: l.unit, priceMinor: price });
  }
  const list = [...groups.values()];
  let error: string | null = null;
  if (d.lines.length === 0) error = 'Добавьте хотя бы одну позицию';
  else if (errors.size === 0) {
    const empty = list.find((g) => g.totalMinor <= 0);
    if (empty) error = 'Сумма по категории нулевая: укажите цены или уберите позиции';
  }
  let sumMinor: Minor | null = null;
  if (errors.size === 0 && error === null) {
    try {
      sumMinor = list.reduce((s, g) => addMinor(s, g.totalMinor), 0);
    } catch {
      error = 'Слишком большая сумма чека';
    }
  }
  const totalParsed = d.totalText.trim() === '' ? null : draftToMinor(d.totalText.trim(), currency);
  const totalMinor = totalParsed !== null && totalParsed > 0 ? totalParsed : null;
  const diffMinor = sumMinor !== null && totalMinor !== null ? totalMinor - sumMinor : null;
  return { errors, groups: list, sumMinor, totalMinor, diffMinor, error };
}
