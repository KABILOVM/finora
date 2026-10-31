import { BASE_SEQ_COLUMN, TABLE_SPECS, type SyncTableName, type WireRow } from './tables';
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
/** Длины, добавленные в схему отдельным блоком (раздел 7 supabase/schema.sql): color / icon — не длиннее 32, fx_source — не длиннее 16. */
const SHORT_MAX = 32;
const FX_SOURCE_MAX = 16;
/** Границы дат в схеме: date '2000-01-01' … date '2100-01-01' (включительно). */
const MIN_DAY = '2000-01-01';
const MAX_DAY = '2100-01-01';
const dayOk = (v: Cell): boolean => typeof v === 'string' && v >= MIN_DAY && v <= MAX_DAY;
const dayOkOrNull = (v: Cell): boolean => v === null || dayOk(v);

/** Колонки, которые клиент может прислать, но сервер их игнорирует и ставит сам. */
export const SERVER_COLUMNS = ['user_id', 'server_seq', 'server_updated_at'] as const;

/** Все служебные колонки запроса: серверные + base_seq (версия, поверх которой сделана правка; в таблице всегда пуста). */
export const REQUEST_COLUMNS: readonly string[] = [...SERVER_COLUMNS, BASE_SEQ_COLUMN];

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
    // колонка не прислана: берётся значение по умолчанию (default в схеме); явный null для not null — отказ
    if (raw === undefined && col.fallback !== undefined) {
      out[col.column] = col.fallback;
      continue;
    }
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
  const base: unknown = wire[BASE_SEQ_COLUMN];
  if (base != null) {
    if (typeof base !== 'number' || !Number.isInteger(base)) throw rejected(`invalid input syntax for type bigint: column "${BASE_SEQ_COLUMN}"`, '22P02');
    if (Math.abs(base) > PG_BIGINT_MAX) throw rejected(`bigint out of range: column "${BASE_SEQ_COLUMN}"`, '22003');
  }
  return out;
}

/** Ожидаемая версия строки из запроса; null — проверки версии нет. Отрицательная — отказ (как в триггере sync_guard). */
export function baseSeqOf(wire: WireRow): number | null {
  const base: unknown = wire[BASE_SEQ_COLUMN];
  if (base === undefined || base === null) return null;
  const n = base as number; // тип и диапазон проверил coerceRow
  if (n < 0) throw rejected(`${BASE_SEQ_COLUMN} must not be negative`, '22023');
  return n;
}

/** Версия строки на сервере ушла вперёд (триггер sync_guard: errcode 40001). Клиент забирает свежее, объединяет и отправляет заново. */
export const conflict = (table: string, id: string, actual: number, expected: number): TransportError =>
  new TransportError('conflict', `sync_conflict: row ${id} of "${table}" is at version ${actual}, the write expected ${expected}`, '40001');

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
      // города для погоды (раздел 13 supabase/schema.sql): текст не длиннее 8000 знаков
      if (r['weather'] != null && charLength(String(r['weather'])) > 8000) fail('weather_len');
      break;
    case 'wallets': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!CURRENCY_RE.test(String(r['currency']))) fail('currency_fmt');
      if (!['cash', 'card', 'bank', 'savings', 'other'].includes(String(r['kind']))) fail('kind');
      const n = charLength(String(r['name']));
      if (n < 1 || n > 80) fail('name_len');
      if (!inBound(r['opening_balance_minor'] ?? null)) fail('opening_balance');
      if (!inBound(r['sort_order'] ?? null)) fail('sort_order');
      if (charLength(String(r['color'])) > SHORT_MAX) fail('color_len');
      if (charLength(String(r['icon'])) > SHORT_MAX) fail('icon_len');
      // цель накопления (раздел 11 supabase/schema.sql): сумма от 1 до 1e15, срок — в границах дат схемы
      if (r['goal_minor'] != null && !inBound(r['goal_minor'], 1)) fail('goal_minor');
      if (!dayOkOrNull(r['goal_on'] ?? null)) fail('goal_on');
      break;
    }
    case 'categories': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!['expense', 'income'].includes(String(r['kind']))) fail('kind');
      const n = charLength(String(r['name']));
      if (n < 1 || n > 80) fail('name_len');
      if (!inBound(r['sort_order'] ?? null)) fail('sort_order');
      if (charLength(String(r['color'])) > SHORT_MAX) fail('color_len');
      if (charLength(String(r['icon'])) > SHORT_MAX) fail('icon_len');
      // «обязательная» категория (раздел 16 supabase/schema.sql): 0 или 1
      if (r['essential'] !== 0 && r['essential'] !== 1) fail('essential');
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
      const fxSource = r['fx_source'] ?? null;
      if (fxSource !== null && charLength(String(fxSource)) > FX_SOURCE_MAX) fail('fx_source_len');
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
      // долг бывает только у расхода/дохода (этап 2)
      if (kind === 'transfer' && r['debt_id'] != null) fail('debt_shape');
      break;
    }
    case 'debts': {
      if (!tsOkOrNull(r['closed_at'] ?? null) || !tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!['lent', 'borrowed'].includes(String(r['direction']))) fail('direction');
      const n = charLength(String(r['counterparty']));
      if (n < 1 || n > 80) fail('counterparty_len');
      if (!inBound(r['principal_minor'] ?? null, 1)) fail('principal');
      if (r['interest_minor'] != null && !inBound(r['interest_minor'], 1)) fail('interest');
      if (r['interest_rate_bp'] != null && !inBound(r['interest_rate_bp'], 1, 100_000)) fail('interest_rate');
      if (r['term_months'] != null && !inBound(r['term_months'], 1, 600)) fail('term_months');
      if (r['interest_minor'] == null && (r['interest_rate_bp'] != null || r['term_months'] != null)) fail('interest_shape');
      if (r['merged_into_id'] != null && r['merged_into_id'] === r['id']) fail('merged_into_self');
      if (!CURRENCY_RE.test(String(r['currency']))) fail('currency_fmt');
      if (!dayOk(r['opened_on'] ?? null)) fail('opened_on');
      if (!dayOkOrNull(r['due_on'] ?? null)) fail('due_on');
      if (charLength(String(r['note'])) > 500) fail('note_len');
      // категория долга (раздел 17 supabase/schema.sql): не длиннее 40 знаков
      if (charLength(String(r['category'])) > 40) fail('category_len');
      break;
    }
    case 'budgets': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      if (!inBound(r['amount_minor'] ?? null, 1)) fail('amount');
      if (!CURRENCY_RE.test(String(r['currency']))) fail('currency_fmt');
      if (r['period'] !== 'month') fail('period');
      break;
    }
    case 'recurring_rules': {
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      const kind = String(r['kind']);
      if (!['expense', 'income', 'transfer'].includes(kind)) fail('kind');
      if (!inBound(r['amount_minor'] ?? null, 1)) fail('amount');
      if (!['daily', 'weekly', 'monthly', 'yearly'].includes(String(r['frequency']))) fail('frequency');
      if (!inBound(r['interval_n'] ?? null, 1, 1000)) fail('interval_n');
      if (!dayOk(r['start_on'] ?? null)) fail('start_on');
      const end = r['end_on'] ?? null;
      if (end !== null && !(dayOk(end) && String(end) >= String(r['start_on']))) fail('end_on');
      if (r['auto_post'] !== 0 && r['auto_post'] !== 1) fail('auto_post');
      if (charLength(String(r['note'])) > 500) fail('note_len');
      if (kind === 'transfer') {
        const ok =
          r['to_wallet_id'] != null &&
          r['to_amount_minor'] != null &&
          inBound(r['to_amount_minor'], 1) &&
          r['to_wallet_id'] !== r['wallet_id'] &&
          r['category_id'] == null &&
          r['debt_id'] == null;
        if (!ok) fail('transfer_shape');
      } else if (r['to_wallet_id'] != null || r['to_amount_minor'] != null) {
        fail('plain_shape');
      }
      break;
    }
    case 'shopping_items': {
      const n = charLength(String(r['name']));
      if (n < 1 || n > 80) fail('name_len');
      if (!inBound(r['qty_milli'] ?? null, 1, 1_000_000_000)) fail('qty');
      if (!['pcs', 'kg', 'l'].includes(String(r['unit']))) fail('unit');
      const price = r['price_minor'] ?? null;
      if (price !== null && !inBound(price, 0)) fail('price');
      if (!tsOkOrNull(r['checked_at'] ?? null) || !tsOkOrNull(r['purchased_at'] ?? null)) fail('ts_sane');
      // отметка и цена ставятся вместе; купленная позиция — отмеченная и с чеком; чек есть только у купленной
      if (((r['checked_at'] ?? null) === null) !== (price === null)) fail('state_shape');
      if ((r['purchased_at'] ?? null) !== null && ((r['checked_at'] ?? null) === null || (r['transaction_id'] ?? null) === null)) fail('purchase_shape');
      if ((r['transaction_id'] ?? null) !== null && (r['purchased_at'] ?? null) === null) fail('purchase_shape');
      break;
    }
    case 'savings_goals': {
      // цель накопления (раздел 18 supabase/schema.sql): название 1…60, сумма от 1 до 1e15, срок — в границах дат схемы
      if (!tsOkOrNull(r['archived_at'] ?? null)) fail('ts_sane');
      const n = charLength(String(r['name']));
      if (n < 1 || n > 60) fail('name_len');
      if (!inBound(r['target_minor'] ?? null, 1)) fail('target');
      if (!CURRENCY_RE.test(String(r['currency']))) fail('currency_fmt');
      if (!dayOk(r['due_on'] ?? null)) fail('due_on');
      break;
    }
  }
}

/** Таблицы, на которые могут ссылаться внешние ключи. */
export type ParentTable = 'wallets' | 'categories' | 'debts' | 'recurring_rules';

/** Что нужно знать о соседних таблицах для проверки внешних ключей. */
export type ParentLookup = (table: ParentTable, userId: string, id: string) => boolean;

type FkRef = readonly [column: string, parent: ParentTable, constraint: string];

/** Составные внешние ключи (user_id, колонка) → родитель: обязаны указывать на строку ТОГО ЖЕ пользователя. Имена — как в схеме. */
const FOREIGN_KEYS: Partial<Record<SyncTableName, readonly FkRef[]>> = {
  transactions: [
    ['wallet_id', 'wallets', 'transactions_wallet_fk'],
    ['to_wallet_id', 'wallets', 'transactions_to_wallet_fk'],
    ['category_id', 'categories', 'transactions_category_fk'],
    ['debt_id', 'debts', 'transactions_debt_fk'],
    ['recurring_rule_id', 'recurring_rules', 'transactions_recurring_rule_fk'],
  ],
  debts: [['merged_into_id', 'debts', 'debts_merged_into_fk']],
  budgets: [['category_id', 'categories', 'budgets_category_fk']],
  savings_goals: [['wallet_id', 'wallets', 'savings_goals_wallet_fk']],
  recurring_rules: [
    ['wallet_id', 'wallets', 'recurring_rules_wallet_fk'],
    ['to_wallet_id', 'wallets', 'recurring_rules_to_wallet_fk'],
    ['category_id', 'categories', 'recurring_rules_category_fk'],
    ['debt_id', 'debts', 'recurring_rules_debt_fk'],
  ],
};

/** Внешние ключи строки: родитель обязан существовать у ТОГО ЖЕ пользователя (даже удалённый мягко). Бросает 23503. */
export function checkForeignKeys(table: SyncTableName, r: Rec, userId: string, exists: ParentLookup): void {
  for (const [column, parent, constraint] of FOREIGN_KEYS[table] ?? []) {
    const id = r[column];
    if (id == null) continue; // пустой ключ не проверяется (MATCH SIMPLE)
    if (!exists(parent, userId, String(id))) {
      throw rejected(`insert or update on table "${table}" violates foreign key constraint "${constraint}"`, '23503');
    }
  }
}
