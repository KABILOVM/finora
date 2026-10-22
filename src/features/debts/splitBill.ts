import { COUNTERPARTY_MAX, newId, type Store } from '@/db';
import { normName } from '@/domain/names';
import type { CurrencyCode, Debt, IsoDate, LocalRow, Minor, Transaction, UUID } from '@/domain/types';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { saveNewDebt } from './debtActions';
import { cleanName } from './debtForm';

/**
 * «Разделить счёт»: заплатили за всех, а друзья должны свои доли. Одним действием: ваша доля — обычный расход (с категорией), а за каждого
 * друга — долг «мне должны» на его долю с выдачей денег из того же кошелька (в расходы такая выдача не входит). Делится поровну на вас и
 * друзей; копейки, которые не делятся, остаются на вас. Чистые расчёты и проверка — здесь, запись в базу — saveSplitBill.
 */

/** Сколько друзей можно добавить в один счёт. */
export const MAX_FRIENDS = 9;

export interface Split {
  /** Доля каждого друга. */
  shareMinor: Minor;
  /** Ваша доля: всё, что не разделилось поровну, остаётся на вас. */
  mineMinor: Minor;
}

/** Поровну на вас и `friends` друзей. friends ≥ 1 и сумма ≥ friends + 1 — иначе у кого-то доля вышла бы нулевой. */
export function splitEven(totalMinor: Minor, friends: number): Split {
  const parts = friends + 1;
  const shareMinor = Math.floor(totalMinor / parts);
  return { shareMinor, mineMinor: totalMinor - shareMinor * friends };
}

export interface SplitForm {
  totalMinor: Minor | null;
  /** Имена друзей как набраны (пустые строки отсекаются проверкой). */
  names: readonly string[];
  note: string;
}

export interface SplitErrors {
  amount?: string;
  /** По одной ошибке на имя (null — имя в порядке). */
  names?: (string | null)[];
  note?: string;
  form?: string;
}

export interface SplitValue extends Split {
  totalMinor: Minor;
  /** Имена друзей: без лишних пробелов, по порядку. */
  names: string[];
  note: string;
}

export function validateSplit(f: SplitForm): { errors: SplitErrors; value: SplitValue | null } {
  const errors: SplitErrors = {};
  const names = f.names.map(cleanName);
  if (names.length === 0) errors.form = 'Добавьте хотя бы одного человека, с кем делите счёт';
  if (names.length > MAX_FRIENDS) errors.form = `Не больше ${MAX_FRIENDS} человек`;

  const seen = new Set<string>();
  const nameErrors = names.map((n): string | null => {
    if (n === '') return 'Введите имя';
    if (n.length > COUNTERPARTY_MAX) return `Имя не длиннее ${COUNTERPARTY_MAX} символов`;
    const key = normName(n);
    if (seen.has(key)) return 'Это имя уже есть: двух одинаковых людей в счёте быть не может';
    seen.add(key);
    return null;
  });
  if (nameErrors.some((e) => e !== null)) errors.names = nameErrors;

  if (f.totalMinor === null) errors.amount = 'Введите сумму счёта';
  else if (f.totalMinor <= 0) errors.amount = 'Сумма счёта должна быть больше нуля';
  else if (names.length > 0 && f.totalMinor < names.length + 1) errors.amount = 'Сумма слишком мала, чтобы разделить её на всех';

  const note = f.note.trim();
  if (note.length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов`;

  if (Object.keys(errors).length > 0 || f.totalMinor === null) return { errors, value: null };
  return { errors, value: { ...splitEven(f.totalMinor, names.length), totalMinor: f.totalMinor, names, note } };
}

export interface SplitPlan {
  walletId: UUID;
  /** Валюта кошелька (долги заводятся в ней). */
  currency: CurrencyCode;
  categoryId: UUID | null;
  occurredOn: IsoDate;
  value: SplitValue;
  fx?: { rate: number; source: string };
}

/** id для попытки сохранения: держатся, пока окно открыто, и повтор (двойное нажатие, повтор после ошибки) не создаёт дублей. */
export interface SplitIds {
  expenseTxId: UUID;
  friends: { debtId: UUID; txId: UUID }[];
}

export const freshSplitIds = (friends: number): SplitIds => ({
  expenseTxId: newId(),
  friends: Array.from({ length: friends }, () => ({ debtId: newId(), txId: newId() })),
});

export interface SplitResult {
  expense: LocalRow<Transaction>;
  debts: LocalRow<Debt>[];
}

/** Подпись долга и выдачи: «Счёт: ужин». */
export const debtNote = (note: string): string => (note.trim() === '' ? 'Счёт на всех' : `Счёт: ${note.trim()}`);

/**
 * Записывает всё ОДНОЙ транзакцией базы: ваш расход и по долгу «мне должны» (с выдачей денег из кошелька) за каждого друга. Не получилось
 * что-то одно (кошелёк в архиве, нет курса…) — откатывается всё. Идемпотентно по заранее заданным id.
 */
export async function saveSplitBill(store: Store, plan: SplitPlan, ids: SplitIds): Promise<SplitResult> {
  const { db } = store;
  const { value } = plan;
  return db.transaction('rw', [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta], async (): Promise<SplitResult> => {
    const expense =
      (await db.transactions.get(ids.expenseTxId)) ??
      (await store.transactions.create(
        {
          kind: 'expense',
          walletId: plan.walletId,
          amountMinor: value.mineMinor,
          categoryId: plan.categoryId,
          occurredOn: plan.occurredOn,
          note: value.note,
          ...(plan.fx ? { fx: plan.fx } : {}),
        },
        { id: ids.expenseTxId },
      ));
    const debts: LocalRow<Debt>[] = [];
    for (const [i, name] of value.names.entries()) {
      const id = ids.friends[i];
      if (!id) throw new Error('Не хватает идентификаторов для записи');
      const res = await saveNewDebt(store, {
        debtId: id.debtId,
        debt: {
          direction: 'lent',
          counterparty: name,
          principalMinor: value.shareMinor,
          currency: plan.currency,
          openedOn: plan.occurredOn,
          dueOn: null,
          note: debtNote(value.note),
        },
        movement: { walletId: plan.walletId, txId: id.txId, ...(plan.fx ? { fx: plan.fx } : {}) },
      });
      debts.push(res.debt);
    }
    return { expense, debts };
  });
}

/** Отмена: расход и все долги вместе с их выдачами убираются (мягко: «Вернуть» из корзины не нужен, всё это один шаг). */
export async function undoSplitBill(store: Store, result: SplitResult): Promise<void> {
  await store.db.transaction('rw', [store.db.debts, store.db.transactions, store.db.recurring_rules, store.db.meta], async () => {
    await store.transactions.softDelete(result.expense.id);
    for (const d of result.debts) await store.debts.softDelete(d.id, 'with-operations');
  });
}
