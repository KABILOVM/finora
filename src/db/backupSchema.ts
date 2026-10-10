import type { Category, Settings, Transaction, Wallet } from '@/domain/types';
import { MAX_FUTURE_SKEW_MS, MAX_OBSERVE_AHEAD_MS, MAX_STAMP, MAX_STAMP_MS, MIN_STAMP, MIN_STAMP_MS } from './clock';
import { fail, ValidationError } from './errors';
import { isUuid } from './ids';
import {
  isCanonicalStamp,
  isPlainObject,
  parseCategoryData,
  parseSettingsData,
  parseSyncData,
  parseTxFields,
  parseTxSnapshot,
  parseWalletData,
  reqObject,
  SORT_ORDER_MAX,
  SORT_ORDER_MIN,
  type SyncData,
} from './validate';

/**
 * Строгая проверка файла резервной копии. Выполняется ЦЕЛИКОМ до первой записи в базу:
 * любая ошибка — и в базе не меняется ничего. Лишние поля отбрасываются, типы и границы проверяются.
 */

export const BACKUP_FORMAT = 'finora-backup';
export const BACKUP_VERSION = 1;

/** Предельные размеры: защита от файла-«бомбы». Личному учёту хватает с огромным запасом. */
export const BACKUP_LIMITS = { wallets: 1_000, categories: 5_000, transactions: 500_000 } as const;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  settings: Settings | null;
  wallets: Wallet[];
  categories: Category[];
  /** Включая удалённые: без них удаление не доехало бы до других устройств. */
  transactions: Transaction[];
}

export interface ParseBackupOptions {
  /** Владелец базы, в которую импортируем. Копия другого аккаунта отвергается. */
  userId: string;
  /** Текущее время, мс (метки позже «сейчас + 5 минут» считаются метками из будущего и подрезаются, см. limitStamps). */
  nowMs: number;
}

/** Опции разбора вместе с меткой, до которой подрезаются метки из будущего (одна на весь файл). */
interface StampLimits extends ParseBackupOptions {
  /** Во что превращается метка из будущего. Зависит от самого файла, а не от «сейчас» (см. futureStampTarget). */
  futureTarget: string;
}

function rows(raw: Record<string, unknown>, key: string, label: string, max: number): unknown[] {
  const list = raw[key];
  if (!Array.isArray(list)) fail(`В файле нет списка «${label}»`);
  if (list.length > max) fail(`Слишком много записей в разделе «${label}»: ${list.length} (допустимо не больше ${max})`);
  return list;
}

/** Выполняет проверку одной записи; ошибку дополняет номером записи, чтобы человек понял, где искать. */
function atRow<T>(label: string, index: number | null, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new ValidationError(`Резервная копия, ${label}${index === null ? '' : ` №${index + 1}`}: ${e.message}`);
    }
    throw e;
  }
}

/**
 * В файле каждый идентификатор записи и каждая ссылка (walletId, toWalletId, categoryId, parentId, defaultWalletId)
 * обязаны быть UUID: на сервере эти колонки имеют тип uuid, и строка с другим id отвергается навсегда.
 * UUID приводится к нижнему регистру ВМЕСТЕ со всеми ссылками: Postgres хранит и возвращает его строчным,
 * и запись в верхнем регистре дала бы дубль, а ссылка на неё разошлась бы с самой записью.
 */
function withUuids(raw: Record<string, unknown>, labels: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [key, label] of Object.entries(labels)) {
    const v = raw[key];
    if (v === null || v === undefined) continue; // обязательность проверит разбор самой записи
    if (!isUuid(v)) fail(`${label}: идентификатор должен быть в виде UUID (например 0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48)`);
    out[key] = v.toLowerCase();
  }
  return out;
}

/**
 * Порядок за границей сервера (±1e15) зажимается, а не отвергает копию: порядок — лишь расположение в списке,
 * а своя же копия не должна не загружаться из-за него. Не число остаётся как есть — его отвергнет обычная проверка.
 */
function withClampedSortOrder(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw['sortOrder'];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return raw;
  return { ...raw, sortOrder: Math.min(Math.max(v, SORT_ORDER_MIN), SORT_ORDER_MAX) };
}

/** Метка в границах сервера (CHECK ..._ts_sane в supabase/schema.sql): 2000-01-01 … 2100-01-01 включительно. */
const toServerRange = (stamp: string): string => (stamp < MIN_STAMP ? MIN_STAMP : stamp > MAX_STAMP ? MAX_STAMP : stamp);

/**
 * Во что превращается метка из будущего. Это значение НЕ должно зависеть от того, когда нажали «Загрузить копию»:
 * иначе тот же файл при каждом импорте получает всё более свежие метки, выигрывает у правок, сделанных между импортами,
 * и «повторный импорт ничего не меняет» перестаёт быть правдой.
 *  - обычный случай: часы источника убежали вперёд, потом их поправили. Время создания копии (exportedAt) — настоящее,
 *    и значит ничего из файла не было изменено позже этого момента: метки подрезаются до него. Одно и то же в каждом импорте;
 *  - exportedAt сам чуть впереди (часы источника спешат на пару минут): подрезаем до «сейчас + 5 минут», как сервер;
 *  - exportedAt дальше чем на 30 минут впереди (часы источника сейчас неверны): времени записи мы не знаем вообще.
 *    Такая запись получает самую раннюю метку: добавляется, если её нет, но никогда не затирает то, что уже есть на устройстве.
 * Не меньше 2000-01-01 и не больше 2100-01-01: за этими границами сервер запись отвергнет навсегда.
 */
function futureStampTarget(exportedAt: string, nowMs: number): string {
  const exportedMs = Date.parse(exportedAt);
  if (!(exportedMs <= nowMs + MAX_OBSERVE_AHEAD_MS)) return MIN_STAMP; // сюда же попадает «не число»
  const ms = Math.min(exportedMs, nowMs + MAX_FUTURE_SKEW_MS);
  return new Date(Math.min(Math.max(ms, MIN_STAMP_MS), MAX_STAMP_MS)).toISOString();
}

/**
 * Метки из прошлого и из будущего. Устройство-источник могло жить с неверными часами (старая копия с меткой 1970 года,
 * часы, убежавшие вперёд), а собственную копию человека из-за этого отвергать нельзя. Поэтому метки подрезаются:
 *  - createdAt, clientUpdatedAt, deletedAt позже «сейчас + 5 минут» (дальше сервер всё равно зажал бы их сам) заменяются
 *    на futureStampTarget: метку из будущего нельзя оставить, иначе она навсегда обгоняла бы правки человека;
 *  - эти же три метки и archivedAt (см. withClampedArchivedAt): в границах сервера 2000-01-01 … 2100-01-01.
 * Запись с меткой за этими границами сервер отверг бы НАВСЕГДА (она осела бы в карантине), поэтому её подрезаем до границы.
 * Порядок «новее побеждает» (clientUpdatedAt, затем deviceId) сохраняется: у локальных строк метки всегда внутри границ,
 * а метка из будущего подрезается одинаково при каждом импорте, так что тот же файл второй раз ничего не заменяет,
 * а старая копия по-прежнему проигрывает более новым локальным правкам.
 */
function limitStamps(sync: SyncData, o: StampLimits): SyncData {
  const limit = new Date(o.nowMs + MAX_FUTURE_SKEW_MS).toISOString();
  const cut = (stamp: string): string => toServerRange(stamp > limit ? o.futureTarget : stamp);
  return {
    ...sync,
    createdAt: cut(sync.createdAt),
    clientUpdatedAt: cut(sync.clientUpdatedAt),
    deletedAt: sync.deletedAt === null ? null : cut(sync.deletedAt),
  };
}

/**
 * archivedAt (кошелёк, категория) — тоже метка с CHECK сервера 2000–2100: подрезается до границы, а не отвергает копию.
 * «Сейчас + 5 минут» к ней не применяется (сервер её не зажимает). Не метка вообще (мусор) остаётся как есть:
 * её отвергнет обычная проверка.
 */
function withClampedArchivedAt(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw['archivedAt'];
  if (!isCanonicalStamp(v)) return raw;
  const clamped = toServerRange(v);
  return clamped === v ? raw : { ...raw, archivedAt: clamped };
}

export function parseBackup(data: unknown, opts: ParseBackupOptions): BackupFile {
  if (!isPlainObject(data)) fail('Это не файл резервной копии Finora');
  if (data['format'] !== BACKUP_FORMAT) fail('Это не файл резервной копии Finora');
  const version = data['version'];
  if (version !== BACKUP_VERSION) {
    fail(
      typeof version === 'number' && version > BACKUP_VERSION
        ? 'Файл создан более новой версией Finora: обновите приложение'
        : 'Неизвестная версия резервной копии',
    );
  }
  const exportedAt = data['exportedAt'];
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) fail('В файле нет даты создания копии');
  const limits: StampLimits = { ...opts, futureTarget: futureStampTarget(exportedAt, opts.nowMs) };

  const walletsRaw = rows(data, 'wallets', 'кошельки', BACKUP_LIMITS.wallets);
  const categoriesRaw = rows(data, 'categories', 'категории', BACKUP_LIMITS.categories);
  const txRaw = rows(data, 'transactions', 'операции', BACKUP_LIMITS.transactions);

  const seen = (set: Set<string>, id: string) => {
    if (set.has(id)) fail(`повторяющийся идентификатор ${id}`);
    set.add(id);
  };

  let settings: Settings | null = null;
  const settingsRaw = data['settings'];
  if (settingsRaw !== null && settingsRaw !== undefined) {
    settings = atRow('настройки', null, () => {
      const raw = withUuids(reqObject(settingsRaw, 'Настройки'), {
        id: 'Идентификатор записи',
        defaultWalletId: 'Кошелёк по умолчанию',
      });
      const sync = limitStamps(parseSyncData(raw), limits);
      if (sync.id !== opts.userId) fail('копия принадлежит другому аккаунту — импорт отменён');
      return { ...sync, ...parseSettingsData(raw) };
    });
  }

  const walletIds = new Set<string>();
  const wallets = walletsRaw.map((r, i) =>
    atRow('кошелёк', i, () => {
      const raw = withClampedArchivedAt(withClampedSortOrder(withUuids(reqObject(r, 'Кошелёк'), { id: 'Идентификатор записи' })));
      const sync = limitStamps(parseSyncData(raw), limits);
      seen(walletIds, sync.id);
      return { ...sync, ...parseWalletData(raw) } satisfies Wallet;
    }),
  );

  const categoryIds = new Set<string>();
  const categories = categoriesRaw.map((r, i) =>
    atRow('категория', i, () => {
      const raw = withClampedArchivedAt(
        withClampedSortOrder(
          withUuids(reqObject(r, 'Категория'), { id: 'Идентификатор записи', parentId: 'Родительская категория' }),
        ),
      );
      const sync = limitStamps(parseSyncData(raw), limits);
      seen(categoryIds, sync.id);
      const data = parseCategoryData(raw);
      if (data.parentId === sync.id) fail('категория не может быть родителем самой себе');
      return { ...sync, ...data } satisfies Category;
    }),
  );

  const txIds = new Set<string>();
  const transactions = txRaw.map((r, i) =>
    atRow('операция', i, () => {
      const raw = withUuids(reqObject(r, 'Операция'), {
        id: 'Идентификатор записи',
        walletId: 'Кошелёк',
        toWalletId: 'Кошелёк зачисления',
        categoryId: 'Категория',
      });
      const sync = limitStamps(parseSyncData(raw), limits);
      seen(txIds, sync.id);
      const fields = parseTxFields(raw, { requireToAmount: true });
      const snap = parseTxSnapshot(fields.kind, fields.amountMinor, raw);
      return { ...sync, ...fields, ...snap } satisfies Transaction;
    }),
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    settings,
    wallets,
    categories,
    transactions,
  };
}
