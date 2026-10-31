import type { CurrencyCode, IsoDate, LocalRow, Minor, UUID, Wallet, WalletKind } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import {
  cleanPatch,
  getLiveWallet,
  nextSortOrder,
  sameFields,
  touch,
  withDirtyGroups,
  writeTx,
  type RepoContext,
} from './repoContext';
import { parseWalletData, reqId, type WalletData } from './validate';

export interface WalletInput {
  name: string;
  currency: CurrencyCode;
  kind: WalletKind;
  openingBalanceMinor: Minor;
  color: string;
  icon: string;
  /** Цель накопления: сумма и срок. null (или не задано) — цели нет; в правке null очищает цель. */
  goalMinor?: Minor | null;
  goalOn?: IsoDate | null;
}

export type WalletPatch = Partial<WalletInput & { sortOrder: number }>;

export interface WalletsRepo {
  /** opts.id — только для затравки (детерминированный id); обычные записи получают случайный. */
  create(input: WalletInput, opts?: { id?: UUID }): Promise<LocalRow<Wallet>>;
  update(id: UUID, patch: WalletPatch): Promise<LocalRow<Wallet>>;
  /** В архив (скрыть из выбора). Операции и остаток сохраняются. Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<Wallet>>;
  restore(id: UUID): Promise<LocalRow<Wallet>>;
  /**
   * Валюта кошелька закреплена: по нему есть операции (даже удалённые) или регулярные платежи. Одно правило для хранилища
   * и для формы, чтобы форма не разрешала то, что хранилище потом откажет.
   */
  isCurrencyLocked(id: UUID): Promise<boolean>;
}

const INPUT_KEYS = ['name', 'currency', 'kind', 'openingBalanceMinor', 'color', 'icon', 'goalMinor', 'goalOn'] as const;
const PATCH_KEYS = [...INPUT_KEYS, 'sortOrder'] as const;
const DATA_KEYS: readonly (keyof WalletData)[] = [
  'name',
  'currency',
  'kind',
  'openingBalanceMinor',
  'color',
  'icon',
  'sortOrder',
  'archivedAt',
  'goalMinor',
  'goalOn',
];

function dataOf(w: Wallet): WalletData {
  return {
    name: w.name,
    currency: w.currency,
    kind: w.kind,
    openingBalanceMinor: w.openingBalanceMinor,
    color: w.color,
    icon: w.icon,
    sortOrder: w.sortOrder,
    archivedAt: w.archivedAt,
    // строки, записанные до появления цели, хранят undefined: без ?? null пустая правка пометила бы кошелёк изменённым
    goalMinor: w.goalMinor ?? null,
    goalOn: w.goalOn ?? null,
  };
}

export function createWalletsRepo(ctx: RepoContext): WalletsRepo {
  const { db } = ctx;

  /** Любая операция (даже удалённая) по кошельку закрепляет его валюту: иначе при восстановлении операции суммы поменяют смысл. */
  async function currencyLocked(walletId: UUID): Promise<boolean> {
    if ((await db.transactions.where('walletId').equals(walletId).count()) > 0) return true;
    if ((await db.transactions.where('toWalletId').equals(walletId).count()) > 0) return true;
    // регулярный платёж тоже закрепляет валюту: его сумма задана в валюте кошелька
    return (await db.recurring_rules.filter((r) => r.deletedAt === null && (r.walletId === walletId || r.toWalletId === walletId)).count()) > 0;
  }

  async function save(id: UUID, change: (w: LocalRow<Wallet>) => WalletData): Promise<LocalRow<Wallet>> {
    return writeTx(ctx, [db.wallets, db.transactions, db.recurring_rules, db.savings_goals], async () => {
      const cur = await getLiveWallet(ctx, id);
      const next = change(cur);
      if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
      // кошелёк, к которому привязана цель накопления («Бюджеты»), обязан остаться накоплением в той же валюте
      if (next.kind !== cur.kind || next.currency !== cur.currency) {
        const goal = await db.savings_goals
          .where('walletId')
          .equals(id)
          .filter((g) => g.deletedAt === null && g.archivedAt === null)
          .first();
        if (goal && (next.kind !== 'savings' || next.currency !== goal.currency)) {
          throw new ValidationError(`Кошелёк «${cur.name}» привязан к цели «${goal.name}»: нельзя менять его вид или валюту. Сначала отвяжите цель в «Бюджетах».`);
        }
      }
      if (next.currency !== cur.currency && (await currencyLocked(id))) {
        throw new ValidationError(
          `Нельзя менять валюту кошелька «${cur.name}»: по нему уже есть операции или регулярные платежи. Заведите новый кошелёк.`,
        );
      }
      const row = withDirtyGroups<LocalRow<Wallet>>('wallets', cur, { ...cur, ...next, ...touch(ctx).fields });
      await db.wallets.put(row);
      return row;
    });
  }

  return {
    async create(input, opts) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Кошелёк');
      const id = opts?.id;
      if (id !== undefined) reqId(id, 'Кошелёк: id');
      return writeTx(ctx, [db.wallets], async () => {
        const data = parseWalletData({ ...clean, sortOrder: await nextSortOrder(db.wallets), archivedAt: null });
        const newRowId = id ?? newId();
        if (id !== undefined && (await db.wallets.get(newRowId))) {
          throw new ValidationError('Кошелёк с таким id уже существует');
        }
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<Wallet> = {
          id: newRowId,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создана здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.wallets.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, PATCH_KEYS, 'Кошелёк');
      return save(id, (cur) => parseWalletData({ ...dataOf(cur), ...clean }));
    },

    async archive(id) {
      return save(id, (cur) => (cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() }));
    },

    async restore(id) {
      return save(id, (cur) => ({ ...dataOf(cur), archivedAt: null }));
    },

    isCurrencyLocked: currencyLocked,
  };
}
