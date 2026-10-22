import { sumMinor } from '@/domain/money';
import type { IsoDate, LocalRow, Minor, ShoppingItem, ShoppingUnit, Transaction, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import { cleanPatch, getLiveCategory, getLiveWallet, requireSettings, sameFields, touch, withDirtyGroups, writeTx, type RepoContext } from './repoContext';
import type { TransactionsRepo } from './transactionsRepo';
import { reqDate, reqId, reqPositiveMinor, reqText, LIMITS } from './validate';
import { parseShoppingData, type ShoppingData } from './validatePlans';

export interface ShoppingInput {
  name: string;
  /** Количество в тысячных долях единицы: 1400 = 1,4 кг. */
  qtyMilli: number;
  unit: ShoppingUnit;
}

export type ShoppingPatch = Partial<ShoppingInput>;

export interface PurchaseInput {
  walletId: UUID;
  categoryId: UUID | null;
  /** Дата расхода; по умолчанию — сегодня (её передаёт экран). */
  occurredOn: IsoDate;
  note?: string;
  /** Заранее выданный id расхода: двойное нажатие не создаст второй расход. */
  txId?: UUID;
}

/** Позиция чека, внесённого по фото или вручную (уже куплена, цена — за всю позицию). */
export interface ReceiptLineInput {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  /** Цена позиции целиком (после скидки), ≥ 0. */
  priceMinor: Minor;
}

export interface ReceiptInput {
  walletId: UUID;
  categoryId: UUID | null;
  occurredOn: IsoDate;
  note?: string;
  /** Заранее выданный id расхода: повтор (двойное нажатие, повтор после сбоя) не создаст второй расход. */
  txId?: UUID;
  lines: readonly ReceiptLineInput[];
}

export interface PurchaseResult {
  transaction: LocalRow<Transaction>;
  items: LocalRow<ShoppingItem>[];
}

export interface ShoppingRepo {
  add(input: ShoppingInput, opts?: { id?: UUID }): Promise<LocalRow<ShoppingItem>>;
  /** Название, количество и единицу можно менять, пока позиция не куплена. */
  update(id: UUID, patch: ShoppingPatch): Promise<LocalRow<ShoppingItem>>;
  /** Положить в корзину с ценой, вписанной в магазине (за всю позицию, ≥ 0). Повторный вызов меняет цену. */
  check(id: UUID, priceMinor: Minor): Promise<LocalRow<ShoppingItem>>;
  /** Достать из корзины: цена стирается. Повтор безопасен. */
  uncheck(id: UUID): Promise<LocalRow<ShoppingItem>>;
  /** Мягкое удаление не купленной позиции. Повтор безопасен. */
  remove(id: UUID): Promise<LocalRow<ShoppingItem>>;
  /** Вернуть удалённую (не купленную) позицию. */
  restore(id: UUID): Promise<LocalRow<ShoppingItem>>;
  /**
   * Подтвердить покупку: ОДИН расход на сумму всех отмеченных позиций (в базовой валюте, кошелёк той же валюты), позиции
   * помечаются купленными и входят в «чек» этого расхода. Всё одной транзакцией базы: либо всё, либо ничего.
   */
  purchase(input: PurchaseInput): Promise<PurchaseResult>;
  /**
   * Внести чек целиком: ОДИН расход на сумму позиций и сами позиции как купленные (они видны в «Чеке» расхода и пополняют память цен).
   * В отличие от purchase позиции берутся не из списка покупок, а из входа. Кошелёк в основной валюте. Одной транзакцией базы:
   * либо расход и все позиции, либо ничего. Повтор с тем же txId возвращает уже созданное.
   */
  recordReceipt(input: ReceiptInput): Promise<PurchaseResult>;
}

const INPUT_KEYS = ['name', 'qtyMilli', 'unit'] as const;
const PURCHASE_KEYS = ['walletId', 'categoryId', 'occurredOn', 'note', 'txId'] as const;
const RECEIPT_KEYS = ['walletId', 'categoryId', 'occurredOn', 'note', 'txId', 'lines'] as const;
const LINE_KEYS = ['name', 'qtyMilli', 'unit', 'priceMinor'] as const;
const DATA_KEYS: readonly (keyof ShoppingData)[] = ['name', 'qtyMilli', 'unit', 'priceMinor', 'checkedAt', 'purchasedAt', 'transactionId'];

const dataOf = (i: ShoppingItem): ShoppingData => ({
  name: i.name,
  qtyMilli: i.qtyMilli,
  unit: i.unit,
  priceMinor: i.priceMinor,
  checkedAt: i.checkedAt,
  purchasedAt: i.purchasedAt,
  transactionId: i.transactionId,
});

/** Максимум позиций в одном чеке — чтобы заметка и запись остались небольшими. */
export const MAX_RECEIPT_ITEMS = 500;

export function createShoppingRepo(ctx: RepoContext, transactions: TransactionsRepo): ShoppingRepo {
  const { db } = ctx;
  const scope = () => [db.shopping_items, db.transactions, db.wallets, db.categories, db.settings, db.debts, db.recurring_rules];

  async function getItem(id: UUID): Promise<LocalRow<ShoppingItem>> {
    const it = await db.shopping_items.get(id);
    if (!it) throw new ValidationError('Позиция не найдена');
    return it;
  }

  async function getActive(id: UUID): Promise<LocalRow<ShoppingItem>> {
    const it = await getItem(id);
    if (it.deletedAt !== null) throw new ValidationError(`Позиция «${it.name}» удалена`);
    if (it.purchasedAt !== null) throw new ValidationError(`Позиция «${it.name}» уже куплена: её нельзя менять`);
    return it;
  }

  async function save(
    id: UUID,
    change: (it: LocalRow<ShoppingItem>) => ShoppingData,
    opts: { deleted?: boolean | undefined; allowDeleted?: boolean } = {},
  ): Promise<LocalRow<ShoppingItem>> {
    return writeTx(ctx, [db.shopping_items], async () => {
      const cur = opts.allowDeleted ? await getItem(id) : await getActive(id);
      if (opts.allowDeleted && cur.purchasedAt !== null) throw new ValidationError(`Позиция «${cur.name}» уже куплена: её нельзя менять`);
      const next = change(cur);
      const deletedAt = opts.deleted === undefined ? cur.deletedAt : opts.deleted ? ctx.clock.tick() : null;
      if (sameFields(dataOf(cur), next, DATA_KEYS) && deletedAt === cur.deletedAt) return cur;
      const row = withDirtyGroups<LocalRow<ShoppingItem>>('shopping_items', cur, { ...cur, ...next, deletedAt, ...touch(ctx).fields });
      await db.shopping_items.put(row);
      return row;
    });
  }

  return {
    async add(input, opts) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Позиция');
      if (opts?.id !== undefined) reqId(opts.id, 'Позиция: id');
      const data = parseShoppingData({ ...clean, priceMinor: null, checkedAt: null, purchasedAt: null, transactionId: null });
      return writeTx(ctx, [db.shopping_items], async () => {
        const id = opts?.id ?? newId();
        const existing = await db.shopping_items.get(id);
        if (existing) return existing; // повтор с тем же id (двойное нажатие) — не дубль
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<ShoppingItem> = {
          id,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [],
        };
        await db.shopping_items.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, INPUT_KEYS, 'Позиция');
      return save(id, (cur) => parseShoppingData({ ...dataOf(cur), ...clean }));
    },

    async check(id, priceMinor) {
      const price = Number.isSafeInteger(priceMinor) ? priceMinor : NaN;
      return save(id, (cur) => parseShoppingData({ ...dataOf(cur), priceMinor: price, checkedAt: cur.checkedAt ?? ctx.clock.tick() }));
    },

    async uncheck(id) {
      return save(id, (cur) => parseShoppingData({ ...dataOf(cur), priceMinor: null, checkedAt: null }));
    },

    async remove(id) {
      const cur = await db.shopping_items.get(id);
      if (cur && cur.deletedAt !== null && cur.purchasedAt === null) return cur;
      return save(id, (c) => dataOf(c), { deleted: true });
    },

    async restore(id) {
      return save(id, (c) => dataOf(c), { deleted: false, allowDeleted: true });
    },

    async purchase(input) {
      const clean = cleanPatch(input, PURCHASE_KEYS, 'Покупка') as Partial<PurchaseInput>;
      const walletId = reqId(clean.walletId, 'Кошелёк');
      const categoryId = clean.categoryId === null || clean.categoryId === undefined ? null : reqId(clean.categoryId, 'Категория');
      const occurredOn = reqDate(clean.occurredOn, 'Дата покупки');
      const note = clean.note === undefined ? 'Покупки' : reqText(clean.note, 'Заметка', LIMITS.note, 0);
      const txId = clean.txId === undefined ? newId() : reqId(clean.txId, 'Расход');
      return writeTx(ctx, scope(), async () => {
        const settings = await requireSettings(ctx);
        const wallet = await getLiveWallet(ctx, walletId);
        if (wallet.currency !== settings.baseCurrency) {
          throw new ValidationError(`Цены списка — в ${settings.baseCurrency}: выберите кошелёк в этой валюте`);
        }
        if (categoryId !== null) {
          const cat = await getLiveCategory(ctx, categoryId);
          if (cat.kind !== 'expense') throw new ValidationError('Для покупки нужна категория расходов');
        }
        // Двойное нажатие: расход с этим id уже есть — отдаём его вместе с уже купленными позициями, ничего не создавая заново
        const prior = await db.transactions.get(txId);
        if (prior) {
          const done = await db.shopping_items.where('transactionId').equals(txId).toArray();
          return { transaction: prior, items: done };
        }
        const checked = (await db.shopping_items.filter((i) => i.deletedAt === null && i.purchasedAt === null && i.checkedAt !== null).toArray()).sort(
          (a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1),
        );
        if (checked.length === 0) throw new ValidationError('В корзине пусто: отметьте купленные позиции');
        if (checked.length > MAX_RECEIPT_ITEMS) throw new ValidationError(`В одном чеке не больше ${MAX_RECEIPT_ITEMS} позиций`);
        let total: Minor;
        try {
          total = sumMinor(checked.map((i) => i.priceMinor as Minor));
        } catch {
          throw new ValidationError('Сумма покупки слишком велика');
        }
        reqPositiveMinor(total, 'Сумма покупки');
        const transaction = await transactions.create(
          { kind: 'expense', walletId, categoryId, amountMinor: total, occurredOn, note },
          { id: txId },
        );
        const stamp = ctx.clock.tick();
        const items: LocalRow<ShoppingItem>[] = [];
        for (const it of checked) {
          const { fields } = touch(ctx);
          const row = withDirtyGroups<LocalRow<ShoppingItem>>('shopping_items', it, { ...it, purchasedAt: stamp, transactionId: transaction.id, ...fields });
          items.push(row);
        }
        await db.shopping_items.bulkPut(items);
        return { transaction, items };
      });
    },

    async recordReceipt(input) {
      const clean = cleanPatch(input, RECEIPT_KEYS, 'Чек') as Partial<ReceiptInput>;
      const walletId = reqId(clean.walletId, 'Кошелёк');
      const categoryId = clean.categoryId === null || clean.categoryId === undefined ? null : reqId(clean.categoryId, 'Категория');
      const occurredOn = reqDate(clean.occurredOn, 'Дата чека');
      const note = clean.note === undefined ? 'Чек' : reqText(clean.note, 'Заметка', LIMITS.note, 0);
      const txId = clean.txId === undefined ? newId() : reqId(clean.txId, 'Расход');
      const rawLines = Array.isArray(clean.lines) ? (clean.lines as readonly unknown[]) : null;
      if (rawLines === null || rawLines.length === 0) throw new ValidationError('В чеке нет позиций');
      if (rawLines.length > MAX_RECEIPT_ITEMS) throw new ValidationError(`В одном чеке не больше ${MAX_RECEIPT_ITEMS} позиций`);
      const lines = rawLines.map((l) => {
        const c = cleanPatch((l ?? {}) as Record<string, unknown>, LINE_KEYS, 'Позиция чека');
        // проверки названия, количества, единицы и цены — те же, что у любой позиции
        return parseShoppingData({ ...c, checkedAt: '2000-01-01T00:00:00.000Z', purchasedAt: '2000-01-01T00:00:00.000Z', transactionId: txId });
      });
      return writeTx(ctx, scope(), async () => {
        const settings = await requireSettings(ctx);
        const wallet = await getLiveWallet(ctx, walletId);
        if (wallet.currency !== settings.baseCurrency) {
          throw new ValidationError(`Чек вносится в основной валюте: выберите кошелёк в ${settings.baseCurrency}`);
        }
        if (categoryId !== null) {
          const cat = await getLiveCategory(ctx, categoryId);
          if (cat.kind !== 'expense') throw new ValidationError('Для чека нужна категория расходов');
        }
        const prior = await db.transactions.get(txId);
        if (prior) {
          const done = await db.shopping_items.where('transactionId').equals(txId).toArray();
          return { transaction: prior, items: done };
        }
        let total: Minor;
        try {
          total = sumMinor(lines.map((l) => l.priceMinor as Minor));
        } catch {
          throw new ValidationError('Сумма чека слишком велика');
        }
        reqPositiveMinor(total, 'Сумма чека');
        const transaction = await transactions.create({ kind: 'expense', walletId, categoryId, amountMinor: total, occurredOn, note }, { id: txId });
        const stamp = ctx.clock.tick();
        const items: LocalRow<ShoppingItem>[] = lines.map((data) => {
          const { fields } = touch(ctx);
          return {
            id: newId(),
            createdAt: stamp,
            deletedAt: null,
            ...data,
            checkedAt: stamp,
            purchasedAt: stamp,
            transactionId: transaction.id,
            ...fields,
            serverSeq: null,
            dirtyGroups: [],
          };
        });
        await db.shopping_items.bulkAdd(items);
        return { transaction, items };
      });
    },
  };
}
