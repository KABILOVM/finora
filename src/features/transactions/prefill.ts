import type { Category, CategoryKind, LocalRow, Minor, TxKind, Wallet } from '@/domain/types';
import { emptyForm, firstOtherWallet, NO_FEE, NOTE_MAX, type TxFormState } from './txForm';

/**
 * «Повторить операцию»: что переносится из прежней операции в новую форму. Дата не переносится (новая — сегодня), курс тоже
 * (форма возьмёт текущий). Объект едет в состоянии перехода по адресу, поэтому только простые значения; принимающая сторона
 * всё равно проверяет их (formFromPrefill): состояние истории браузера — не доверенный источник.
 */
export interface TxPrefill {
  kind: TxKind;
  walletId: string;
  /** Только перевод. */
  toWalletId: string | null;
  amountMinor: Minor;
  categoryId: string | null;
  note: string;
  /** Перевод в одной валюте: комиссия суммой (списано минус получено). */
  feeMinor?: Minor;
}

/**
 * Из формы — для «Повторить». Берём то, что человек видит сейчас, а не сохранённую операцию: поправил сумму в правке и нажал
 * «Повторить» — новая операция получит поправленную сумму, ничего не теряется молча. feeMinor — комиссия перевода, как её посчитала
 * форма (null — не задана или неверна).
 */
export function prefillOfForm(form: TxFormState, feeMinor: Minor | null): TxPrefill {
  const out: TxPrefill = {
    kind: form.kind,
    walletId: form.walletId ?? '',
    toWalletId: form.kind === 'transfer' ? form.toWalletId : null,
    amountMinor: form.amountMinor ?? 0,
    categoryId: form.kind === 'transfer' ? null : form.categoryId,
    note: form.note.trim(),
  };
  if (form.kind === 'transfer' && form.feeOpen && feeMinor !== null && feeMinor > 0) out.feeMinor = feeMinor;
  return out;
}

const KINDS: readonly string[] = ['expense', 'income', 'transfer'];
const isMinor = (v: unknown): v is Minor => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Форма «Новая операция», заполненная из `raw` (состояние перехода). Берётся только то, что прошло проверку: кошелёк должен быть
 * в списке доступных (не в архиве), категория — существовать, быть того же вида и не в архиве. Не прошло — поле остаётся как в
 * `base` (пустая форма с кошельком по умолчанию). Сумма «Получено» при обмене валют не переносится: её посчитает текущий курс.
 */
export function formFromPrefill(
  raw: unknown,
  base: TxFormState,
  wallets: readonly Pick<LocalRow<Wallet>, 'id'>[],
  categories: readonly Pick<LocalRow<Category>, 'id' | 'kind' | 'archivedAt'>[],
): TxFormState {
  if (typeof raw !== 'object' || raw === null) return base;
  const p = raw as Partial<Record<keyof TxPrefill, unknown>>;
  const kind = typeof p.kind === 'string' && KINDS.includes(p.kind) ? (p.kind as TxKind) : null;
  if (kind === null) return base;

  const walletId = typeof p.walletId === 'string' && wallets.some((w) => w.id === p.walletId) ? p.walletId : base.walletId;
  const form: TxFormState = { ...emptyForm(walletId, kind), date: base.date };
  if (isMinor(p.amountMinor)) form.amountMinor = p.amountMinor;
  if (typeof p.note === 'string') form.note = p.note.trim().slice(0, NOTE_MAX);

  if (kind === 'transfer') {
    const to = typeof p.toWalletId === 'string' && p.toWalletId !== walletId && wallets.some((w) => w.id === p.toWalletId) ? p.toWalletId : null;
    form.toWalletId = to ?? firstOtherWallet(wallets, walletId);
    // комиссия — только если она меньше суммы (иначе «получено» вышло бы нулевым)
    if (isMinor(p.feeMinor) && form.amountMinor !== null && p.feeMinor < form.amountMinor) {
      Object.assign(form, { ...NO_FEE, feeOpen: true, feeMode: 'amount', feeAmount: p.feeMinor });
    }
    return form;
  }

  const catKind: CategoryKind = kind;
  const cat = typeof p.categoryId === 'string' ? categories.find((c) => c.id === p.categoryId) : undefined;
  if (cat && cat.kind === catKind && cat.archivedAt === null) form.categoryId = cat.id;
  return form;
}
