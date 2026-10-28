import { DEBT_OVERFLOW_MESSAGE, newId, ValidationError, type DebtInput, type DebtPatch, type Store } from '@/db';
import { isLivePlanOf, issueKind, paymentKind } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Debt, DebtDirection, IsoDate, LocalRow, Minor, RecurringRule, Transaction, UUID } from '@/domain/types';
import { debtEntryLines, planEntryAdjustment } from './debtEditMoney';
import { ruDateShort } from './debtText';

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

export interface DebtEditPlan {
  debtId: UUID;
  /** Только то, что человек изменил. */
  patch: DebtPatch;
  /** Двигать ли деньги вслед за изменением суммы долга (сумма не менялась — не имеет значения). */
  money: boolean;
  /** Выдачи деньгами у долга нет («на бумаге»), а сумма выросла: на эту операцию уходит разница. Есть выдача — не используется. */
  newEntry?: IssueMovement & { occurredOn: IsoDate };
}

export interface DebtEditResult {
  debt: LocalRow<Debt>;
  /** Остаток какого-нибудь кошелька изменился. */
  moved: boolean;
}

/**
 * Правка долга. Изменилась сумма — деньги идут за ней (если money): выросла — растёт последняя выдача (или, если выдачи деньгами
 * не было, записывается новая на разницу), уменьшилась — деньги возвращаются с последней выдачи, а если её не хватает, то и с прежних.
 * Вся правка — ОДНОЙ транзакцией базы: не получилось подстроить операцию (кошелёк в архиве, нет курса…) — откатывается и сумма долга.
 * Идемпотентность новой выдачи: операция с таким id уже есть — повтор её не дублирует.
 */
export async function saveDebtEdit(store: Store, plan: DebtEditPlan): Promise<DebtEditResult> {
  const { db } = store;
  // ВАЖНО: внутри транзакции нельзя ждать ничего, кроме базы (crypto и т.п.) — она закроется. Все id уже готовы.
  return db.transaction(
    'rw',
    [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta],
    async (): Promise<DebtEditResult> => {
      const before = await db.debts.get(plan.debtId);
      if (!before) throw new ValidationError('Долг не найден');
      // Считаем от долга, как он лежит в базе: пока шит был открыт, синхронизация могла принести чужую правку суммы
      const delta = plan.patch.principalMinor === undefined ? 0 : plan.patch.principalMinor - before.principalMinor;
      const follow = plan.money && delta !== 0;
      let entries: ReturnType<typeof debtEntryLines> = [];
      if (follow) {
        const [txs, wallets] = await Promise.all([db.transactions.where('debtId').equals(before.id).toArray(), db.wallets.toArray()]);
        try {
          entries = debtEntryLines(before, txs, wallets);
        } catch (e) {
          if (e instanceof RangeError) throw new ValidationError(DEBT_OVERFLOW_MESSAGE);
          throw e;
        }
      }
      const debt = Object.keys(plan.patch).length > 0 ? await store.debts.update(plan.debtId, plan.patch) : before;
      if (!follow) return { debt, moved: false };

      const adjustment = planEntryAdjustment(entries, delta);
      for (const step of adjustment.steps) {
        if (step.toMinor === 0) await store.transactions.softDelete(step.txId);
        else await store.transactions.update(step.txId, { amountMinor: step.toMinor });
      }
      if (entries.length > 0 || delta < 0 || !plan.newEntry) return { debt, moved: adjustment.steps.length > 0 };

      const { walletId, txId, occurredOn, fx } = plan.newEntry;
      if (!(await db.transactions.get(txId))) {
        await store.transactions.create(
          {
            kind: issueKind(debt.direction),
            walletId,
            amountMinor: delta,
            categoryId: null,
            occurredOn,
            note: '',
            debtId: debt.id,
            ...(fx ? { fx } : {}),
          },
          { id: txId },
        );
      }
      return { debt, moved: true };
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

export interface TopUpPlan {
  debtId: UUID;
  direction: DebtDirection;
  amountMinor: Minor;
  occurredOn: IsoDate;
  /** Заметка к операции выдачи/получения (при «на бумаге» записать её некуда). */
  note: string;
  /** Новый срок возврата; undefined — не менять. */
  dueOn?: IsoDate | null;
  /** null — «на бумаге»: сумма долга растёт, деньги в кошельках не двигаются. */
  movement: IssueMovement | null;
  /** Продлить действующий план «Платить частями» до этой даты: долг вырос, а план без этого закончился бы раньше, чем долг. */
  extendPlan?: { ruleId: UUID; endOn: IsoDate };
}

/** Строка для заметки долга при пополнении «на бумаге»: у такого пополнения нет операции, и без неё в истории не осталось бы следа. */
export function topUpJournalLine(currency: CurrencyCode, plan: Pick<TopUpPlan, 'amountMinor' | 'occurredOn' | 'note'>): string {
  const note = plan.note.trim();
  return `+${formatMinor(plan.amountMinor, currency)} · ${ruDateShort(plan.occurredOn)}${note === '' ? '' : ` · ${note}`}`;
}

export interface TopUpResult {
  debt: LocalRow<Debt>;
  tx: LocalRow<Transaction> | null;
}

/**
 * «Добавить ещё в долг»: сумма долга растёт и (по желанию) создаётся операция выдачи/получения — ОДНОЙ транзакцией базы, как у
 * saveNewDebt: если операция не создалась (кошелёк в архиве, валюта не совпала, нет курса…), откатывается и рост суммы.
 * Идемпотентность: операция с таким id уже есть — повтор ничего не меняет и возвращает имеющееся. «На бумаге» id нет, там от
 * двойного нажатия защищает сам экран (busy).
 */
export async function saveTopUp(store: Store, plan: TopUpPlan): Promise<TopUpResult> {
  const { db } = store;
  // ВАЖНО: внутри транзакции нельзя ждать ничего, кроме базы (crypto и т.п.) — она закроется. Все id уже готовы.
  return db.transaction(
    'rw',
    [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta],
    async (): Promise<TopUpResult> => {
      if (plan.movement !== null) {
        const done = await db.transactions.get(plan.movement.txId);
        const debt = done ? await db.debts.get(plan.debtId) : undefined;
        if (done && debt) return { debt, tx: done };
      }
      // «на бумаге»: операции нет, поэтому сумма и заметка записываются в заметку самого долга
      const before = plan.movement === null ? await db.debts.get(plan.debtId) : undefined;
      const journal = before ? topUpJournalLine(before.currency, plan) : undefined;
      const debt = await store.debts.increase(plan.debtId, plan.amountMinor, {
        ...(plan.dueOn !== undefined ? { dueOn: plan.dueOn } : {}),
        ...(journal !== undefined ? { journal } : {}),
      });
      if (plan.extendPlan) await store.recurring.update(plan.extendPlan.ruleId, { endOn: plan.extendPlan.endOn });
      if (plan.movement === null) return { debt, tx: null };
      const tx = await store.transactions.create(
        {
          kind: issueKind(plan.direction),
          walletId: plan.movement.walletId,
          amountMinor: plan.amountMinor,
          categoryId: null,
          occurredOn: plan.occurredOn,
          note: plan.note.trim(),
          debtId: debt.id,
          ...(plan.movement.fx ? { fx: plan.movement.fx } : {}),
        },
        { id: plan.movement.txId },
      );
      return { debt, tx };
    },
  );
}

export interface NettingTxPlan {
  lentDebtId: UUID;
  borrowedDebtId: UUID;
  amountMinor: Minor;
  /** id платежа по долгу «мне должны» (доход) и по долгу «я должен» (расход): заранее, чтобы повтор не дал дубль. */
  lentTxId: UUID;
  borrowedTxId: UUID;
}

export interface NettingPlanInput {
  steps: readonly NettingTxPlan[];
  walletId: UUID;
  occurredOn: IsoDate;
  note: string;
  fx?: { rate: number; source: string };
}

export const NETTING_NOTE = 'Взаимозачёт';

/**
 * Взаимозачёт: для каждой пары долгов — два платежа на одну сумму в один кошелёк в один день: доход по долгу «мне должны» и расход по
 * долгу «я должен». Остаток кошелька не меняется, оба долга уменьшаются, история остаётся. ВСЕ платежи — одной транзакцией базы: если
 * хоть один не создался (кошелёк в архиве, валюта не совпала, нет курса…), не остаётся ни одного.
 * Идемпотентность: платёж с таким id уже есть — повтор ничего не меняет и возвращает имеющиеся.
 */
export async function saveNetting(store: Store, plan: NettingPlanInput): Promise<UUID[]> {
  const { db } = store;
  // ВАЖНО: внутри транзакции нельзя ждать ничего, кроме базы (crypto и т.п.) — она закроется. Все id уже готовы.
  return db.transaction(
    'rw',
    [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta],
    async (): Promise<UUID[]> => {
      const ids = plan.steps.flatMap((s) => [s.lentTxId, s.borrowedTxId]);
      const first = plan.steps[0];
      if (first && (await db.transactions.get(first.lentTxId))) return ids;
      const base = { walletId: plan.walletId, categoryId: null, occurredOn: plan.occurredOn, note: plan.note.trim(), ...(plan.fx ? { fx: plan.fx } : {}) };
      for (const s of plan.steps) {
        await store.transactions.create({ ...base, kind: paymentKind('lent'), amountMinor: s.amountMinor, debtId: s.lentDebtId }, { id: s.lentTxId });
        await store.transactions.create({ ...base, kind: paymentKind('borrowed'), amountMinor: s.amountMinor, debtId: s.borrowedDebtId }, { id: s.borrowedTxId });
      }
      return ids;
    },
  );
}

/** Отмена взаимозачёта: все его платежи убираются разом (мягкое удаление), остатки долгов возвращаются. */
export function undoNetting(store: Store, txIds: readonly UUID[]): Promise<void> {
  const { db } = store;
  return db.transaction('rw', [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta], async () => {
    for (const id of txIds) await store.transactions.softDelete(id);
  });
}

export interface PayInPartsPlan {
  debtId: UUID;
  direction: DebtDirection;
  counterparty: string;
  walletId: UUID;
  amountMinor: Minor;
  /** Дата первого платежа и последнего (правило после неё не срабатывает). */
  startOn: IsoDate;
  endOn: IsoDate;
  autoPost: boolean;
}

/**
 * «Платить частями»: регулярный платёж «раз в месяц» по долгу (для «мне должны» — доход, для «я должен» — расход), с датой окончания.
 * У долга один план: если живой план уже есть — ошибка (второй задвоил бы платежи). Повтор с тем же id безопасен.
 */
export function savePayInParts(store: Store, p: PayInPartsPlan, id: UUID): Promise<LocalRow<RecurringRule>> {
  const { db } = store;
  return db.transaction('rw', [db.debts, db.transactions, db.wallets, db.categories, db.settings, db.recurring_rules, db.meta], async () => {
    const debt = { id: p.debtId, direction: p.direction };
    const other = (await db.recurring_rules.toArray()).some((r) => r.id !== id && isLivePlanOf(r, debt));
    if (other) throw new ValidationError('У долга уже есть план платежей: измените его на странице долга');
    return createPlan(store, p, id);
  });
}

function createPlan(store: Store, p: PayInPartsPlan, id: UUID): Promise<LocalRow<RecurringRule>> {
  return store.recurring.create(
    {
      kind: paymentKind(p.direction),
      walletId: p.walletId,
      amountMinor: p.amountMinor,
      categoryId: null,
      debtId: p.debtId,
      note: `Долг: ${p.counterparty}`.slice(0, 200),
      frequency: 'monthly',
      intervalN: 1,
      startOn: p.startOn,
      endOn: p.endOn,
      autoPost: p.autoPost ? 1 : 0,
    },
    { id },
  );
}
