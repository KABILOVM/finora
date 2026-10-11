import type { Category, Debt, LocalRow, Minor, TxKind, UUID, Wallet } from '@/domain/types';
import { ValidationError } from './errors';
import { getLiveCategory, getLiveWallet, type RepoContext } from './repoContext';
import { TRANSFER_CREATES_MONEY_TEXT, transferCreatesMoney } from './validate';

/**
 * Проверки «против базы», общие для операций и регулярных платежей: кошельки, категория, долг.
 * Правила одни и те же — регулярный платёж не должен принимать то, что запретила бы сама операция.
 */

export function checkCategoryKind(cat: Category, kind: TxKind): void {
  if (cat.kind !== kind) {
    throw new ValidationError(
      `Категория «${cat.name}» не подходит: она для ${cat.kind === 'expense' ? 'расходов' : 'доходов'}`,
    );
  }
}

interface WalletRefs {
  walletId: UUID;
  toWalletId: UUID | null;
}

/** Кошельки: живые; в архиве — нельзя выбрать заново (а прежний выбор у существующей записи остаётся). */
export async function loadWallets(
  ctx: RepoContext,
  f: WalletRefs,
  prev?: WalletRefs,
): Promise<{ wallet: LocalRow<Wallet>; toWallet: LocalRow<Wallet> | null }> {
  const wallet = await getLiveWallet(ctx, f.walletId, 'Кошелёк');
  if (wallet.archivedAt !== null && prev?.walletId !== f.walletId) {
    throw new ValidationError(`Кошелёк «${wallet.name}» в архиве: выберите другой или верните его из архива`);
  }
  let toWallet: LocalRow<Wallet> | null = null;
  if (f.toWalletId !== null) {
    toWallet = await getLiveWallet(ctx, f.toWalletId, 'Кошелёк зачисления');
    if (toWallet.archivedAt !== null && prev?.toWalletId !== f.toWalletId) {
      throw new ValidationError(`Кошелёк «${toWallet.name}» в архиве: выберите другой или верните его из архива`);
    }
  }
  return { wallet, toWallet };
}

export async function checkCategoryOf(ctx: RepoContext, f: { kind: TxKind; categoryId: UUID | null }): Promise<void> {
  if (f.categoryId === null) return;
  checkCategoryKind(await getLiveCategory(ctx, f.categoryId), f.kind);
}

/**
 * Долг операции/платежа: существует и жив; в архиве — нельзя выбрать заново; валюта кошелька = валюте долга
 * (иначе остаток долга нельзя посчитать). Закрытый долг выбрать можно: платёж мог прийти уже после закрытия.
 */
export async function checkDebtLink(
  ctx: RepoContext,
  f: { debtId: UUID | null },
  wallet: Pick<Wallet, 'currency' | 'name'>,
  prev?: { debtId: UUID | null },
): Promise<LocalRow<Debt> | null> {
  if (f.debtId === null) return null;
  const debt = await ctx.db.debts.get(f.debtId);
  if (!debt) throw new ValidationError('Долг не найден');
  if (debt.deletedAt !== null) throw new ValidationError(`Долг «${debt.counterparty}» удалён`);
  if (debt.archivedAt !== null && prev?.debtId !== f.debtId) {
    throw new ValidationError(`Долг «${debt.counterparty}» в архиве: верните его из архива или выберите другой`);
  }
  if (debt.currency !== wallet.currency) {
    throw new ValidationError(
      `Валюта кошелька «${wallet.name}» (${wallet.currency}) не совпадает с валютой долга «${debt.counterparty}» (${debt.currency})`,
    );
  }
  return debt;
}

/** Перевод в одной валюте не может зачислить больше, чем списал (см. transferCreatesMoney). */
export function checkTransferAmounts(
  f: { kind: TxKind; amountMinor: Minor; toAmountMinor: Minor | null },
  wallet: Pick<Wallet, 'currency'>,
  toWallet: Pick<Wallet, 'currency'> | null,
): void {
  if (f.kind !== 'transfer' || toWallet === null) return;
  if (transferCreatesMoney(wallet.currency, toWallet.currency, f.amountMinor, f.toAmountMinor)) {
    throw new ValidationError(TRANSFER_CREATES_MONEY_TEXT);
  }
}
