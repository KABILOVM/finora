import type { Store } from '@/db';
import { checkDraft, type DraftExpense } from '@/domain/expensesAi';
import type { CurrencyCode, LocalRow, Wallet } from '@/domain/types';
import { suggestColor, suggestGlyph } from '@/features/categories/suggestGlyph';
import { fxSourceOf, NOTE_MAX } from '@/features/transactions/txForm';
import { newId } from '@/db';
import type { RateLookup } from '@/rates/types';
import { matchByName } from '@/domain/expensesAi';
import { humanError } from '@/features/transactions/txActions';

export interface SaveContext {
  store: Pick<Store, 'transactions' | 'categories'>;
  wallets: readonly LocalRow<Wallet>[];
  /** Названия и id существующих категорий расходов (в том числе только что созданных). */
  categories: { id: string; name: string }[];
  base: CurrencyCode;
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null;
  /** Номера операций по номеру строки: повтор после сбоя не создаст дубль. */
  txIds: Map<number, string>;
}

/** Текст заметки операции: название, заметка, комиссия (сумма расхода уже включает комиссию). */
export function noteOf(d: DraftExpense, feeText: string): string {
  const head = [d.title, d.note].filter((x) => x !== '').join(' — ');
  const tail = feeText !== '' ? `комиссия ${feeText}` : '';
  return [head, tail !== '' && head !== '' ? `(${tail})` : tail].filter((x) => x !== '').join(' ').slice(0, NOTE_MAX);
}

/** Ошибки всех строк БЕЗ записи (rid → текст). Пусто — можно сохранять. */
export function validateAll(drafts: readonly DraftExpense[], ctx: Pick<SaveContext, 'wallets' | 'base' | 'getRate'>): Map<number, string> {
  const errors = new Map<number, string>();
  for (const d of drafts) {
    const w = ctx.wallets.find((x) => x.id === d.walletId);
    const c = checkDraft(d, w?.currency);
    if (c.error) errors.set(d.rid, c.error);
    else if (w && w.currency !== ctx.base && !ctx.getRate(w.currency, ctx.base))
      errors.set(d.rid, `Нет курса ${w.currency} → ${ctx.base}: выберите другой счёт или обновите курсы в настройках`);
  }
  return errors;
}

export interface SaveResult {
  saved: number[];
  failed?: { rid: number; message: string };
}

/**
 * Сохраняет строки по порядку как обычные расходы. Остановка на первой ошибке: уже сохранённые остаются (их номера в saved),
 * остальные можно повторить. Новые категории создаются один раз и переиспользуются.
 */
export async function saveExpenses(drafts: readonly DraftExpense[], ctx: SaveContext): Promise<SaveResult> {
  const saved: number[] = [];
  for (const d of drafts) {
    try {
      const wallet = ctx.wallets.find((x) => x.id === d.walletId)!;
      const check = checkDraft(d, wallet.currency);
      let categoryId: string | null = d.categoryId || null;
      if (!categoryId && d.newCategory !== '') {
        const existing = matchByName(d.newCategory, ctx.categories);
        if (existing && existing.name.toLocaleLowerCase('ru') === d.newCategory.toLocaleLowerCase('ru')) categoryId = existing.id;
        else {
          const made = await ctx.store.categories.create({
            name: d.newCategory,
            kind: 'expense',
            icon: suggestGlyph(d.newCategory),
            color: suggestColor(ctx.categories.length),
          });
          ctx.categories.push({ id: made.id, name: made.name });
          categoryId = made.id;
        }
      }
      const lookup = wallet.currency === ctx.base ? null : ctx.getRate(wallet.currency, ctx.base);
      let id = ctx.txIds.get(d.rid);
      if (!id) ctx.txIds.set(d.rid, (id = newId()));
      await ctx.store.transactions.create(
        {
          kind: 'expense',
          walletId: wallet.id,
          amountMinor: check.totalMinor!,
          categoryId,
          occurredOn: d.date,
          note: noteOf(d, d.feeText.trim()),
          ...(lookup ? { fx: { rate: lookup.rate, source: fxSourceOf(lookup) } } : {}),
        },
        { id },
      );
      saved.push(d.rid);
    } catch (e) {
      console.error('Не удалось сохранить расход из диктовки:', e);
      return { saved, failed: { rid: d.rid, message: humanError(e, 'Не удалось сохранить. Попробуйте ещё раз.') } };
    }
  }
  return { saved };
}
