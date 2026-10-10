import { fxSnapshot } from '@/domain/money';
import type {
  Category,
  CurrencyCode,
  IsoDate,
  LocalRow,
  Minor,
  Transaction,
  TxKind,
  UUID,
  Wallet,
} from '@/domain/types';
import { FxRequiredError, ValidationError } from './errors';
import { isUuid, newId } from './ids';
import {
  cleanPatch,
  getLiveCategory,
  getLiveWallet,
  requireSettings,
  touch,
  writeTx,
  type RepoContext,
} from './repoContext';
import {
  BASE_AMOUNT_MAX,
  formatLimit,
  parseFx,
  parseTxFields,
  parseTxSnapshot,
  TRANSFER_CREATES_MONEY_TEXT,
  transferCreatesMoney,
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
  /** Курс валюты кошелька к базовой на момент операции. Обязателен, если валюта кошелька ≠ базовой. */
  fx?: { rate: number; source: string };
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

export interface TransactionsRepo {
  create(input: TransactionInput, opts?: TransactionCreateOptions): Promise<LocalRow<Transaction>>;
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
  };
}

function checkCategoryKind(cat: Category, kind: TxKind): void {
  if (cat.kind !== kind) {
    throw new ValidationError(
      `Категория «${cat.name}» не подходит: она для ${cat.kind === 'expense' ? 'расходов' : 'доходов'}`,
    );
  }
}

export function createTransactionsRepo(ctx: RepoContext): TransactionsRepo {
  const { db } = ctx;
  const scope = () => [db.transactions, db.wallets, db.categories, db.settings];

  /** Кошельки операции: живые; в архиве — нельзя выбрать заново (а прежний выбор у существующей операции остаётся). */
  async function loadWallets(f: TxFields, prev?: Transaction) {
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

  /** Были ли у существующего перевода кошельки одной валюты. Не удалось узнать (кошелька нет) — считаем, что нет. */
  async function wasSameCurrency(cur: Transaction): Promise<boolean> {
    if (cur.kind !== 'transfer' || cur.toWalletId === null) return false;
    const [from, to] = await Promise.all([db.wallets.get(cur.walletId), db.wallets.get(cur.toWalletId)]);
    return from !== undefined && to !== undefined && from.currency === to.currency;
  }

  async function checkCategory(f: TxFields): Promise<void> {
    if (f.categoryId === null) return;
    checkCategoryKind(await getLiveCategory(ctx, f.categoryId), f.kind);
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

  function buildSnapshot(
    f: TxFields,
    wallet: Wallet,
    baseCurrency: CurrencyCode,
    rate: { rate: number; source: string } | null,
  ): TxSnapshot {
    if (f.kind === 'transfer') return { baseCurrency, baseAmountMinor: 0, fxRate: null, fxSource: null };
    if (wallet.currency === baseCurrency) {
      return { baseCurrency, baseAmountMinor: f.amountMinor, fxRate: 1, fxSource: 'same' };
    }
    if (!rate) throw new FxRequiredError(wallet.currency, baseCurrency);
    let s: { baseAmountMinor: Minor; fxRate: number };
    try {
      s = fxSnapshot(f.amountMinor, wallet.currency, baseCurrency, rate.rate);
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
    return { baseCurrency, baseAmountMinor: s.baseAmountMinor, fxRate: s.fxRate, fxSource: rate.source };
  }

  /** Перевод в одной валюте не может зачислить больше, чем списал (см. transferCreatesMoney). */
  function checkTransferAmounts(f: TxFields, wallet: Wallet, toWallet: Wallet | null): void {
    if (f.kind !== 'transfer' || toWallet === null) return;
    if (transferCreatesMoney(wallet.currency, toWallet.currency, f.amountMinor, f.toAmountMinor)) {
      throw new ValidationError(TRANSFER_CREATES_MONEY_TEXT);
    }
  }

  function assemble(base: Transaction | null, f: TxFields, snap: TxSnapshot, givenId?: UUID): LocalRow<Transaction> {
    const { stamp, fields } = touch(ctx);
    const row: LocalRow<Transaction> = {
      id: base?.id ?? givenId ?? newId(),
      createdAt: base?.createdAt ?? stamp,
      deletedAt: base?.deletedAt ?? null,
      ...f,
      ...snap,
      ...fields,
      serverSeq: (base as LocalRow<Transaction> | null)?.serverSeq ?? null,
    };
    // последний рубеж: то, что уходит в базу, обязано пройти те же проверки, что и чужой файл
    parseTxFields(row as unknown as Record<string, unknown>, { requireToAmount: true });
    parseTxSnapshot(row.kind, row.amountMinor, row as unknown as Record<string, unknown>);
    return row;
  }

  async function mustGet(id: UUID): Promise<LocalRow<Transaction>> {
    const cur = await db.transactions.get(id);
    if (!cur) throw new ValidationError('Операция не найдена');
    return cur;
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
      return writeTx(ctx, scope(), async () => {
        if (givenId !== undefined) {
          // Идемпотентность: строка с этим id уже есть (живая или удалённая) — отдаём её, ничего не записывая.
          const existing = await db.transactions.get(givenId);
          if (existing) return existing;
        }
        const settings = await requireSettings(ctx);
        const { wallet, toWallet } = await loadWallets(fields);
        await checkCategory(fields);
        const f: TxFields = {
          ...fields,
          toAmountMinor: resolveToAmount(fields, wallet, toWallet, true),
        };
        checkTransferAmounts(f, wallet, toWallet);
        const row = assemble(null, f, buildSnapshot(f, wallet, settings.baseCurrency, fx ?? null), givenId);
        await db.transactions.add(row);
        return row;
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
          if (clean.kind === 'transfer') merged['categoryId'] = clean.categoryId ?? null;
          else {
            merged['toWalletId'] = clean.toWalletId ?? null;
            merged['toAmountMinor'] = clean.toAmountMinor ?? null;
          }
        }
        const fields = parseTxFields(merged);

        const { wallet, toWallet } = await loadWallets(fields, cur);
        await checkCategory(fields);
        const explicitTo = clean.toAmountMinor !== undefined && clean.toAmountMinor !== null;
        const f: TxFields = {
          ...fields,
          toAmountMinor: resolveToAmount(fields, wallet, toWallet, explicitTo, cur, await wasSameCurrency(cur)),
        };

        const amountChanged = f.amountMinor !== cur.amountMinor;
        const walletChanged = f.walletId !== cur.walletId;
        const kindChanged = f.kind !== cur.kind;
        let snap: TxSnapshot;
        if (!(amountChanged || walletChanged || kindChanged || fx !== undefined)) {
          snap = { baseCurrency: cur.baseCurrency, baseAmountMinor: cur.baseAmountMinor, fxRate: cur.fxRate, fxSource: cur.fxSource };
        } else {
          const settings = await requireSettings(ctx);
          // прежний курс годится, если базовая валюта и валюта кошелька те же, что при внесении
          let reuse: { rate: number; source: string } | null = null;
          if (cur.kind !== 'transfer' && cur.fxRate !== null && cur.fxSource !== null && cur.baseCurrency === settings.baseCurrency) {
            const oldWallet = await db.wallets.get(cur.walletId);
            if (oldWallet && oldWallet.currency === wallet.currency) reuse = { rate: cur.fxRate, source: cur.fxSource };
          }
          snap = buildSnapshot(f, wallet, settings.baseCurrency, fx ?? reuse);
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
        const row: LocalRow<Transaction> = { ...cur, deletedAt: stamp, ...fields };
        await db.transactions.put(row);
        return row;
      });
    },

    async restore(id) {
      return writeTx(ctx, scope(), async () => {
        const cur = await mustGet(id);
        if (cur.deletedAt === null) return cur;
        // всё, на что ссылается операция, должно существовать (архив не мешает: это не новая операция)
        const from = await getLiveWallet(ctx, cur.walletId, 'Кошелёк');
        if (cur.toWalletId !== null) {
          const to = await getLiveWallet(ctx, cur.toWalletId, 'Кошелёк зачисления');
          // не оживляем перевод, который в одной валюте зачислил больше, чем списал (старые данные)
          if (transferCreatesMoney(from.currency, to.currency, cur.amountMinor, cur.toAmountMinor)) {
            throw new ValidationError(TRANSFER_CREATES_MONEY_TEXT);
          }
        }
        if (cur.categoryId !== null) checkCategoryKind(await getLiveCategory(ctx, cur.categoryId), cur.kind);
        const row: LocalRow<Transaction> = { ...cur, deletedAt: null, ...touch(ctx).fields };
        await db.transactions.put(row);
        return row;
      });
    },
  };
}
