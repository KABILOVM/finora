import { computeDebtState, paymentKind } from '@/domain/debts';
import { fxSnapshot } from '@/domain/money';
import { isOccurrence } from '@/domain/schedule';
import type {
  CurrencyCode,
  IsoDate,
  LocalRow,
  Minor,
  RecurringRule,
  Transaction,
  TxKind,
  UUID,
  Wallet,
} from '@/domain/types';
import { DebtPlanStoppedError, FxRequiredError, ValidationError } from './errors';
import { isUuid, newId, uuidV5 } from './ids';
import {
  cleanPatch,
  getLiveCategory,
  requireSettings,
  touch,
  withDirtyGroups,
  writeTx,
  type RepoContext,
} from './repoContext';
import { checkCategoryKind, checkCategoryOf, checkDebtLink, checkTransferAmounts, loadWallets } from './txChecks';
import {
  BASE_AMOUNT_MAX,
  formatLimit,
  parseFx,
  parseTxFields,
  parseTxSnapshot,
  TRANSFER_CREATES_MONEY_TEXT,
  transferCreatesMoney,
  reqDate,
  type TxFields,
  type TxSnapshot,
} from './validate';

export interface TransactionInput {
  kind: TxKind;
  walletId: UUID;
  toWalletId?: UUID | null;
  amountMinor: Minor;
  toAmountMinor?: Minor | null;
  categoryId?: UUID | null;
  occurredOn: IsoDate;
  note?: string;
  /**
   * Курс валюты кошелька к базовой на момент операции. Обязателен, если валюта кошелька ≠ базовой; у перевода нужен только
   * для комиссии (перевод между кошельками одной небазовой валюты с суммой зачисления меньше суммы списания): ею оценивается
   * комиссия в базовой валюте. fxRate/fxSource у перевода при этом остаются пустыми.
   */
  fx?: { rate: number; source: string };
  /** Долг, к которому относится движение денег (только расход/доход; валюта кошелька = валюте долга). */
  debtId?: UUID | null;
  /**
   * Регулярный платёж, по которому создана операция. Тогда id операции ОБЯЗАН быть v5(ruleId, дата) и дата — из расписания
   * правила; без явного id он выводится сам. Обычно такие операции создаёт createFromRule.
   */
  recurringRuleId?: UUID | null;
}

export type TransactionPatch = Partial<TransactionInput>;

export interface TransactionCreateOptions {
  /**
   * Заранее выданный id операции (UUID; в верхнем регистре приводится к нижнему). Делает создание идемпотентным:
   * повторный вызов с тем же id (двойное нажатие «Сохранить», повтор после сбоя) не создаёт дубль, а возвращает
   * уже имеющуюся строку как есть. Даже если она удалена: повтор удалённую операцию не воскрешает.
   */
  id?: UUID;
}

/** Что можно поменять при создании операции по расписанию (подтверждение «в Предстоящих»). */
export interface FromRuleOptions {
  /** Другая сумма вместо суммы правила. У перевода при этом сумма зачисления считается заново, если не передана своя. */
  amountMinor?: Minor;
  toAmountMinor?: Minor | null;
  note?: string;
  fx?: { rate: number; source: string };
  /**
   * Платёж по долгу (правило того же вида, что «возврат долга»): не больше остатка. Долг закрыт или уже погашен — ошибка,
   * операция не пишется; последний платёж записывается на остаток, а не на полную сумму плана. Работает, только если сумма
   * не передана явно: своя сумма — сознательный выбор человека (в том числе переплата). Выдачи по расписанию не ограничиваются.
   * Два устройства без связи могут записать одну операцию (тот же id) с разной суммой — при обмене побеждает поздняя правка.
   */
  fitToDebt?: boolean;
  /**
   * Фактическая дата оплаты, если платёж проведён не в день по расписанию (просроченный платёж оплатили сегодня). Операция
   * записывается на неё, а id остаётся выведенным из ДАТЫ ПО РАСПИСАНИЮ (date): по нему платёж не проведут дважды и не предложат снова.
   */
  occurredOn?: IsoDate;
}

export interface TransactionsRepo {
  create(input: TransactionInput, opts?: TransactionCreateOptions): Promise<LocalRow<Transaction>>;
  /**
   * Операция по регулярному платежу за дату `date` ('ГГГГ-ММ-ДД'). id = v5(rule.id, date): повторный вызов (и вызов с другого
   * устройства) возвращает уже имеющуюся строку, а не дубль — живую или удалённую («пропущенную»). Дата обязана входить в расписание
   * правила, правило — быть живым и не в архиве (иначе ошибка). Правило читается из базы по id (переданный объект может устареть).
   */
  createFromRule(
    rule: Pick<RecurringRule, 'id'> | UUID,
    date: IsoDate,
    opts?: FromRuleOptions,
  ): Promise<LocalRow<Transaction>>;
  /**
   * «Пропустить» платёж за дату: создаёт операцию с тем же детерминированным id СРАЗУ удалённой (deletedAt) — другие устройства
   * увидят, что за эту дату платёж не нужен, и не проведут его. Уже пропущенная дата — вернёт имеющуюся строку; дата, за которую
   * платёж уже проведён (операция жива), — ошибка. Для кошелька в небазовой валюте нужен курс (fx), как для обычной операции.
   * note — своя заметка пропуска (иначе — из правила), например PLAN_PAID_NOTE.
   */
  skipOccurrence(
    rule: Pick<RecurringRule, 'id'> | UUID,
    date: IsoDate,
    opts?: { fx?: { rate: number; source: string }; note?: string },
  ): Promise<LocalRow<Transaction>>;
  /**
   * Снимок базовой валюты пересчитывается ТОЛЬКО при смене суммы/кошелька/вида или при новом fx.
   * Иначе сохраняется прежний курс: старая операция не переоценивается сегодняшним курсом.
   */
  update(id: UUID, patch: TransactionPatch): Promise<LocalRow<Transaction>>;
  /** Мягкое удаление (deletedAt). Повтор безопасен. */
  softDelete(id: UUID): Promise<LocalRow<Transaction>>;
  restore(id: UUID): Promise<LocalRow<Transaction>>;
}

const KEYS = [
  'kind',
  'walletId',
  'toWalletId',
  'amountMinor',
  'toAmountMinor',
  'categoryId',
  'occurredOn',
  'note',
  'fx',
  'debtId',
  'recurringRuleId',
] as const;

const COMPARED: readonly (keyof Transaction)[] = [
  'kind',
  'walletId',
  'toWalletId',
  'amountMinor',
  'toAmountMinor',
  'categoryId',
  'occurredOn',
  'note',
  'baseCurrency',
  'baseAmountMinor',
  'fxRate',
  'fxSource',
  'debtId',
];

function fieldsOf(t: Transaction): Record<string, unknown> {
  return {
    kind: t.kind,
    walletId: t.walletId,
    toWalletId: t.toWalletId,
    amountMinor: t.amountMinor,
    toAmountMinor: t.toAmountMinor,
    categoryId: t.categoryId,
    occurredOn: t.occurredOn,
    note: t.note,
    debtId: t.debtId ?? null,
    recurringRuleId: t.recurringRuleId ?? null,
  };
}

export function createTransactionsRepo(ctx: RepoContext): TransactionsRepo {
  const { db } = ctx;
  const scope = () => [db.transactions, db.wallets, db.categories, db.settings, db.debts, db.recurring_rules];
  type Fx = { rate: number; source: string };

  /** Были ли у существующего перевода кошельки одной валюты. Не удалось узнать (кошелька нет) — считаем, что нет. */
  async function wasSameCurrency(cur: Transaction): Promise<boolean> {
    if (cur.kind !== 'transfer' || cur.toWalletId === null) return false;
    const [from, to] = await Promise.all([db.wallets.get(cur.walletId), db.wallets.get(cur.toWalletId)]);
    return from !== undefined && to !== undefined && from.currency === to.currency;
  }

  /**
   * Сумма зачисления перевода. Явно переданная — как есть; иначе выводится из суммы списания, если это безопасно.
   * prevSameCurrency — была ли прежняя пара кошельков одновалютной (для правки существующего перевода).
   */
  function resolveToAmount(
    f: TxFields,
    wallet: Wallet,
    toWallet: Wallet | null,
    explicit: boolean,
    cur?: Transaction,
    prevSameCurrency = false,
  ): Minor | null {
    if (f.kind !== 'transfer' || toWallet === null) return null;
    if (explicit && f.toAmountMinor !== null) return f.toAmountMinor;
    const sameCurrency = wallet.currency === toWallet.currency;
    if (!cur || cur.kind !== 'transfer' || f.toAmountMinor === null) {
      if (sameCurrency) return f.amountMinor;
      throw new ValidationError('Укажите сумму зачисления: у кошельков разные валюты');
    }
    const changed =
      f.amountMinor !== cur.amountMinor || f.walletId !== cur.walletId || f.toWalletId !== cur.toWalletId;
    if (!changed) return f.toAmountMinor;
    if (sameCurrency) {
      // Разница сумм у перевода МЕЖДУ валютами — курс обмена, а не комиссия: в одновалютной паре она означала бы
      // деньги из воздуха (или пропажу). Осмысленная «комиссия» бывает только у пары, что и раньше была одновалютной.
      if (!prevSameCurrency) return f.amountMinor;
      return cur.toAmountMinor === cur.amountMinor ? f.amountMinor : f.toAmountMinor;
    }
    throw new ValidationError('Укажите сумму зачисления заново: сумма или кошельки перевода между валютами изменились');
  }

  /** Сумма в базовой валюте по курсу `rate`; слишком большая — понятная ошибка, а не RangeError/отказ сервера. */
  function toBase(amount: Minor, from: CurrencyCode, baseCurrency: CurrencyCode, rate: Fx): { baseAmountMinor: Minor; fxRate: number } {
    let s: { baseAmountMinor: Minor; fxRate: number };
    try {
      s = fxSnapshot(amount, from, baseCurrency, rate.rate);
    } catch (e) {
      if (e instanceof RangeError) throw new ValidationError('Сумма слишком велика для пересчёта в базовую валюту');
      throw e;
    }
    // граница сервера для суммы в базовой валюте (transactions.base_amount_minor ≤ 1e15)
    if (s.baseAmountMinor > BASE_AMOUNT_MAX) {
      throw new ValidationError(
        `Сумма слишком велика для пересчёта в базовую валюту: в ${baseCurrency} получилось бы больше ${formatLimit(BASE_AMOUNT_MAX)} минимальных единиц`,
      );
    }
    return s;
  }

  /**
   * Снимок базовой валюты. У расхода/дохода — сумма операции по курсу. У перевода baseAmountMinor — КОМИССИЯ в базовой валюте:
   * (списано − зачислено), если кошельки ОДНОЙ валюты и зачислено меньше; для обмена между валютами и без комиссии — 0.
   * Курс у перевода в операцию не пишется (fxRate/fxSource пусты): он нужен только чтобы оценить комиссию в небазовой валюте.
   */
  function buildSnapshot(f: TxFields, wallet: Wallet, toWallet: Wallet | null, baseCurrency: CurrencyCode, rate: Fx | null): TxSnapshot {
    if (f.kind === 'transfer') {
      const fee =
        toWallet !== null && f.toAmountMinor !== null && wallet.currency === toWallet.currency && f.toAmountMinor < f.amountMinor
          ? f.amountMinor - f.toAmountMinor
          : 0;
      if (fee === 0) return { baseCurrency, baseAmountMinor: 0, fxRate: null, fxSource: null };
      if (wallet.currency === baseCurrency) return { baseCurrency, baseAmountMinor: fee, fxRate: null, fxSource: null };
      if (!rate) throw new FxRequiredError(wallet.currency, baseCurrency);
      return { baseCurrency, baseAmountMinor: toBase(fee, wallet.currency, baseCurrency, rate).baseAmountMinor, fxRate: null, fxSource: null };
    }
    if (wallet.currency === baseCurrency) {
      return { baseCurrency, baseAmountMinor: f.amountMinor, fxRate: 1, fxSource: 'same' };
    }
    if (!rate) throw new FxRequiredError(wallet.currency, baseCurrency);
    const s = toBase(f.amountMinor, wallet.currency, baseCurrency, rate);
    return { baseCurrency, baseAmountMinor: s.baseAmountMinor, fxRate: s.fxRate, fxSource: rate.source };
  }

  function assemble(
    base: Transaction | null,
    f: TxFields,
    snap: TxSnapshot,
    givenId?: UUID,
    deleted = false,
  ): LocalRow<Transaction> {
    const { stamp, fields } = touch(ctx);
    const row: LocalRow<Transaction> = {
      id: base?.id ?? givenId ?? newId(),
      createdAt: base?.createdAt ?? stamp,
      deletedAt: base?.deletedAt ?? (deleted ? stamp : null),
      ...f,
      ...snap,
      ...fields,
      serverSeq: (base as LocalRow<Transaction> | null)?.serverSeq ?? null,
    };
    // последний рубеж: то, что уходит в базу, обязано пройти те же проверки, что и чужой файл
    parseTxFields(row as unknown as Record<string, unknown>, { requireToAmount: true });
    parseTxSnapshot(row.kind, row.amountMinor, row as unknown as Record<string, unknown>);
    // новая операция: dirtyGroups: [] — создана здесь, правки до первой отправки считаются от созданного (см. mergeGroups.ts)
    return base ? withDirtyGroups<LocalRow<Transaction>>('transactions', base as LocalRow<Transaction>, row) : { ...row, dirtyGroups: [] };
  }

  async function mustGet(id: UUID): Promise<LocalRow<Transaction>> {
    const cur = await db.transactions.get(id);
    if (!cur) throw new ValidationError('Операция не найдена');
    return cur;
  }

  /** Операция по расписанию: правило живо, не в архиве, а дата входит в его расписание. */
  async function checkRule(f: TxFields, scheduledOn: IsoDate = f.occurredOn): Promise<void> {
    if (f.recurringRuleId === null) return;
    const rule = await db.recurring_rules.get(f.recurringRuleId);
    if (!rule) throw new ValidationError('Регулярный платёж не найден');
    if (rule.deletedAt !== null) throw new ValidationError('Регулярный платёж удалён');
    if (rule.archivedAt !== null) throw new ValidationError('Регулярный платёж в архиве: верните его из архива');
    if (!isOccurrence(rule, scheduledOn)) {
      throw new ValidationError(`Дата ${scheduledOn} не входит в расписание регулярного платежа`);
    }
  }

  /** Новая строка со всеми проверками. Вызывать ТОЛЬКО внутри writeTx(scope()). */
  async function insertNew(
    fields: TxFields,
    fx: Fx | null,
    givenId: UUID | undefined,
    deleted: boolean,
    scheduledOn?: IsoDate,
  ): Promise<LocalRow<Transaction>> {
    const settings = await requireSettings(ctx);
    const { wallet, toWallet } = await loadWallets(ctx, fields);
    await checkCategoryOf(ctx, fields);
    await checkDebtLink(ctx, fields, wallet);
    await checkRule(fields, scheduledOn);
    const f: TxFields = { ...fields, toAmountMinor: resolveToAmount(fields, wallet, toWallet, true) };
    checkTransferAmounts(f, wallet, toWallet);
    const row = assemble(null, f, buildSnapshot(f, wallet, toWallet, settings.baseCurrency, fx), givenId, deleted);
    await db.transactions.add(row);
    return row;
  }

  /** id правила (UUID, строчными) из объекта или строки. */
  function ruleIdOf(rule: unknown): UUID {
    const id = typeof rule === 'string' ? rule : (rule as { id?: unknown } | null | undefined)?.id;
    if (!isUuid(id)) throw new ValidationError('Регулярный платёж: id должен быть в виде UUID');
    return id.toLowerCase();
  }

  /** Поля операции по правилу за дату (rule читается из базы — переданный объект мог устареть). Внутри writeTx. */
  async function fieldsFromRule(ruleId: UUID, date: IsoDate, over: { amountMinor?: unknown; toAmountMinor?: unknown; note?: unknown } = {}): Promise<TxFields> {
    const rule = await db.recurring_rules.get(ruleId);
    if (!rule) throw new ValidationError('Регулярный платёж не найден');
    const toAmountMinor =
      over.toAmountMinor !== undefined ? over.toAmountMinor : over.amountMinor !== undefined ? null : rule.toAmountMinor;
    return parseTxFields({
      kind: rule.kind,
      walletId: rule.walletId,
      toWalletId: rule.toWalletId,
      amountMinor: over.amountMinor ?? rule.amountMinor,
      toAmountMinor,
      categoryId: rule.categoryId,
      debtId: rule.debtId,
      note: over.note ?? rule.note,
      occurredOn: date,
      recurringRuleId: rule.id,
    });
  }

  /** fitToDebt: сумма платежа по долгу, если она меньше суммы правила (остаток долга); undefined — сумма из правила. Внутри writeTx. */
  async function debtFit(ruleId: UUID): Promise<Minor | undefined> {
    const rule = await db.recurring_rules.get(ruleId);
    if (!rule || rule.debtId === null) return undefined;
    const debt = await db.debts.get(rule.debtId);
    // нет долга, удалён или в архиве — понятную ошибку даст checkDebtLink
    if (!debt || debt.deletedAt !== null || rule.kind !== paymentKind(debt.direction)) return undefined;
    if (debt.closedAt !== null) throw new DebtPlanStoppedError(`Долг «${debt.counterparty}» закрыт: платёж не проведён`);
    const [txs, wallets] = await Promise.all([db.transactions.where('debtId').equals(debt.id).toArray(), db.wallets.toArray()]);
    let remainingMinor: Minor;
    try {
      remainingMinor = computeDebtState(debt, txs, wallets).remainingMinor;
    } catch (e) {
      // остаток не посчитать — сколько платить, неизвестно: не проводим, а говорим почему (не «непредвиденный сбой»)
      if (e instanceof RangeError) throw new ValidationError(`Суммы по долгу «${debt.counterparty}» слишком большие, проверьте данные`);
      throw e;
    }
    if (remainingMinor <= 0) throw new DebtPlanStoppedError(`Долг «${debt.counterparty}» уже погашен: платёж не проведён`);
    return remainingMinor < rule.amountMinor ? remainingMinor : undefined;
  }

  return {
    async create(input, opts) {
      const clean = cleanPatch(input, KEYS, 'Операция');
      let givenId: UUID | undefined;
      if (opts?.id !== undefined) {
        if (!isUuid(opts.id)) throw new ValidationError('Операция: id должен быть в виде UUID');
        givenId = opts.id.toLowerCase(); // Postgres вернёт UUID строчным: в базе он тоже должен быть строчным
      }
      const fx = clean.fx === undefined ? undefined : parseFx(clean.fx);
      const fields = parseTxFields(clean);
      if (fields.recurringRuleId !== null) {
        // операция по расписанию: id выводится из правила и даты — иначе два устройства провели бы один платёж дважды
        const expected = await uuidV5(ruleIdOf(fields.recurringRuleId), fields.occurredOn);
        if (givenId !== undefined && givenId !== expected) {
          throw new ValidationError('Операция по расписанию: id должен быть выведен из регулярного платежа и даты');
        }
        givenId = expected;
      }
      return writeTx(ctx, scope(), async () => {
        if (givenId !== undefined) {
          // Идемпотентность: строка с этим id уже есть (живая или удалённая) — отдаём её, ничего не записывая.
          const existing = await db.transactions.get(givenId);
          if (existing) return existing;
        }
        return insertNew(fields, fx ?? null, givenId, false);
      });
    },

    async createFromRule(rule, date, opts = {}) {
      const ruleId = ruleIdOf(rule);
      const day = reqDate(date, 'Дата платежа');
      const o = cleanPatch(opts, ['amountMinor', 'toAmountMinor', 'note', 'fx', 'fitToDebt', 'occurredOn'] as const, 'Операция по расписанию');
      const fx = o.fx === undefined ? undefined : parseFx(o.fx);
      const paidOn = o.occurredOn === undefined ? day : reqDate(o.occurredOn, 'Дата оплаты');
      const id = await uuidV5(ruleId, day);
      return writeTx(ctx, scope(), async () => {
        const existing = await db.transactions.get(id);
        if (existing) return existing;
        const fitted = o.fitToDebt === true && o.amountMinor === undefined ? await debtFit(ruleId) : undefined;
        return insertNew(
          await fieldsFromRule(ruleId, paidOn, fitted === undefined ? o : { ...o, amountMinor: fitted }),
          fx ?? null,
          id,
          false,
          day,
        );
      });
    },

    async skipOccurrence(rule, date, opts = {}) {
      const ruleId = ruleIdOf(rule);
      const day = reqDate(date, 'Дата платежа');
      const o = cleanPatch(opts, ['fx', 'note'] as const, 'Пропуск платежа');
      const fx = o.fx === undefined ? undefined : parseFx(o.fx);
      const id = await uuidV5(ruleId, day);
      return writeTx(ctx, scope(), async () => {
        const existing = await db.transactions.get(id);
        if (existing) {
          if (existing.deletedAt !== null) return existing; // уже пропущен (или проведён и удалён)
          throw new ValidationError('За эту дату платёж уже проведён: чтобы пропустить, удалите операцию');
        }
        return insertNew(await fieldsFromRule(ruleId, day, o.note === undefined ? {} : { note: o.note }), fx ?? null, id, true);
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, KEYS, 'Операция');
      const fx = clean.fx === undefined ? undefined : parseFx(clean.fx);
      return writeTx(ctx, scope(), async () => {
        const cur = await mustGet(id);
        if (cur.deletedAt !== null) throw new ValidationError('Операция удалена: сначала восстановите её');

        const merged: Record<string, unknown> = { ...fieldsOf(cur) };
        for (const [k, v] of Object.entries(clean)) if (k !== 'fx') merged[k] = v;
        if (clean.kind !== undefined && clean.kind !== cur.kind) {
          // поля, которых у нового вида быть не может, сбрасываются сами (если их не передали явно)
          if (clean.kind === 'transfer') {
            merged['categoryId'] = clean.categoryId ?? null;
            merged['debtId'] = clean.debtId ?? null;
          } else {
            merged['toWalletId'] = clean.toWalletId ?? null;
            merged['toAmountMinor'] = clean.toAmountMinor ?? null;
          }
        }
        const fields = parseTxFields(merged);
        if (fields.recurringRuleId !== (cur.recurringRuleId ?? null)) {
          throw new ValidationError('Связь операции с регулярным платежом менять нельзя');
        }
        // Операция по долгу с другим видом молча стала бы другим движением долга (выдача → платёж и наоборот).
        // Явно снятая связь (debtId: null) или перевод, сбрасывающий долг сам, — не смена вида операции по долгу.
        if (fields.debtId !== null && (cur.debtId ?? null) !== null && fields.kind !== cur.kind) {
          throw new ValidationError(
            'Вид операции по долгу менять нельзя: платёж и выдача считаются по-разному. Удалите операцию и запишите заново со страницы долга',
          );
        }

        const { wallet, toWallet } = await loadWallets(ctx, fields, cur);
        await checkCategoryOf(ctx, fields);
        const walletChanged = fields.walletId !== cur.walletId;
        const kindChanged = fields.kind !== cur.kind;
        if (fields.debtId !== null && (fields.debtId !== (cur.debtId ?? null) || walletChanged || kindChanged)) {
          await checkDebtLink(ctx, fields, wallet, { debtId: cur.debtId ?? null });
        }
        const explicitTo = clean.toAmountMinor !== undefined && clean.toAmountMinor !== null;
        const f: TxFields = {
          ...fields,
          toAmountMinor: resolveToAmount(fields, wallet, toWallet, explicitTo, cur, await wasSameCurrency(cur)),
        };

        const amountChanged = f.amountMinor !== cur.amountMinor;
        const transferChanged = f.kind === 'transfer' && (f.toAmountMinor !== cur.toAmountMinor || f.toWalletId !== cur.toWalletId);
        let snap: TxSnapshot;
        if (!(amountChanged || walletChanged || kindChanged || transferChanged || fx !== undefined)) {
          snap = { baseCurrency: cur.baseCurrency, baseAmountMinor: cur.baseAmountMinor, fxRate: cur.fxRate, fxSource: cur.fxSource };
        } else {
          const settings = await requireSettings(ctx);
          // прежний курс годится, если базовая валюта и валюта кошелька те же, что при внесении
          let reuse: Fx | null = null;
          if (cur.kind !== 'transfer' && cur.fxRate !== null && cur.fxSource !== null && cur.baseCurrency === settings.baseCurrency) {
            const oldWallet = await db.wallets.get(cur.walletId);
            if (oldWallet && oldWallet.currency === wallet.currency) reuse = { rate: cur.fxRate, source: cur.fxSource };
          }
          snap = buildSnapshot(f, wallet, toWallet, settings.baseCurrency, fx ?? reuse);
        }

        const probe = { ...cur, ...f, ...snap } as Transaction;
        if (COMPARED.every((k) => Object.is(probe[k], cur[k]))) return cur;
        checkTransferAmounts(f, wallet, toWallet);
        const row = assemble(cur, f, snap);
        await db.transactions.put(row);
        return row;
      });
    },

    async softDelete(id) {
      return writeTx(ctx, [db.transactions], async () => {
        const cur = await mustGet(id);
        if (cur.deletedAt !== null) return cur;
        const { stamp, fields } = touch(ctx);
        const row = withDirtyGroups<LocalRow<Transaction>>('transactions', cur, { ...cur, deletedAt: stamp, ...fields });
        await db.transactions.put(row);
        return row;
      });
    },

    async restore(id) {
      return writeTx(ctx, scope(), async () => {
        const cur = await mustGet(id);
        if (cur.deletedAt === null) return cur;
        // всё, на что ссылается операция, должно существовать (архив не мешает: это не новая операция)
        const { wallet: from, toWallet: to } = await loadWallets(ctx, cur, cur);
        if (to !== null) {
          // не оживляем перевод, который в одной валюте зачислил больше, чем списал (старые данные)
          if (transferCreatesMoney(from.currency, to.currency, cur.amountMinor, cur.toAmountMinor)) {
            throw new ValidationError(TRANSFER_CREATES_MONEY_TEXT);
          }
        }
        if (cur.categoryId !== null) checkCategoryKind(await getLiveCategory(ctx, cur.categoryId), cur.kind);
        if (cur.debtId) {
          const debt = await db.debts.get(cur.debtId);
          if (!debt || debt.deletedAt !== null) throw new ValidationError('Долг этой операции удалён: восстановить операцию нельзя');
        }
        const row = withDirtyGroups<LocalRow<Transaction>>('transactions', cur, { ...cur, deletedAt: null, ...touch(ctx).fields });
        await db.transactions.put(row);
        return row;
      });
    },
  };
}
