import type { TransactionInput, TransactionPatch } from '@/db';
import type { CurrencyCode, IsoDate, Minor, Transaction, TxKind } from '@/domain/types';
import { isValidIsoDate, todayLocal } from '@/lib/dates';
import { MAX_PER_UNIT, MIN_PER_UNIT } from '@/rates/parseUtil';
import type { RateLookup } from '@/rates/types';

/**
 * Чистая логика формы операции (без React и без базы): состояние, даты, курс, проверки, разбор ошибок репозитория.
 * Её используют оба шита — «Новая операция» и «Правка операции».
 */

export const NOTE_MAX = 500;
/** Границы даты — как CHECK на сервере (supabase/schema.sql): раньше/позже сервер запись не примет. */
export const MIN_DATE: IsoDate = '2000-01-01';
export const MAX_DATE: IsoDate = '2100-01-01';
/** За сколько последних дней считаем «частые» категории. */
export const FREQUENT_DAYS = 90;

// ───────────────────────── состояние формы ─────────────────────────

/**
 * Дата операции. «Сегодня» вычисляется в момент сохранения: шит, простоявший открытым за полночь, не соврёт.
 * Всё, что человек выбрал сам («Вчера», календарь), — конкретная дата: выбрал 9-е, значит 9-е, хоть сохрани в 00:01.
 */
export type DateChoice = { mode: 'today' } | { mode: 'date'; value: string };

export interface TxFormState {
  kind: TxKind;
  amountMinor: Minor | null;
  walletId: string | null;
  /** Только перевод: куда. */
  toWalletId: string | null;
  /**
   * Только перевод: сумма «Получено», введённая человеком. undefined — не трогал, она считается сама
   * (по курсу или равна списанию). null — стёр поле.
   */
  toAmountOverride: Minor | null | undefined;
  /** Перевод в той же валюте: показано ли поле «Получено» (для комиссии). */
  feeOpen: boolean;
  categoryId: string | null;
  date: DateChoice;
  note: string;
  /** Ручной курс, как набрал человек (когда курса нет совсем). */
  rateText: string;
}

export function emptyForm(walletId: string | null, kind: TxKind = 'expense'): TxFormState {
  return {
    kind,
    amountMinor: null,
    walletId,
    toWalletId: null,
    toAmountOverride: undefined,
    feeOpen: false,
    categoryId: null,
    date: { mode: 'today' },
    note: '',
    rateText: '',
  };
}

/** Форма, заполненная из существующей операции. currencyOf — валюта кошелька по id (нужна, чтобы понять, открыта ли комиссия). */
export function formFromTx(tx: Transaction, currencyOf: (walletId: string) => CurrencyCode | undefined): TxFormState {
  const isTransfer = tx.kind === 'transfer';
  const fromCur = currencyOf(tx.walletId);
  const toCur = tx.toWalletId === null ? undefined : currencyOf(tx.toWalletId);
  const sameCurrency = fromCur !== undefined && fromCur === toCur;
  return {
    kind: tx.kind,
    amountMinor: tx.amountMinor,
    walletId: tx.walletId,
    toWalletId: tx.toWalletId,
    toAmountOverride: isTransfer ? tx.toAmountMinor : undefined,
    feeOpen: isTransfer && sameCurrency && tx.toAmountMinor !== null && tx.toAmountMinor !== tx.amountMinor,
    categoryId: tx.categoryId,
    date: { mode: 'date', value: tx.occurredOn },
    note: tx.note,
    rateText: '',
  };
}

/**
 * Что из проверенной формы действительно изменилось против операции, как она выглядела при открытии шита.
 * В базу уходят только эти поля: остальные могли тем временем исправить с другого устройства, и устаревшая
 * копия формы не должна их откатить. Пустой результат — человек ничего не менял.
 */
export function changedFields(input: TransactionInput, orig: Transaction): TransactionPatch {
  const patch: TransactionPatch = {};
  if (input.kind !== orig.kind) patch.kind = input.kind;
  if (input.walletId !== orig.walletId) patch.walletId = input.walletId;
  if ((input.toWalletId ?? null) !== orig.toWalletId) patch.toWalletId = input.toWalletId ?? null;
  if (input.amountMinor !== orig.amountMinor) patch.amountMinor = input.amountMinor;
  if ((input.categoryId ?? null) !== orig.categoryId) patch.categoryId = input.categoryId ?? null;
  if (input.occurredOn !== orig.occurredOn) patch.occurredOn = input.occurredOn;
  // старая заметка могла быть с пробелами по краям: форма их срезает, это не правка человека
  if ((input.note ?? '') !== orig.note.trim()) patch.note = input.note ?? '';
  // «Получено» идёт вместе с суммой и кошельками: репозиторий без него не пересчитает перевод между валютами
  const pairMoved =
    input.kind === 'transfer' &&
    (patch.kind !== undefined || patch.walletId !== undefined || patch.toWalletId !== undefined || patch.amountMinor !== undefined);
  if (pairMoved || (input.toAmountMinor ?? null) !== orig.toAmountMinor) patch.toAmountMinor = input.toAmountMinor ?? null;
  // курс нужен, только если сумма, кошелёк или вид меняются (иначе контроллер его не даёт)
  if (input.fx !== undefined) patch.fx = input.fx;
  return patch;
}

// ───────────────────────── даты ─────────────────────────

export function resolveDate(choice: DateChoice, now: Date = new Date()): string {
  return choice.mode === 'today' ? todayLocal(now) : choice.value;
}

/** Текст ошибки или null, если дата годится. */
export function checkDate(value: string): string | null {
  if (value === '') return 'Укажите дату';
  if (!isValidIsoDate(value)) return 'Такой даты нет: выберите её в календаре';
  if (value < MIN_DATE || value > MAX_DATE) return 'Дата должна быть между 2000 и 2100 годом';
  return null;
}

/** '2026-10-05' → '05.10.2026'. Не дату возвращает как есть. */
export function ruDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

// ───────────────────────── курс ─────────────────────────

/**
 * Курс, набранный руками: '10,9' / '10.9' / '1 000'. Один разделитель, только положительное число в границах курсового
 * сервиса, не больше 10 знаков после запятой (столько хранит база). Иначе null: ни «1e3», ни «-5», ни «0».
 */
export function parseRateText(input: string): number | null {
  const s = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  if ((s.split('.')[1] ?? '').length > 10) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= MIN_PER_UNIT && n <= MAX_PER_UNIT ? n : null;
}

/** 10.9 → '10,9'; 0.00085 → '0,00085'; 1090 → '1 090'. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  const decimals = rate >= 1 ? 4 : Math.min(10, 4 - Math.floor(Math.log10(rate)));
  const fixed = rate.toFixed(decimals);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  const [int = '0', frac] = trimmed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

const KNOWN_FX_SOURCES: readonly string[] = ['nbt', 'server', 'api', 'manual', 'cached'];

/** Источник курса для записи в операцию (репозиторий принимает только известные значения). */
export function fxSourceOf(lookup: Pick<RateLookup, 'source' | 'manual'>): string {
  if (lookup.manual) return 'manual';
  return KNOWN_FX_SOURCES.includes(lookup.source) ? lookup.source : 'cached';
}

const SOURCE_LABELS: Record<string, string> = {
  nbt: 'Нацбанк',
  server: 'сервер Finora',
  api: 'интернет-курс',
  manual: 'задан вручную',
  cached: 'сохранённый курс',
  same: 'одна валюта',
};

export const rateSourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

// ───────────────────────── кошелёк и категории ─────────────────────────

/** Какой кошелёк подставить: последний использованный → «по умолчанию» из настроек → первый в списке. */
export function pickDefaultWallet(
  wallets: readonly { id: string }[],
  lastWalletId: string | null,
  defaultWalletId: string | null,
): string | null {
  for (const id of [lastWalletId, defaultWalletId]) {
    if (id !== null && wallets.some((w) => w.id === id)) return id;
  }
  return wallets[0]?.id ?? null;
}

/** Первый кошелёк, который не `exceptId` (для «Куда» в переводе). */
export function firstOtherWallet(wallets: readonly { id: string }[], exceptId: string | null): string | null {
  return wallets.find((w) => w.id !== exceptId)?.id ?? null;
}

/** Сначала самые частые (по счётчику), затем остальные в прежнем порядке. Сортировка устойчивая. */
export function rankByCount<T extends { id: string }>(items: readonly T[], counts: ReadonlyMap<string, number>): T[] {
  return [...items].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
}

// ───────────────────────── ошибки ─────────────────────────

export interface FormErrors {
  amount?: string;
  wallet?: string;
  toWallet?: string;
  toAmount?: string;
  date?: string;
  note?: string;
  rate?: string;
  category?: string;
  form?: string;
}

/**
 * К какому полю относится сообщение репозитория (ValidationError). Неясно или поля сейчас нет на экране
 * (isShown вернул false) — к форме целиком: сообщение не должно потеряться.
 */
export function errorField(message: string, isShown: (field: keyof FormErrors) => boolean = () => true): keyof FormErrors {
  const m = message.trim();
  let field: keyof FormErrors = 'form';
  // \w не знает кириллицу, поэтому окончания слов ловим диапазоном букв
  if (/сумм[а-яё]* зачисления/i.test(m)) field = 'toAmount';
  else if (/кошел[её]к зачисления/i.test(m)) field = 'toWallet';
  else if (/^Сумма|слишком велика/.test(m)) field = 'amount';
  else if (/^Заметка/.test(m)) field = 'note';
  else if (/^Дата/.test(m)) field = 'date';
  else if (/^Курс|^Источник курса|^Нужен курс/.test(m)) field = 'rate';
  else if (/^Категория/.test(m)) field = 'category';
  else if (/^Кошел[её]к/.test(m)) field = 'wallet';
  return isShown(field) ? field : 'form';
}

export const GENERIC_SAVE_ERROR = 'Не удалось сохранить. Данные не изменены — попробуйте ещё раз.';
