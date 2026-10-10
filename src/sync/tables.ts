import type { Category, Entity, Settings, Transaction, Wallet } from '@/domain/types';

/**
 * ДОГОВОР между клиентом и базой: какие таблицы синхронизируются и как поля сущностей
 * (camelCase) отображаются на колонки Postgres (snake_case).
 * supabase/schema.sql ОБЯЗАН содержать ровно эти колонки (+ служебные user_id, server_seq, server_updated_at).
 */

/** Порядок = порядок отправки (родители раньше детей). */
export const SYNC_TABLES = ['settings', 'wallets', 'categories', 'transactions'] as const;
export type SyncTableName = (typeof SYNC_TABLES)[number];

export type WireValue = string | number | boolean | null;
export type WireRow = Record<string, WireValue>;
/** Строка, пришедшая с сервера: плюс курсор. */
export type PulledRow = WireRow & { server_seq: number };

type ColType = 'uuid' | 'text' | 'int' | 'num' | 'ts' | 'date';
interface Col {
  field: string;
  column: string;
  type: ColType;
  nullable?: boolean;
}

const COMMON: Col[] = [
  { field: 'id', column: 'id', type: 'uuid' },
  { field: 'createdAt', column: 'created_at', type: 'ts' },
  { field: 'clientUpdatedAt', column: 'client_updated_at', type: 'ts' },
  { field: 'deviceId', column: 'device_id', type: 'text' },
  { field: 'deletedAt', column: 'deleted_at', type: 'ts', nullable: true },
];

export interface TableSpec {
  /** Имя таблицы в схеме public */
  remote: string;
  columns: Col[];
}

export const TABLE_SPECS: Record<SyncTableName, TableSpec> = {
  settings: {
    remote: 'settings',
    columns: [
      ...COMMON,
      { field: 'baseCurrency', column: 'base_currency', type: 'text' },
      { field: 'locale', column: 'locale', type: 'text' },
      { field: 'weekStartsOn', column: 'week_starts_on', type: 'int' },
      { field: 'defaultWalletId', column: 'default_wallet_id', type: 'uuid', nullable: true },
    ],
  },
  wallets: {
    remote: 'wallets',
    columns: [
      ...COMMON,
      { field: 'name', column: 'name', type: 'text' },
      { field: 'currency', column: 'currency', type: 'text' },
      { field: 'kind', column: 'kind', type: 'text' },
      { field: 'openingBalanceMinor', column: 'opening_balance_minor', type: 'int' },
      { field: 'color', column: 'color', type: 'text' },
      { field: 'icon', column: 'icon', type: 'text' },
      { field: 'sortOrder', column: 'sort_order', type: 'int' },
      { field: 'archivedAt', column: 'archived_at', type: 'ts', nullable: true },
    ],
  },
  categories: {
    remote: 'categories',
    columns: [
      ...COMMON,
      { field: 'name', column: 'name', type: 'text' },
      { field: 'kind', column: 'kind', type: 'text' },
      { field: 'parentId', column: 'parent_id', type: 'uuid', nullable: true },
      { field: 'color', column: 'color', type: 'text' },
      { field: 'icon', column: 'icon', type: 'text' },
      { field: 'sortOrder', column: 'sort_order', type: 'int' },
      { field: 'archivedAt', column: 'archived_at', type: 'ts', nullable: true },
    ],
  },
  transactions: {
    remote: 'transactions',
    columns: [
      ...COMMON,
      { field: 'kind', column: 'kind', type: 'text' },
      { field: 'walletId', column: 'wallet_id', type: 'uuid' },
      { field: 'toWalletId', column: 'to_wallet_id', type: 'uuid', nullable: true },
      { field: 'amountMinor', column: 'amount_minor', type: 'int' },
      { field: 'toAmountMinor', column: 'to_amount_minor', type: 'int', nullable: true },
      { field: 'categoryId', column: 'category_id', type: 'uuid', nullable: true },
      { field: 'occurredOn', column: 'occurred_on', type: 'date' },
      { field: 'note', column: 'note', type: 'text' },
      { field: 'baseCurrency', column: 'base_currency', type: 'text' },
      { field: 'baseAmountMinor', column: 'base_amount_minor', type: 'int' },
      { field: 'fxRate', column: 'fx_rate', type: 'num', nullable: true },
      { field: 'fxSource', column: 'fx_source', type: 'text', nullable: true },
    ],
  },
};

export type EntityOf<T extends SyncTableName> = T extends 'settings'
  ? Settings
  : T extends 'wallets'
    ? Wallet
    : T extends 'categories'
      ? Category
      : Transaction;

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}

/** Сущность → строка для отправки. user_id/server_seq сервер ставит сам; локальные поля (dirty и т.п.) не уходят. */
export function toWire(table: SyncTableName, entity: Entity): WireRow {
  const row: WireRow = {};
  const src = entity as unknown as Record<string, unknown>;
  for (const c of TABLE_SPECS[table].columns) {
    const v = src[c.field];
    row[c.column] = v === undefined ? null : (v as WireValue);
  }
  return row;
}

/**
 * Строка с сервера → сущность. Метки времени приводятся к каноничному виду ISO-UTC с миллисекундами
 * (PostgREST отдаёт '2026-10-10T16:40:00.123456+00:00'). Бросает WireError, если обязательное поле пропало или не того типа.
 */
export function fromWire(table: SyncTableName, wire: Record<string, unknown>): { entity: Entity; serverSeq: number } {
  const out: Record<string, unknown> = {};
  for (const c of TABLE_SPECS[table].columns) {
    const raw = wire[c.column];
    if (raw === null || raw === undefined) {
      if (!c.nullable) throw new WireError(`${table}.${c.column}: обязательное поле пустое`);
      out[c.field] = null;
      continue;
    }
    switch (c.type) {
      case 'uuid':
      case 'text':
      case 'date':
        if (typeof raw !== 'string') throw new WireError(`${table}.${c.column}: ожидалась строка`);
        out[c.field] = raw;
        break;
      case 'int':
        if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) throw new WireError(`${table}.${c.column}: ожидалось целое`);
        out[c.field] = raw;
        break;
      case 'num':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new WireError(`${table}.${c.column}: ожидалось число`);
        out[c.field] = raw;
        break;
      case 'ts': {
        const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
        if (Number.isNaN(t)) throw new WireError(`${table}.${c.column}: ожидалась дата-время`);
        out[c.field] = new Date(t).toISOString();
        break;
      }
    }
  }
  const seq = wire['server_seq'];
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq)) throw new WireError(`${table}.server_seq: ожидалось целое`);
  return { entity: out as unknown as Entity, serverSeq: seq };
}
