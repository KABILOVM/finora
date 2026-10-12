import { draftToMinor, minorToDraft } from '@/components/amountText';
import { factorOf } from './currency';
import { addMinor } from './money';
import type { CurrencyCode, IsoDate, Minor } from './types';
import { isValidIsoDate } from '@/lib/dates';

/**
 * Расходы из диктовки (Edge Function parse-expenses): ответ сервера НЕ доверенный. Каждую строку приводим к тем же правилам,
 * что и ручной ввод: счёт и категория ищутся среди СВОИХ, сумма — число > 0, дата — настоящая. Мусор отбрасывается.
 */
export interface DictWallet {
  id: string;
  name: string;
  currency: CurrencyCode;
}
export interface DictCategory {
  id: string;
  name: string;
  /** Значок и цвет категории (для показа в списке); сервер и разбор их не используют. */
  icon?: string;
  color?: string;
}
export interface DictContext {
  wallets: readonly DictWallet[];
  /** Категории расходов. */
  categories: readonly DictCategory[];
  defaultWalletId: string;
  today: IsoDate;
}

/** Строка черновика: всё, что человек может поправить, хранится текстом. */
export interface DraftExpense {
  /** Номер строки: не меняется при правке и удалении других строк. */
  rid: number;
  title: string;
  /** Сумма в валюте счёта, как в поле ввода ('12,5'). */
  amountText: string;
  feeText: string;
  walletId: string;
  /** '' — без категории. */
  categoryId: string;
  /** Название новой категории, если подходящей нет ('' — не создавать). Действует, пока categoryId = ''. */
  newCategory: string;
  date: IsoDate;
  note: string;
  /** Счёт не был назван в речи — подставлен по умолчанию (в списке это видно). */
  walletGuessed: boolean;
}

export const MAX_PARSED_EXPENSES = 60;
export const TITLE_MAX = 80;
export const CATEGORY_NAME_MAX = 40;
const NOTE_PART_MAX = 200;
/** Сколько символов текста принимает сервер за раз. */
export const MAX_EXPENSES_TEXT = 4000;

const norm = (s: string): string => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
const capitalize = (s: string): string => (s === '' ? s : s[0]!.toLocaleUpperCase('ru') + s.slice(1));

/** Точное совпадение названия, иначе единственное «содержит»; несколько кандидатов — не угадываем. */
export function matchByName<T extends { name: string }>(name: string, list: readonly T[]): T | null {
  const n = norm(name);
  if (n === '') return null;
  const exact = list.filter((x) => norm(x.name) === n);
  if (exact.length >= 1) return exact[0]!;
  const part = list.filter((x) => {
    const m = norm(x.name);
    return m !== '' && (m.includes(n) || n.includes(m));
  });
  return part.length === 1 ? part[0]! : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function normalizeAiExpenses(raw: unknown, ctx: DictContext, firstRid = 1): DraftExpense[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftExpense[] = [];
  for (const r of raw) {
    if (out.length >= MAX_PARSED_EXPENSES) break;
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const title = capitalize(clean(o.title, TITLE_MAX));
    const amount = num(o.amount);
    if (title === '' && (amount === null || amount === 0)) continue;
    const named = matchByName(clean(o.wallet, 80), ctx.wallets);
    const wallet = named ?? ctx.wallets.find((w) => w.id === ctx.defaultWalletId) ?? ctx.wallets[0];
    if (!wallet) continue;
    const toText = (n: number | null): string => {
      if (n === null || n === 0) return '';
      const minor = Math.round(n * factorOf(wallet.currency));
      return Number.isSafeInteger(minor) ? minorToDraft(minor, wallet.currency) : '';
    };
    const catName = clean(o.category, CATEGORY_NAME_MAX);
    const cat = matchByName(catName, ctx.categories);
    const date = typeof o.date === 'string' && isValidIsoDate(o.date) ? o.date : ctx.today;
    out.push({
      rid: firstRid + out.length,
      title,
      amountText: toText(amount),
      feeText: toText(num(o.fee)),
      walletId: wallet.id,
      categoryId: cat?.id ?? '',
      newCategory: cat || catName === '' ? '' : capitalize(catName),
      date,
      note: clean(o.note, NOTE_PART_MAX),
      walletGuessed: named === null,
    });
  }
  return out;
}

export interface ExpenseCheck {
  /** Сумма списания (расход + комиссия) в минорных единицах валюты счёта, если строка верна. */
  totalMinor: Minor | null;
  feeMinor: Minor;
  error: string | null;
}

/** Проверка строки перед сохранением. Тексты ошибок показываются под строкой как есть. */
export function checkDraft(d: DraftExpense, currency: CurrencyCode | undefined): ExpenseCheck {
  const bad = (error: string): ExpenseCheck => ({ totalMinor: null, feeMinor: 0, error });
  if (!currency) return bad('Выберите счёт');
  const amount = draftToMinor(d.amountText.trim(), currency);
  if (amount === null || amount <= 0) return bad('Укажите сумму больше нуля');
  const fee = d.feeText.trim() === '' ? 0 : draftToMinor(d.feeText.trim(), currency);
  if (fee === null) return bad('Комиссия указана неверно');
  if (!isValidIsoDate(d.date)) return bad('Укажите дату');
  try {
    return { totalMinor: addMinor(amount, fee), feeMinor: fee, error: null };
  } catch {
    return bad('Слишком большая сумма');
  }
}
