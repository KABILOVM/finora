import { defaultId } from '@/db/ids';
import type { CategoryKind } from '@/domain/types';
import type { AccountRef, ParsedFile, ZenRow } from './types';
import { nameKey } from './text';

/**
 * Детерминированные id: повторный импорт того же файла даёт те же id, поэтому ничего не задваивается и не затирается.
 *  операция  — uuidV5(userId, 'zen:' + нормализованные поля строки + номер среди одинаковых строк)
 *  кошелёк   — uuidV5(userId, 'zen-wallet:' + название + валюта)
 *  категория — uuidV5(userId, 'zen-cat:' + вид + путь)
 * Считаются один раз на файл (асинхронно: нужен SHA-1), дальше план строится синхронно и дёшево.
 */

export interface PlanIds {
  /** id операций, по порядку ZenRow.index. */
  tx: string[];
  wallets: Map<string, string>;
  categories: Map<string, string>;
}

export function categoryKey(kind: CategoryKind, path: readonly string[]): string {
  return `${kind}:${path.map(nameKey).join(' / ')}`;
}

export function walletSlug(key: string): string {
  return `zen-wallet:${key}`;
}

export function categorySlug(key: string): string {
  return `zen-cat:${key}`;
}

/** Все счета, встречающиеся в пригодных строках, в порядке появления. */
export function collectAccounts(rows: readonly ZenRow[]): Map<string, AccountRef & { rowCount: number }> {
  const out = new Map<string, AccountRef & { rowCount: number }>();
  for (const r of rows) {
    for (const side of [r.outcome, r.income]) {
      if (!side) continue;
      const a = out.get(side.account.key);
      if (a) a.rowCount++;
      else out.set(side.account.key, { ...side.account, rowCount: 1 });
    }
  }
  return out;
}

/** Ключи всех нужных категорий (и родительских тоже). */
export function collectCategoryKeys(rows: readonly ZenRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'transfer' || r.categoryPath.length === 0) continue;
    for (let depth = 1; depth <= r.categoryPath.length; depth++) {
      keys.add(categoryKey(r.kind, r.categoryPath.slice(0, depth)));
    }
  }
  return keys;
}

const BATCH = 500;

async function inBatches<T>(items: readonly T[], make: (item: T) => Promise<string>): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map(make))));
  }
  return out;
}

export async function computeIds(userId: string, parsed: ParsedFile): Promise<PlanIds> {
  const tx = await inBatches(parsed.rows, (r) => defaultId(userId, r.idKey));
  const accounts = [...collectAccounts(parsed.rows).keys()];
  const walletIds = await inBatches(accounts, (k) => defaultId(userId, walletSlug(k)));
  const cats = [...collectCategoryKeys(parsed.rows)];
  const catIds = await inBatches(cats, (k) => defaultId(userId, categorySlug(k)));
  return {
    tx,
    wallets: new Map(accounts.map((k, i) => [k, walletIds[i]!])),
    categories: new Map(cats.map((k, i) => [k, catIds[i]!])),
  };
}
