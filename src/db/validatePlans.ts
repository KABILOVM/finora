import { RATE_BP_MAX, RATE_BP_MIN, TERM_MONTHS_MAX, TERM_MONTHS_MIN } from '@/domain/interest';
import { NAME_MAX as SHOPPING_NAME_MAX, QTY_MAX, QTY_MIN, SHOPPING_UNITS } from '@/domain/shopping';
import type { CurrencyCode, DebtDirection, Frequency, IsoDate, IsoDateTime, Minor, ShoppingUnit, TxKind, UUID } from '@/domain/types';
import { fail } from './errors';
import {
  LIMITS,
  MINOR_LIMIT,
  optId,
  optStamp,
  parseTxFields,
  reqCurrency,
  reqDate,
  reqEnum,
  reqMinorInRange,
  reqPositiveMinor,
  reqSafeInt,
  reqText,
} from './validate';

/**
 * Проверки полей бюджетов, долгов и регулярных платежей — те же границы, что у сервера (см. supabase/schema.sql и TABLE_SPECS):
 * суммы 1…1e15, названия 1…80 символов, заметки ≤ 500, даты 2000-01-01…2100-01-01, interval_n 1…1000, auto_post 0/1.
 * Те же проверки работают для репозиториев (ввод) и для импорта резервной копии (чужой файл).
 */

export const DEBT_DIRECTIONS: readonly DebtDirection[] = ['lent', 'borrowed'];
export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
/** budgets.period: пока только календарный месяц. */
export const BUDGET_PERIODS: readonly 'month'[] = ['month'];
/** debts.counterparty: от 1 до 80 символов (как wallets.name на сервере). */
export const COUNTERPARTY_MAX = 80;
/** recurring_rules.interval_n: от 1 до 1000. */
export const INTERVAL_N_MIN = 1;
export const INTERVAL_N_MAX = 1000;

export interface BudgetData {
  categoryId: UUID | null;
  amountMinor: Minor;
  currency: CurrencyCode;
  period: 'month';
  archivedAt: IsoDateTime | null;
}

export function parseBudgetData(raw: Record<string, unknown>): BudgetData {
  return {
    categoryId: optId(raw['categoryId'], 'Категория бюджета'),
    amountMinor: reqPositiveMinor(raw['amountMinor'], 'Лимит бюджета'),
    currency: reqCurrency(raw['currency'], 'Валюта бюджета'),
    period: reqEnum(raw['period'], 'Период бюджета', BUDGET_PERIODS),
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации бюджета'),
  };
}

export interface DebtData {
  direction: DebtDirection;
  counterparty: string;
  principalMinor: Minor;
  /** Проценты за весь срок (≥ 1) или null — без процентов. */
  interestMinor: Minor | null;
  /** Ставка в сотых долях процента годовых; только вместе с процентами. */
  interestRateBp: number | null;
  /** Срок в месяцах; только вместе с процентами. */
  termMonths: number | null;
  currency: CurrencyCode;
  openedOn: IsoDate;
  dueOn: IsoDate | null;
  note: string;
  closedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
}

/** Необязательное поле: нет значения или null — null; иначе проверка как у обязательного. */
const optional = <T>(v: unknown, read: (x: unknown) => T): T | null => (v === null || v === undefined ? null : read(v));

export function parseDebtData(raw: Record<string, unknown>): DebtData {
  const noteRaw = raw['note'];
  const dueRaw = raw['dueOn'];
  // Резервные копии и устройства до появления процентов этих полей не знают: нет поля — нет процентов.
  const interestMinor = optional(raw['interestMinor'], (v) => reqMinorInRange(v, 'Проценты по долгу', 1, MINOR_LIMIT));
  const interestRateBp = optional(raw['interestRateBp'], (v) => reqSafeInt(v, 'Ставка по долгу', RATE_BP_MIN, RATE_BP_MAX));
  const termMonths = optional(raw['termMonths'], (v) => reqSafeInt(v, 'Длительность кредита (месяцев)', TERM_MONTHS_MIN, TERM_MONTHS_MAX));
  if (interestMinor === null && (interestRateBp !== null || termMonths !== null)) {
    fail('Проценты по долгу: ставка и срок бывают только вместе с процентами');
  }
  return {
    direction: reqEnum(raw['direction'], 'Направление долга', DEBT_DIRECTIONS),
    counterparty: reqText(raw['counterparty'], 'Кто должен / кому должны', COUNTERPARTY_MAX),
    principalMinor: reqPositiveMinor(raw['principalMinor'], 'Сумма долга'),
    interestMinor,
    interestRateBp,
    termMonths,
    currency: reqCurrency(raw['currency'], 'Валюта долга'),
    openedOn: reqDate(raw['openedOn'], 'Дата долга'),
    dueOn: dueRaw === null || dueRaw === undefined ? null : reqDate(dueRaw, 'Срок возврата'),
    note: noteRaw === undefined || noteRaw === null ? '' : reqText(noteRaw, 'Заметка', LIMITS.note, 0),
    closedAt: optStamp(raw['closedAt'], 'Дата закрытия долга'),
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации долга'),
  };
}

export interface RuleData {
  kind: TxKind;
  walletId: UUID;
  toWalletId: UUID | null;
  amountMinor: Minor;
  toAmountMinor: Minor | null;
  categoryId: UUID | null;
  debtId: UUID | null;
  note: string;
  frequency: Frequency;
  intervalN: number;
  startOn: IsoDate;
  endOn: IsoDate | null;
  autoPost: 0 | 1;
  archivedAt: IsoDateTime | null;
}

/**
 * Проверка регулярного платежа без базы. Форма платежа — как у операции (вид, кошельки, суммы, категория, долг); расписание:
 * шаг 1…1000, начало и конец в границах дат сервера, конец не раньше начала, autoPost 0 или 1.
 * requireToAmount — для готовых строк (импорт): у перевода обязана быть сумма зачисления.
 */
export function parseRuleData(raw: Record<string, unknown>, opts: { requireToAmount?: boolean } = {}): RuleData {
  const startOn = reqDate(raw['startOn'], 'Начало расписания');
  const f = parseTxFields({ ...raw, occurredOn: startOn }, opts);
  const endRaw = raw['endOn'];
  const endOn = endRaw === null || endRaw === undefined ? null : reqDate(endRaw, 'Конец расписания');
  if (endOn !== null && endOn < startOn) fail('Конец расписания не может быть раньше начала');
  return {
    kind: f.kind,
    walletId: f.walletId,
    toWalletId: f.toWalletId,
    amountMinor: f.amountMinor,
    toAmountMinor: f.toAmountMinor,
    categoryId: f.categoryId,
    debtId: f.debtId,
    note: f.note,
    frequency: reqEnum(raw['frequency'], 'Частота', FREQUENCIES),
    intervalN: reqSafeInt(raw['intervalN'], 'Шаг повторения', INTERVAL_N_MIN, INTERVAL_N_MAX),
    startOn,
    endOn,
    autoPost: reqSafeInt(raw['autoPost'], 'Автопроведение', 0, 1) === 1 ? 1 : 0,
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации регулярного платежа'),
  };
}

export interface ShoppingData {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  priceMinor: Minor | null;
  checkedAt: IsoDateTime | null;
  purchasedAt: IsoDateTime | null;
  transactionId: UUID | null;
}

/**
 * Проверка позиции списка покупок без базы — те же границы, что у сервера (shopping_items): название 1…80 символов,
 * количество 0,001…1 000 000 (целое в тысячных), цена 0…1e15. Отметка и цена идут вместе; купленная позиция — отмеченная и с чеком.
 */
export function parseShoppingData(raw: Record<string, unknown>): ShoppingData {
  const price = raw['priceMinor'];
  const priceMinor = price === null || price === undefined ? null : reqMinorInRange(price, 'Цена позиции', 0, MINOR_LIMIT);
  const checkedAt = optStamp(raw['checkedAt'], 'Время отметки позиции');
  const purchasedAt = optStamp(raw['purchasedAt'], 'Время покупки позиции');
  const transactionId = optId(raw['transactionId'], 'Расход покупки');
  if ((checkedAt === null) !== (priceMinor === null)) fail('Отметка позиции и цена ставятся вместе');
  if (purchasedAt !== null && (checkedAt === null || transactionId === null)) fail('Купленная позиция должна быть отмечена и входить в чек расхода');
  if (purchasedAt === null && transactionId !== null) fail('Чек расхода есть только у купленной позиции');
  return {
    name: reqText(raw['name'], 'Название товара', SHOPPING_NAME_MAX),
    qtyMilli: reqSafeInt(raw['qtyMilli'], 'Количество', QTY_MIN, QTY_MAX),
    unit: reqEnum(raw['unit'], 'Единица', SHOPPING_UNITS),
    priceMinor,
    checkedAt,
    purchasedAt,
    transactionId,
  };
}
