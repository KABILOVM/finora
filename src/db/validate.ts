import { isValidCurrencyCode } from '@/domain/currency';
import { isMinor } from '@/domain/money';
import type {
  CategoryKind,
  CurrencyCode,
  IsoDate,
  IsoDateTime,
  Minor,
  TxKind,
  UUID,
  WalletKind,
} from '@/domain/types';
import { fail } from './errors';

/**
 * Чистые проверки полей. Одни и те же правила работают и для репозиториев (ввод пользователя),
 * и для импорта резервной копии (чужой файл). Тексты ошибок — по-русски, годятся для показа человеку.
 */

export const WALLET_KINDS: readonly WalletKind[] = ['cash', 'card', 'bank', 'savings', 'other'];
export const CATEGORY_KINDS: readonly CategoryKind[] = ['expense', 'income'];
export const TX_KINDS: readonly TxKind[] = ['expense', 'income', 'transfer'];
/** Откуда может быть взят курс при ручной/сетевой передаче. 'same' ставит только сама база (валюта кошелька = базовая). */
export const FX_SOURCES: readonly string[] = ['nbt', 'server', 'api', 'manual', 'cached'];

export const LIMITS = {
  name: 60,
  note: 500,
  short: 32,
  id: 64,
  deviceId: 64,
} as const;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

export function reqObject(v: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`${label}: ожидался объект`);
  return v;
}

export function reqText(v: unknown, label: string, max: number, min = 1): string {
  if (typeof v !== 'string') fail(`${label}: ожидался текст`);
  const s = v.trim();
  if (s.length < min || s.length > max) {
    fail(min === 0 ? `${label}: не длиннее ${max} символов` : `${label}: от ${min} до ${max} символов`);
  }
  return s;
}

export function reqEnum<T extends string>(v: unknown, label: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(`${label}: допустимо только ${allowed.join(', ')}`);
  }
  return v as T;
}

export function reqSafeInt(v: unknown, label: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(`${label}: ожидалось целое число`);
  if (v < min || v > max) fail(`${label}: вне допустимых границ`);
  return v === 0 ? 0 : v; // убираем -0
}

export function reqMinor(v: unknown, label: string): Minor {
  if (!isMinor(v)) fail(`${label}: ожидалось целое безопасное число`);
  return v === 0 ? 0 : v;
}

/** Сумма операции: целое > 0. */
export function reqPositiveMinor(v: unknown, label: string): Minor {
  const n = reqMinor(v, label);
  if (n <= 0) fail(`${label}: должна быть больше нуля`);
  return n;
}

export function reqCurrency(v: unknown, label: string): CurrencyCode {
  if (!isValidCurrencyCode(v)) fail(`${label}: ожидался код валюты из трёх заглавных латинских букв (например TJS)`);
  return v;
}

const ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,63}$/;

export function reqId(v: unknown, label: string): UUID {
  if (typeof v !== 'string' || !ID_RE.test(v)) fail(`${label}: некорректный идентификатор`);
  return v;
}

export function optId(v: unknown, label: string): UUID | null {
  return v === null || v === undefined ? null : reqId(v, label);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Границы даты операции — ровно как CHECK transactions_occurred_on в supabase/schema.sql (обе включительно). */
export const MIN_OCCURRED_ON: IsoDate = '2000-01-01';
export const MAX_OCCURRED_ON: IsoDate = '2100-01-01';

/** Настоящая календарная дата YYYY-MM-DD (без проверки границ); 31 февраля — не дата. */
function isCalendarDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Настоящая дата в границах сервера (2000-01-01 … 2100-01-01): запись с другой датой сервер отвергнет навсегда. */
export function isRealDate(s: unknown): s is IsoDate {
  // строки одинаковой длины и формата сравниваются как даты
  return isCalendarDate(s) && s >= MIN_OCCURRED_ON && s <= MAX_OCCURRED_ON;
}

export function reqDate(v: unknown, label: string): IsoDate {
  if (!isCalendarDate(v)) fail(`${label}: ожидалась настоящая дата в виде ГГГГ-ММ-ДД`);
  if (!isRealDate(v)) fail(`${label}: допустимы даты с ${MIN_OCCURRED_ON} по ${MAX_OCCURRED_ON}`);
  return v;
}

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Каноничная метка времени 'YYYY-MM-DDTHH:mm:ss.sssZ' — только такая сравнивается как строка корректно. */
export function isCanonicalStamp(s: unknown): s is IsoDateTime {
  if (typeof s !== 'string' || !STAMP_RE.test(s)) return false;
  const ms = Date.parse(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === s;
}

export function reqStamp(v: unknown, label: string): IsoDateTime {
  if (!isCanonicalStamp(v)) fail(`${label}: ожидалась метка времени вида 2026-10-10T16:40:00.123Z`);
  return v;
}

export function optStamp(v: unknown, label: string): IsoDateTime | null {
  return v === null || v === undefined ? null : reqStamp(v, label);
}

/** Курс, переданный вызывающим кодом. */
export function parseFx(v: unknown): { rate: number; source: string } {
  const o = reqObject(v, 'Курс');
  const rate = o['rate'];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) fail('Курс: ожидалось число больше нуля');
  const source = o['source'];
  if (typeof source !== 'string' || !FX_SOURCES.includes(source)) {
    fail(`Источник курса: допустимо только ${FX_SOURCES.join(', ')}`);
  }
  return { rate, source };
}

// ───────────────────────── сущности ─────────────────────────

export interface WalletData {
  name: string;
  currency: CurrencyCode;
  kind: WalletKind;
  openingBalanceMinor: Minor;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
}

export function parseWalletData(raw: Record<string, unknown>): WalletData {
  return {
    name: reqText(raw['name'], 'Название кошелька', LIMITS.name),
    currency: reqCurrency(raw['currency'], 'Валюта кошелька'),
    kind: reqEnum(raw['kind'], 'Вид кошелька', WALLET_KINDS),
    openingBalanceMinor: reqMinor(raw['openingBalanceMinor'], 'Начальный остаток'),
    color: reqText(raw['color'], 'Цвет кошелька', LIMITS.short),
    icon: reqText(raw['icon'], 'Значок кошелька', LIMITS.short),
    sortOrder: reqSafeInt(raw['sortOrder'], 'Порядок кошелька'),
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации кошелька'),
  };
}

export interface CategoryData {
  name: string;
  kind: CategoryKind;
  parentId: UUID | null;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
}

export function parseCategoryData(raw: Record<string, unknown>): CategoryData {
  return {
    name: reqText(raw['name'], 'Название категории', LIMITS.name),
    kind: reqEnum(raw['kind'], 'Вид категории', CATEGORY_KINDS),
    parentId: optId(raw['parentId'], 'Родительская категория'),
    color: reqText(raw['color'], 'Цвет категории', LIMITS.short),
    icon: reqText(raw['icon'], 'Значок категории', LIMITS.short),
    sortOrder: reqSafeInt(raw['sortOrder'], 'Порядок категории'),
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации категории'),
  };
}

export interface TxFields {
  kind: TxKind;
  walletId: UUID;
  toWalletId: UUID | null;
  amountMinor: Minor;
  toAmountMinor: Minor | null;
  categoryId: UUID | null;
  occurredOn: IsoDate;
  note: string;
}

/**
 * Проверка полей операции, не требующая базы: типы, границы, согласованность вида (перевод/расход/доход).
 * requireToAmount — для готовых строк (импорт): у перевода обязана быть сумма зачисления.
 */
export function parseTxFields(raw: Record<string, unknown>, opts: { requireToAmount?: boolean } = {}): TxFields {
  const kind = reqEnum(raw['kind'], 'Вид операции', TX_KINDS);
  const walletId = reqId(raw['walletId'], 'Кошелёк');
  const amountMinor = reqPositiveMinor(raw['amountMinor'], 'Сумма');
  const occurredOn = reqDate(raw['occurredOn'], 'Дата операции');
  const noteRaw = raw['note'];
  const note = noteRaw === undefined || noteRaw === null ? '' : reqText(noteRaw, 'Заметка', LIMITS.note, 0);
  const categoryId = optId(raw['categoryId'], 'Категория');
  const toWalletId = optId(raw['toWalletId'], 'Кошелёк зачисления');
  const toAmountRaw = raw['toAmountMinor'];
  const toAmountMinor =
    toAmountRaw === null || toAmountRaw === undefined ? null : reqPositiveMinor(toAmountRaw, 'Сумма зачисления');

  if (kind === 'transfer') {
    if (toWalletId === null) fail('Перевод: укажите кошелёк зачисления');
    if (toWalletId === walletId) fail('Перевод: кошелёк зачисления должен отличаться от кошелька списания');
    if (categoryId !== null) fail('У перевода не бывает категории');
    if (opts.requireToAmount && toAmountMinor === null) fail('Перевод: не указана сумма зачисления');
  } else {
    if (toWalletId !== null) fail('Кошелёк зачисления бывает только у перевода');
    if (toAmountMinor !== null) fail('Сумма зачисления бывает только у перевода');
  }
  return { kind, walletId, toWalletId, amountMinor, toAmountMinor, categoryId, occurredOn, note };
}

export interface TxSnapshot {
  baseCurrency: CurrencyCode;
  baseAmountMinor: Minor;
  fxRate: number | null;
  fxSource: string | null;
}

/** Проверка снимка базовой валюты у готовой операции. */
export function parseTxSnapshot(kind: TxKind, amountMinor: Minor, raw: Record<string, unknown>): TxSnapshot {
  const baseCurrency = reqCurrency(raw['baseCurrency'], 'Базовая валюта операции');
  const baseAmountMinor = reqSafeInt(raw['baseAmountMinor'], 'Сумма в базовой валюте', 0);
  const rate = raw['fxRate'] ?? null;
  const source = raw['fxSource'] ?? null;
  if (kind === 'transfer') {
    if (baseAmountMinor !== 0) fail('Перевод: сумма в базовой валюте должна быть 0');
    if (rate !== null || source !== null) fail('Перевод: курс не используется');
    return { baseCurrency, baseAmountMinor, fxRate: null, fxSource: null };
  }
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) fail('Курс операции: ожидалось число больше нуля');
  if (typeof source !== 'string' || !(source === 'same' || FX_SOURCES.includes(source))) {
    fail('Источник курса операции: неизвестное значение');
  }
  if (source === 'same' && (rate !== 1 || baseAmountMinor !== amountMinor)) {
    fail('Операция в базовой валюте: курс должен быть 1, а сумма совпадать');
  }
  return { baseCurrency, baseAmountMinor, fxRate: rate, fxSource: source };
}

export interface SettingsData {
  baseCurrency: CurrencyCode;
  locale: 'ru';
  weekStartsOn: 0 | 1;
  defaultWalletId: UUID | null;
}

export function parseSettingsData(raw: Record<string, unknown>): SettingsData {
  const week = reqSafeInt(raw['weekStartsOn'], 'Первый день недели', 0, 1);
  if (raw['locale'] !== 'ru') fail('Язык: поддерживается только русский');
  return {
    baseCurrency: reqCurrency(raw['baseCurrency'], 'Базовая валюта'),
    locale: 'ru',
    weekStartsOn: week === 1 ? 1 : 0,
    defaultWalletId: optId(raw['defaultWalletId'], 'Кошелёк по умолчанию'),
  };
}

export interface SyncData {
  id: UUID;
  createdAt: IsoDateTime;
  clientUpdatedAt: IsoDateTime;
  deviceId: string;
  deletedAt: IsoDateTime | null;
}

export function parseSyncData(raw: Record<string, unknown>): SyncData {
  const deviceId = raw['deviceId'];
  if (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > LIMITS.deviceId || /\s/.test(deviceId)) {
    fail('Устройство: некорректный идентификатор');
  }
  return {
    id: reqId(raw['id'], 'Идентификатор записи'),
    createdAt: reqStamp(raw['createdAt'], 'Дата создания'),
    clientUpdatedAt: reqStamp(raw['clientUpdatedAt'], 'Дата изменения'),
    deviceId,
    deletedAt: optStamp(raw['deletedAt'], 'Дата удаления'),
  };
}

/** Строгое сравнение версий записи: (clientUpdatedAt, deviceId). Отрицательное — a старше b, 0 — одна и та же версия. */
export function compareVersion(
  a: { clientUpdatedAt: string; deviceId: string },
  b: { clientUpdatedAt: string; deviceId: string },
): number {
  if (a.clientUpdatedAt !== b.clientUpdatedAt) return a.clientUpdatedAt < b.clientUpdatedAt ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return 0;
}
