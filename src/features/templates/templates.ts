import type { Category, LocalRow, TxKind, UUID, Wallet } from '@/domain/types';
import type { TxPrefill } from '@/features/transactions/prefill';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { withoutTags } from '@/features/trips/trips';

/**
 * Именованные шаблоны операций: «Кофе — 15 с., Еда, Наличные», «Аренда — 3 000 с.». Шаблон — это готовая заготовка формы «Новая
 * операция» (TxPrefill, как у «Повторить») со своим названием. Хранятся на этом устройстве (templateStore.ts), в облако не уходят.
 * ЧИСТЫЕ функции (без React и хранилища): проверка, имена, добавление/переименование/удаление.
 */

/** Сколько шаблонов можно хранить. */
export const TEMPLATES_MAX = 30;
/** Длина названия. */
export const NAME_MAX = 30;

export interface Template {
  id: UUID;
  name: string;
  prefill: TxPrefill;
}

const KINDS: readonly string[] = ['expense', 'income', 'transfer'];
const isPositiveMinor = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isText = (v: unknown): v is string => typeof v === 'string';

export const KIND_LABEL: Record<TxKind, string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

/** Название без лишних пробелов и не длиннее NAME_MAX; null — названия нет. */
export function cleanName(name: string): string | null {
  const s = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return s === '' ? null : s;
}

/** Ключ названия: без регистра и «ё» — «Кофе» и «кофе» это одно название. */
export const nameKey = (name: string): string => name.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Название, которого ещё нет в списке: «Кофе», «Кофе 2», «Кофе 3»… `exceptId` — шаблон, который сейчас переименовываем. */
export function uniqueName(name: string, templates: readonly Template[], exceptId?: UUID): string {
  const taken = new Set(templates.filter((t) => t.id !== exceptId).map((t) => nameKey(t.name)));
  if (!taken.has(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, NAME_MAX - suffix.length).trim()}${suffix}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

/** Что записать в шаблон из формы: метки поездки (#…) и лишние пробелы в заметке не нужны, комиссия — только у перевода. */
export function templatePrefill(p: TxPrefill): TxPrefill {
  const out: TxPrefill = { ...p, note: withoutTags(p.note).slice(0, NOTE_MAX) };
  if (p.kind !== 'transfer') {
    out.toWalletId = null;
    delete out.feeMinor;
  }
  return out;
}

/** Предложение названия: заметка, иначе категория, иначе вид операции. */
export function suggestName(p: Pick<TxPrefill, 'kind' | 'note'>, categoryName: string | null): string {
  return cleanName(withoutTags(p.note)) ?? cleanName(categoryName ?? '') ?? KIND_LABEL[p.kind];
}

/** Шаблон из хранилища: целиком проверенный (всё остальное — мусор, выбрасывается), без повторов номеров. */
function parseOne(raw: unknown): Template | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = isText(r.name) ? cleanName(r.name) : null;
  const p = typeof r.prefill === 'object' && r.prefill !== null ? (r.prefill as Record<string, unknown>) : null;
  if (!isText(r.id) || r.id === '' || r.id.length > 64 || name === null || p === null) return null;
  if (!isText(p.kind) || !KINDS.includes(p.kind) || !isText(p.walletId) || p.walletId === '' || !isPositiveMinor(p.amountMinor)) return null;
  const kind = p.kind as TxKind;
  const note = isText(p.note) ? p.note.trim().slice(0, NOTE_MAX) : '';
  if (kind === 'transfer') {
    if (!isText(p.toWalletId) || p.toWalletId === '' || p.toWalletId === p.walletId) return null;
    const prefill: TxPrefill = { kind, walletId: p.walletId, toWalletId: p.toWalletId, amountMinor: p.amountMinor, categoryId: null, note };
    if (isPositiveMinor(p.feeMinor) && p.feeMinor < p.amountMinor) prefill.feeMinor = p.feeMinor;
    return { id: r.id, name, prefill };
  }
  const categoryId = isText(p.categoryId) && p.categoryId !== '' ? p.categoryId : null;
  return { id: r.id, name, prefill: { kind, walletId: p.walletId, toWalletId: null, amountMinor: p.amountMinor, categoryId, note } };
}

/** Список из хранилища (JSON уже разобран): годные шаблоны по порядку, не больше TEMPLATES_MAX; повторы номеров отбрасываются. */
export function parseTemplates(raw: unknown): Template[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Template[] = [];
  for (const item of raw) {
    const t = parseOne(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length === TEMPLATES_MAX) break;
  }
  return out;
}

export type AddResult = { ok: true; templates: Template[]; template: Template } | { ok: false; reason: 'limit' | 'name' | 'invalid' };

/** Добавляет шаблон в конец. Название делается уникальным («Кофе 2»); пустое название или негодная заготовка — отказ. */
export function addTemplate(templates: readonly Template[], input: { id: UUID; name: string; prefill: TxPrefill }): AddResult {
  if (templates.length >= TEMPLATES_MAX) return { ok: false, reason: 'limit' };
  const name = cleanName(input.name);
  if (name === null) return { ok: false, reason: 'name' };
  const parsed = parseOne({ id: input.id, name, prefill: templatePrefill(input.prefill) });
  if (!parsed) return { ok: false, reason: 'invalid' };
  const template = { ...parsed, name: uniqueName(parsed.name, templates) };
  return { ok: true, templates: [...templates, template], template };
}

/** Переименовывает; название остаётся уникальным. Пустое название или неизвестный номер — список без изменений. */
export function renameTemplate(templates: readonly Template[], id: UUID, name: string): Template[] {
  const clean = cleanName(name);
  if (clean === null || !templates.some((t) => t.id === id)) return [...templates];
  const next = uniqueName(clean, templates, id);
  return templates.map((t) => (t.id === id ? { ...t, name: next } : t));
}

export const removeTemplate = (templates: readonly Template[], id: UUID): Template[] => templates.filter((t) => t.id !== id);

/** Возвращает удалённый шаблон на прежнее место («Отменить»). Уже есть такой номер или список полон — без изменений. */
export function insertTemplate(templates: readonly Template[], template: Template, index: number): Template[] {
  if (templates.some((t) => t.id === template.id) || templates.length >= TEMPLATES_MAX) return [...templates];
  const at = Math.max(0, Math.min(index, templates.length));
  return [...templates.slice(0, at), template, ...templates.slice(at)];
}

type WalletLike = Pick<LocalRow<Wallet>, 'id' | 'name' | 'currency'>;
type CategoryLike = Pick<LocalRow<Category>, 'id' | 'name' | 'icon' | 'color' | 'kind' | 'archivedAt'>;

export interface ResolvedTemplate {
  wallet: WalletLike;
  toWallet: WalletLike | null;
  category: CategoryLike | null;
}

/**
 * Можно ли внести шаблон сейчас: кошельки на месте (в списке доступных), категория существует, того же вида и не в архиве
 * (категории у шаблона может не быть — тогда расход «без категории»). Нет — null: шаблон показывается, но не применяется.
 */
export function resolveTemplate(t: Template, wallets: readonly WalletLike[], categories: readonly CategoryLike[]): ResolvedTemplate | null {
  const p = t.prefill;
  const wallet = wallets.find((w) => w.id === p.walletId);
  if (!wallet) return null;
  if (p.kind === 'transfer') {
    const toWallet = wallets.find((w) => w.id === p.toWalletId);
    // между валютами тоже можно: форма возьмёт текущий курс, как у «Повторить»
    return toWallet && toWallet.id !== wallet.id ? { wallet, toWallet, category: null } : null;
  }
  if (p.categoryId === null) return { wallet, toWallet: null, category: null };
  const category = categories.find((c) => c.id === p.categoryId);
  return category && category.kind === p.kind && category.archivedAt === null ? { wallet, toWallet: null, category } : null;
}
