import { newId, type DebtInput, type Store } from '@/db';
import { issueKind, paymentKind } from '@/domain/debts';
import type { Debt, DebtDirection, IsoDate, LocalRow, Minor, Transaction, UUID } from '@/domain/types';

/** Движение денег, которое сопровождает новый долг: исходная операция (выдача/получение). */
export interface IssueMovement {
  walletId: UUID;
  txId: UUID;
  /** Курс кошелька к основной валюте (нужен, если кошелёк не в основной валюте). */
  fx?: { rate: number; source: string };
}

export interface NewDebtPlan {
  debtId: UUID;
  debt: DebtInput;
  /** null — долг «на бумаге»: деньги в кошельках не двигаются. */
  movement: IssueMovement | null;
}

export interface NewDebtResult {
  debt: LocalRow<Debt>;
  tx: LocalRow<Transaction> | null;
}

/** Новые id для попытки сохранения: держатся, пока шит открыт, и поэтому повтор (двойное нажатие, повтор после ошибки) не создаёт дубль. */
export function freshPlanIds(): { debtId: UUID; txId: UUID } {
  return { debtId: newId(), txId: newId() };
}

/**
 * Сохраняет долг и (по желанию) исходную операцию ОДНОЙ транзакцией базы: либо оба, либо ничего.
 * Репозитории внутри внешней транзакции присоединяются к ней (так же, как в затравке), поэтому если операция не создалась
 * (кошелёк в архиве, валюта не совпала, не хватает курса…), откатывается и долг — «наполовину» сохранённого не бывает.
 * Идемпотентность: id долга и операции заданы заранее. Долг с таким id уже есть — повторно не создаётся, операция тоже
 * (повтор вернёт имеющиеся строки). Все проверки репозиториев (валюта кошелька = валюте долга, курс, даты) выполняются
 * до записи любой строки, поэтому ошибка — ValidationError с текстом для человека.
 */
export async function saveNewDebt(store: Store, plan: NewDebtPlan): Promise<NewDebtResult> {
  const { db } = store;
  // ВАЖНО: внутри транзакции нельзя ждать ничего, кроме базы (crypto и т.п.) — она закроется. Все id уже готовы.
  return db.transaction(
    'rw',
    [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta],
    async (): Promise<NewDebtResult> => {
      const existing = await db.debts.get(plan.debtId);
      const debt = existing ?? (await store.debts.create(plan.debt, { id: plan.debtId }));
      if (plan.movement === null) return { debt, tx: null };
      const { direction, principalMinor, openedOn } = plan.debt;
      const tx = await store.transactions.create(
        {
          kind: issueKind(direction),
          walletId: plan.movement.walletId,
          amountMinor: principalMinor,
          categoryId: null,
          occurredOn: openedOn,
          note: '',
          debtId: debt.id,
          ...(plan.movement.fx ? { fx: plan.movement.fx } : {}),
        },
        { id: plan.movement.txId },
      );
      return { debt, tx };
    },
  );
}

export interface PaymentPlan {
  debtId: UUID;
  direction: DebtDirection;
  txId: UUID;
  walletId: UUID;
  amountMinor: Minor;
  occurredOn: IsoDate;
  note: string;
  fx?: { rate: number; source: string };
}

/**
 * Платёж по долгу: для «мне должны» — доход, для «я должен» — расход, без категории, с debtId.
 * Валюту кошелька проверяет репозиторий (она обязана совпасть с валютой долга). id заранее — двойное нажатие дубля не даст.
 */
export function savePayment(store: Store, p: PaymentPlan): Promise<LocalRow<Transaction>> {
  return store.transactions.create(
    {
      kind: paymentKind(p.direction),
      walletId: p.walletId,
      amountMinor: p.amountMinor,
      categoryId: null,
      occurredOn: p.occurredOn,
      note: p.note.trim(),
      debtId: p.debtId,
      ...(p.fx ? { fx: p.fx } : {}),
    },
    { id: p.txId },
  );
}
