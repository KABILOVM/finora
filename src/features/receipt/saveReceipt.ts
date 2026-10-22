import { newId, type Store } from '@/db';
import type { ReceiptCheck, ReceiptDraft } from '@/features/receipt/receiptAi';
import { matchByName } from '@/domain/expensesAi';
import type { LocalRow, Transaction } from '@/domain/types';
import { suggestColor, suggestGlyph } from '@/features/categories/suggestGlyph';
import { NOTE_MAX } from '@/features/transactions/txForm';

export interface SaveReceiptContext {
  store: Pick<Store, 'db' | 'shopping' | 'transactions' | 'categories'>;
  walletId: string;
  /** Названия и id существующих категорий расходов (в том числе только что созданных): общий список, чтобы повтор не плодил дубли. */
  categories: { id: string; name: string }[];
  /** Номера расходов по ключу группы: повтор после сбоя не создаст дубль. */
  txIds: Map<string, string>;
}

/** Заметка расхода: магазин (или «Чек»); при нескольких группах — с названием категории, чтобы расходы одного чека различались. */
export function receiptNote(merchant: string, categoryName: string | null): string {
  const head = merchant.trim() === '' ? 'Чек' : merchant.trim();
  return (categoryName !== null && categoryName !== '' ? `${head} · ${categoryName}` : head).slice(0, NOTE_MAX);
}

/**
 * Записывает чек: на каждую категорию — один расход с позициями этой категории в «Чеке». Новые категории создаются один раз и
 * переиспользуются. Расходы и позиции пишутся ОДНОЙ транзакцией базы: не получилось что-то одно — не записано ничего (категории,
 * созданные до этого, остаются: они безвредны и повтор их подхватит). Повтор с теми же номерами ничего не задваивает.
 */
export async function saveReceipt(draft: ReceiptDraft, check: ReceiptCheck, ctx: SaveReceiptContext): Promise<LocalRow<Transaction>[]> {
  const { store } = ctx;
  const several = check.groups.length > 1;
  // категории — до общей транзакции: у репозитория категорий своя запись
  const resolved: { key: string; categoryId: string | null; name: string }[] = [];
  for (const g of check.groups) {
    let categoryId: string | null = g.categoryId || null;
    let name = categoryId ? (ctx.categories.find((c) => c.id === categoryId)?.name ?? '') : '';
    if (!categoryId && g.newCategory !== '') {
      const existing = matchByName(g.newCategory, ctx.categories);
      if (existing && existing.name.toLocaleLowerCase('ru') === g.newCategory.toLocaleLowerCase('ru')) {
        categoryId = existing.id;
        name = existing.name;
      } else {
        const made = await store.categories.create({ name: g.newCategory, kind: 'expense', icon: suggestGlyph(g.newCategory), color: suggestColor(ctx.categories.length) });
        ctx.categories.push({ id: made.id, name: made.name });
        categoryId = made.id;
        name = made.name;
      }
    }
    resolved.push({ key: g.key, categoryId, name });
  }
  const { db } = store;
  return db.transaction('rw', [db.shopping_items, db.transactions, db.wallets, db.categories, db.settings, db.debts, db.recurring_rules, db.meta], async () => {
    const out: LocalRow<Transaction>[] = [];
    for (const [i, g] of check.groups.entries()) {
      const r = resolved[i]!;
      let txId = ctx.txIds.get(g.key);
      if (!txId) ctx.txIds.set(g.key, (txId = newId()));
      const res = await store.shopping.recordReceipt({
        walletId: ctx.walletId,
        categoryId: r.categoryId,
        occurredOn: draft.date,
        note: receiptNote(draft.merchant, several ? (r.name !== '' ? r.name : 'Без категории') : null),
        txId,
        lines: g.lines.map((l) => ({ name: l.name, qtyMilli: l.qtyMilli, unit: l.unit, priceMinor: l.priceMinor })),
      });
      out.push(res.transaction);
    }
    return out;
  });
}

/** Отмена: расходы чека убираются (мягко). */
export async function undoReceipt(store: Pick<Store, 'transactions'>, transactions: readonly LocalRow<Transaction>[]): Promise<void> {
  for (const t of transactions) await store.transactions.softDelete(t.id);
}
