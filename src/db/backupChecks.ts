import type { Budget, Category, Debt, LocalRow, RecurringRule, Transaction, Wallet } from '@/domain/types';
import type { BackupFile } from './backupSchema';
import { fail } from './errors';
import { TRANSFER_CREATES_MONEY_TEXT, transferCreatesMoney } from './validate';

/**
 * Проверки импорта, которые смотрят на итоговое состояние базы (после слияния): бюджеты, долги и регулярные платежи
 * не должны сделать то, что запретили бы репозитории. Все функции бросают ValidationError с русским текстом и ничего не пишут.
 */

type Index<T> = ReadonlyMap<string, T>;

export interface PlanState {
  wallets: Index<LocalRow<Wallet>>;
  categories: Index<LocalRow<Category>>;
  debts: Index<LocalRow<Debt>>;
  rules: Index<LocalRow<RecurringRule>>;
}

export interface PlanWinners {
  debts: ReadonlySet<string>;
  rules: ReadonlySet<string>;
  budgets: ReadonlySet<string>;
}

/** Ссылки бюджетов и регулярных платежей: на что указывают, то существует и подходит по виду/валюте. */
export function checkPlanRefs(file: BackupFile, st: PlanState, winners: PlanWinners): void {
  for (const bud of file.budgets as Budget[]) {
    if (bud.categoryId === null) continue;
    const cat = st.categories.get(bud.categoryId);
    if (!cat) fail('Резервная копия: бюджет ссылается на несуществующую категорию');
    if (bud.deletedAt === null && cat.deletedAt === null && cat.kind !== 'expense' && winners.budgets.has(bud.id)) {
      fail(`Резервная копия: бюджет поставлен на категорию «${cat.name}», а она для доходов`);
    }
  }
  for (const rule of file.recurringRules) {
    const wallet = st.wallets.get(rule.walletId);
    const toWallet = rule.toWalletId === null ? null : st.wallets.get(rule.toWalletId);
    if (!wallet || toWallet === undefined) fail('Резервная копия: регулярный платёж ссылается на несуществующий кошелёк');
    if (rule.categoryId !== null) {
      const cat = st.categories.get(rule.categoryId);
      if (!cat) fail('Резервная копия: регулярный платёж ссылается на несуществующую категорию');
      if (rule.deletedAt === null && cat.deletedAt === null && cat.kind !== rule.kind && winners.rules.has(rule.id)) {
        fail(`Резервная копия: категория «${cat.name}» не подходит к виду регулярного платежа`);
      }
    }
    const debt = rule.debtId === null ? null : st.debts.get(rule.debtId);
    if (debt === undefined) fail('Резервная копия: регулярный платёж ссылается на несуществующий долг');
    if (!winners.rules.has(rule.id) || rule.deletedAt !== null) continue;
    if (debt && debt.currency !== wallet.currency) {
      fail(`Резервная копия: валюта кошелька регулярного платежа не совпадает с валютой долга «${debt.counterparty}»`);
    }
    if (toWallet && transferCreatesMoney(wallet.currency, toWallet.currency, rule.amountMinor, rule.toAmountMinor)) {
      fail(`Резервная копия, регулярный платёж: ${TRANSFER_CREATES_MONEY_TEXT}`);
    }
  }
}

/**
 * Копия не меняет направление и валюту долга, по которому на этом устройстве уже есть операции или регулярные платежи
 * (как и репозиторий: суммы поменяли бы смысл). `before` — состояние долгов ДО слияния.
 */
export function checkDebtPins(
  before: ReadonlyMap<string, Pick<Debt, 'direction' | 'currency'>>,
  after: Index<LocalRow<Debt>>,
  debtWinners: ReadonlySet<string>,
  txs: Index<LocalRow<Transaction>>,
  txWinners: ReadonlySet<string>,
  rules: Index<LocalRow<RecurringRule>>,
  ruleWinners: ReadonlySet<string>,
): void {
  for (const id of debtWinners) {
    const was = before.get(id);
    const now = after.get(id);
    if (!was || !now || (was.direction === now.direction && was.currency === now.currency)) continue;
    const pinnedByTx = [...txs.values()].some((t) => t.debtId === id && !txWinners.has(t.id));
    const pinnedByRule = [...rules.values()].some((r) => r.debtId === id && r.deletedAt === null && !ruleWinners.has(r.id));
    if (pinnedByTx || pinnedByRule) {
      fail(`Резервная копия меняет направление или валюту долга «${now.counterparty}», а по нему на этом устройстве уже есть операции — импорт отменён`);
    }
  }
}

/** Живая операция из файла по долгу — в валюте этого долга (как и в репозитории). */
export function checkDebtCurrencies(
  txs: Index<LocalRow<Transaction>>,
  winners: ReadonlySet<string>,
  wallets: Index<LocalRow<Wallet>>,
  debts: Index<LocalRow<Debt>>,
): void {
  for (const t of txs.values()) {
    if (!winners.has(t.id) || t.deletedAt !== null || t.debtId === null) continue;
    const debt = debts.get(t.debtId);
    const wallet = wallets.get(t.walletId);
    if (debt && wallet && debt.currency !== wallet.currency) {
      fail(`Резервная копия, операция от ${t.occurredOn}: валюта кошелька не совпадает с валютой долга «${debt.counterparty}»`);
    }
  }
}

/**
 * Комиссия перевода бывает только между кошельками одной валюты (обмен валют — без комиссии).
 * Если эта валюта — базовая операции, комиссия в точности «списано − зачислено»: иначе файл рисует несуществующие расходы.
 * (Для небазовой валюты сумма зависит от курса, и проверить её без курса нельзя.)
 */
export function checkTransferFees(
  txs: Index<LocalRow<Transaction>>,
  winners: ReadonlySet<string>,
  wallets: Index<LocalRow<Wallet>>,
): void {
  for (const t of txs.values()) {
    if (!winners.has(t.id) || t.kind !== 'transfer' || t.baseAmountMinor === 0 || t.toWalletId === null) continue;
    const from = wallets.get(t.walletId);
    const to = wallets.get(t.toWalletId);
    if (from && to && from.currency !== to.currency) {
      fail(`Резервная копия, перевод от ${t.occurredOn}: у обмена между валютами не бывает комиссии`);
    }
    if (from && to && from.currency === t.baseCurrency && t.toAmountMinor !== null && t.baseAmountMinor !== t.amountMinor - t.toAmountMinor) {
      fail(`Резервная копия, перевод от ${t.occurredOn}: комиссия не равна разнице «списано − зачислено»`);
    }
  }
}
