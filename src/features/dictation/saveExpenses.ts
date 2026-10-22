import type { Store } from '@/db';
import { checkDraft, type DraftExpense } from '@/domain/expensesAi';
import type { CurrencyCode, LocalRow, Wallet } from '@/domain/types';
import { suggestColor, suggestGlyph } from '@/features/categories/suggestGlyph';
import { fxSourceOf, NOTE_MAX } from '@/features/transactions/txForm';
import { newId } from '@/db';
import type { RateLookup } from '@/rates/types';
import { matchByName } from '@/domain/expensesAi';
import { humanError } from '@/features/transactions/txActions';
import { withTag } from '@/features/trips/trips';

export interface SaveContext {
  store: Pick<Store, 'transactions' | 'categories'>;
  wallets: readonly LocalRow<Wallet>[];
  /** Названия и id существующих категорий расходов (в том числе только что созданных). */
  categories: { id: string; name: string }[];
  /** То же для категорий доходов. */
  incomeCategories?: { id: string; name: string }[];
  base: CurrencyCode;
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null;
  /** Номера операций по номеру строки: повтор после сбоя не создаст дубль. */
  txIds: Map<number, string>;
  /** Метка начатой поездки: дописывается в заметку каждой операции (trips.ts). */
  tripTag?: string | null;
}

/** Текст заметки операции: название, заметка, комиссия (сумма расхода или списания по переводу уже включает комиссию). */
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
    const to = d.kind === 'transfer' ? ctx.wallets.find((x) => x.id === d.toWalletId) : undefined;
    const c = checkDraft(d, w?.currency, to?.currency);
    if (c.error) errors.set(d.rid, c.error);
    // у перевода курс нужен только для комиссии (её переводят в основную валюту); без комиссии курс не требуется
    else if (w && w.currency !== ctx.base && (d.kind !== 'transfer' || c.feeMinor > 0) && !ctx.getRate(w.currency, ctx.base))
      errors.set(d.rid, `Нет курса ${w.currency} → ${ctx.base}: выберите другой счёт или обновите курсы в настройках`);
  }
  return errors;
}

export interface SaveResult {
  saved: number[];
  failed?: { rid: number; message: string };
}

/**
 * Сохраняет строки по порядку как обычные операции (расход, доход или перевод). Остановка на первой ошибке: уже сохранённые остаются (их номера в saved),
 * остальные можно повторить. Новые категории создаются один раз и переиспользуются.
 */
export async function saveExpenses(drafts: readonly DraftExpense[], ctx: SaveContext): Promise<SaveResult> {
  const saved: number[] = [];
  for (const d of drafts) {
    try {
      const wallet = ctx.wallets.find((x) => x.id === d.walletId)!;
      const check = checkDraft(d, wallet.currency, d.kind === 'transfer' ? ctx.wallets.find((x) => x.id === d.toWalletId)?.currency : undefined);
      const lookup = wallet.currency === ctx.base ? null : ctx.getRate(wallet.currency, ctx.base);
      let id = ctx.txIds.get(d.rid);
      if (!id) ctx.txIds.set(d.rid, (id = newId()));
      if (d.kind === 'transfer') {
        // списано сумма + комиссия, получено сумма: разница — комиссия (в одной валюте; между валютами перевод не принимается)
        await ctx.store.transactions.create(
          {
            kind: 'transfer',
            walletId: wallet.id,
            toWalletId: d.toWalletId,
            amountMinor: check.totalMinor!,
            toAmountMinor: check.receivedMinor!,
            occurredOn: d.date,
            note: withTag(noteOf(d, d.feeText.trim()), ctx.tripTag ?? null),
            ...(lookup && check.feeMinor > 0 ? { fx: { rate: lookup.rate, source: fxSourceOf(lookup) } } : {}),
          },
          { id },
        );
        saved.push(d.rid);
        continue;
      }
      const kind = d.kind === 'income' ? 'income' : 'expense';
      const known = kind === 'income' ? (ctx.incomeCategories ?? (ctx.incomeCategories = [])) : ctx.categories;
      let categoryId: string | null = d.categoryId || null;
      if (!categoryId && d.newCategory !== '') {
        const existing = matchByName(d.newCategory, known);
        if (existing && existing.name.toLocaleLowerCase('ru') === d.newCategory.toLocaleLowerCase('ru')) categoryId = existing.id;
        else {
          const made = await ctx.store.categories.create({
            name: d.newCategory,
            kind,
            icon: suggestGlyph(d.newCategory),
            color: suggestColor(known.length),
          });
          known.push({ id: made.id, name: made.name });
          categoryId = made.id;
        }
      }
      await ctx.store.transactions.create(
        {
          kind,
          walletId: wallet.id,
          amountMinor: check.totalMinor!,
          categoryId,
          occurredOn: d.date,
          note: withTag(noteOf(d, kind === 'income' ? '' : d.feeText.trim()), ctx.tripTag ?? null),
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
