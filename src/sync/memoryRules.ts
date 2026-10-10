import { TABLE_SPECS, type SyncTableName, type WireRow } from './tables';
import { TransportError } from './transport';

/**
 * Правила приёма строк для сервера в памяти: то же, что CHECK / NOT NULL / внешние ключи в supabase/schema.sql.
 * Внутри сервера метки времени хранятся числом (мс от 1970), остальное как есть.
 * Названия ограничений совпадают со схемой — по ним видно, какое правило сработало.
 */

/** Значение ячейки внутри сервера: метки времени — число (мс), числа — число, прочее — строка или null. */
export type Cell = string | number | null;
export type Rec = Record<string, Cell>;

export const MIN_TS_MS = Date.UTC(2000, 0, 1);
export const MAX_TS_MS = Date.UTC(2100, 0, 1);
const BOUND = 1_000_000_000_000_000; // 1e15, как в схеме
const PG_BIGINT_MAX = 9.2e18;

/** Колонки, которые клиент может прислать, но сервер их игнорирует и ставит сам. */
export const SERVER_COLUMNS = ['user_id', 'server_seq', 'server_updated_at'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;

export const rejected = (message: string, code: string): TransportError => new TransportError('rejected', message, code);

const checkFail = (table: string, name: string): TransportError =>
  rejected(`new row for relation "${table}" violates check constraint "${name}"`, '23514');

/** Длина в символах, как char_length в Postgres (а не в UTF-16 единицах). */
const charLength = (s: string): number => [...s].length;

/** '2026-10-10T16:40:00.123456+00:00' → мс. Бросает 22007, если это не метка времени. */
export function parseTimestamp(raw: unknown, column: string): number {
  if (typeof raw !== 'string' || !TS_RE.test(raw.trim())) {
    throw rejected(`invalid input syntax for type timestamp with time zone in column "${column}"`, '22007');
  }
  const s = raw.trim().replace(' ', 'T');
  const ms = Date.parse(/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s) ? s : `${s}Z`);
  if (Number.isNaN(ms)) throw rejected(`date/time field value out of range in column "${column}"`, '22008');
  return ms;
}

/** Postgres отдаёт метки так: '2026-10-10T16:40:00.123+00:00' (хвостовые нули дроби отрезаются). */
export function formatTimestamp(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-10-10T16:40:00.123Z
  const [head, frac = ''] = iso.slice(0, -1).split('.');
  const trimmed = frac.replace(/0+$/, '');
  return `${head}${trimmed === '' ? '' : `.${trimmed}`}+00:00`;
}

export function parseDate(raw: unknown, column: string): string {
  const m = typeof raw === 'string' ? DATE_RE.exec(raw) : null;
  if (!m) throw rejected(`invalid input syntax for type date in column "${column}"`, '22007');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw rejected(`date/time field value out of range in column "${column}"`, '22008');
  }
  return raw as string;
}

/** numeric(20,10): не более 10 цифр до запятой, 10 после (лишнее округляется, как в Postgres). */
function roundNumeric(v: number, column: string): number {
  if (Math.abs(v) >= 1e10) throw rejected(`numeric field overflow in column "${column}"`, '22003');
  const r = Number(v.toFixed(10));
  return r === 0 ? 0 : r;
}

/**
 * Приводит присланную строку к виду базы (как jsonb_populate_recordset): типы по колонкам договора, пустое → null.
 * Сервисные колонки (user_id, server_seq, server_updated_at) только проверяются на тип и отбрасываются.
 * Бросает 23502 (пустое обязательное) или 22xxx (не тот тип).
 */
export function coerceRow(table: SyncTableName, wire: WireRow): Rec {
  const spec = TABLE_SPECS[table];
  const out: Rec = {};
  for (const col of spec.columns) {
    const raw: unknown = wire[col.column];
    if (raw === undefined || raw === null) {
      if (!col.nullable) {
        throw rejected(`null value in column "${col.column}" of relation "${table}" violates not-null constraint`, '23502');
      }
      out[col.column] = null;
      continue;
    }
    switch (col.type) {
      case 'uuid':
        if (typeof raw !== 'string' || !UUID_RE.test(raw)) throw rejected(`invalid input syntax for type uuid: column "${col.column}"`, '22P02');
        out[col.column] = raw.toLowerCase();
        break;
      case 'text':
        if (typeof raw !== 'string') throw rejected(`invalid input for text column "${col.column}"`, '22P02');
        if (raw.includes('\u0000')) throw rejected(`unsupported Unicode escape sequence in column "${col.column}"`, '22P05');
        out[col.column] = raw;
        break;
      case 'int':
        if (typeof raw !== 'number' || !Number.isInteger(raw)) throw rejected(`invalid input syntax for type bigint: column "${col.column}"`, '22P02');
        if (Math.abs(raw) > PG_BIGINT_MAX) throw rejected(`bigint out of range: column "${col.column}"`, '22003');
        out[col.column] = raw === 0 ? 0 : raw;
        break;
      case 'num':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) throw rejected(`invalid input syntax for type numeric: column "${col.column}"`, '22P02');
        out[col.column] = roundNumeric(raw, col.column);
        break;
      case 'date':
        out[col.column] = parseDate(raw, col.column);
        break;
      case 'ts':
        out[col.column] = parseTimestamp(raw, col.column);
        break;
    }
  }
  // Сервисные колонки: сервер всё равно перезапишет, но мусор по типу PostgREST отвергает ещё до триггера.
  if (wire['user_id'] != null && (typeof wire['user_id'] !== 'string' || !UUID_RE.test(wire['user_id']))) {
    throw rejected('invalid input syntax for type uuid: column "user_id"', '22P02');
  }
  if (wire['server_seq'] != null && (typeof wire['server_seq'] !== 'number' || !Number.isInteger(wire['server_seq']))) {
    throw rejected('invalid input syntax for type bigint: column "server_seq"', '22P02');
  }
  if (wire['server_updated_at'] != null) parseTimestamp(wire['server_updated_at'], 'server_updated_at');
  return out;
}

const tsOk = (v: Cell): boolean => typeof v === 'number' && v >= MIN_TS_MS && v <= MAX_TS_MS;
const tsOkOrNull = (v: Cell): boolean => v === null || tsOk(v);
const inBound = (v: Cell, min = -BOUND, max = BOUND): boolean => typeof v === 'number' && v >= min && v <= max;

/**
 * CHECK-ограничения таблицы на строку ПОСЛЕ работы триггера (метки уже зажаты). Бросает 23514.
 * userId нужен для settings (id обязан равняться id пользователя).
 */
export function checkConstraints(table: SyncTableName, r: Rec, userId: string): void {
  const fail = (name: string): never => {
    throw checkFail(table, `${table}_${name}`);
  };
  const devLen = charLength(String(r['device_id']));
  if (devLen < 1 || devLen > 64) fail('device_id_len');
  if (!tsOk(r['created_at'] ?? null) || !tsOk(r['client_updated_at'] ?? null) || !tsOkOrNull(r['deleted_at'] ?? null)) fail('ts_sane');

  switch (table) {
    case 'settings':
      if (r['id'] !== userId) fail('id_is_user');
      if (!CURRENCY_RE.test(String(r['base_currency']))) fail('base_currency_fmt');
      if (r['locale'] !== 'ru') fail('locale_ru');
      if (r['week_starts_on'] !== 0 && r['week_starts_on'] !== 1) fail('week_starts_on');
      break;
    case 'wallets': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!CURRENCY_RE.test(String(r['currency']))) fail('currency_fmt');
      if (!['cash', 'card', 'bank', 'savings', 'other'].includes(String(r['kind']))) fail('kind');
      const n = charLength(String(r['name']));
      if (n < 1 || n > 80) fail('name_len');
      if (!inBound(r['opening_balance_minor'] ?? null)) fail('opening_balance');
      if (!inBound(r['sort_order'] ?? null)) fail('sort_order');
      break;
    }
    case 'categories': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!['expense', 'income'].includes(String(r['kind']))) fail('kind');
      const n = charLength(String(r['name']));
      if (n < 1 || n > 80) fail('name_len');
      if (!inBound(r['sort_order'] ?? null)) fail('sort_order');
      break;
    }
    case 'transactions': {
      const kind = String(r['kind']);
      if (!['expense', 'income', 'transfer'].includes(kind)) fail('kind');
      if (!inBound(r['amount_minor'] ?? null, 1)) fail('amount');
      if (!inBound(r['base_amount_minor'] ?? null, 0)) fail('base_amount');
      const day = String(r['occurred_on']);
      if (day < '2000-01-01' || day > '2100-01-01') fail('occurred_on');
      if (charLength(String(r['note'])) > 500) fail('note_len');
      if (!CURRENCY_RE.test(String(r['base_currency']))) fail('base_currency_fmt');
      const fx = r['fx_rate'] ?? null;
      if (fx !== null && !(typeof fx === 'number' && fx > 0)) fail('fx_rate');
      if (kind === 'transfer') {
        const ok =
          r['to_wallet_id'] != null &&
          r['to_amount_minor'] != null &&
          inBound(r['to_amount_minor'], 1) &&
          r['to_wallet_id'] !== r['wallet_id'] &&
          r['category_id'] == null &&
          fx === null &&
          r['fx_source'] == null;
        if (!ok) fail('transfer_shape');
      } else if (r['to_wallet_id'] != null || r['to_amount_minor'] != null) {
        fail('plain_shape');
      }
      break;
    }
  }
}

/** Что нужно знать о соседних таблицах для проверки внешних ключей. */
export type ParentLookup = (table: 'wallets' | 'categories', userId: string, id: string) => boolean;

/** Внешние ключи операции: кошелёк, кошелёк зачисления, категория — обязаны существовать у ТОГО ЖЕ пользователя. Бросает 23503. */
export function checkForeignKeys(table: SyncTableName, r: Rec, userId: string, exists: ParentLookup): void {
  if (table !== 'transactions') return;
  const refs: Array<[string, 'wallets' | 'categories', string]> = [
    ['wallet_id', 'wallets', 'transactions_wallet_fk'],
    ['to_wallet_id', 'wallets', 'transactions_to_wallet_fk'],
    ['category_id', 'categories', 'transactions_category_fk'],
  ];
  for (const [column, parent, constraint] of refs) {
    const id = r[column];
    if (id == null) continue; // пустой ключ не проверяется (MATCH SIMPLE)
    if (!exists(parent, userId, String(id))) {
      throw rejected(`insert or update on table "transactions" violates foreign key constraint "${constraint}"`, '23503');
    }
  }
}
