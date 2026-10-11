import type { CurrencyCode, Debt, DebtDirection, IsoDate, LocalRow, Minor, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import { cleanPatch, sameFields, touch, withDirtyGroups, writeTx, type RepoContext } from './repoContext';
import { reqId } from './validate';
import { parseDebtData, type DebtData } from './validatePlans';

export interface DebtInput {
  /** lent — мне должны (я дал); borrowed — я должен (мне дали). */
  direction: DebtDirection;
  counterparty: string;
  principalMinor: Minor;
  currency: CurrencyCode;
  openedOn: IsoDate;
  dueOn?: IsoDate | null;
  note?: string;
}

export type DebtPatch = Partial<DebtInput>;

export interface DebtsRepo {
  create(input: DebtInput, opts?: { id?: UUID }): Promise<LocalRow<Debt>>;
  /** Направление и валюту нельзя менять, когда по долгу уже есть операции или регулярные платежи: суммы поменяли бы смысл. */
  update(id: UUID, patch: DebtPatch): Promise<LocalRow<Debt>>;
  /** Долг закрыт (погашен или прощён). Остаток при этом не обнуляется — он считается из операций. Повтор безопасен. */
  close(id: UUID): Promise<LocalRow<Debt>>;
  reopen(id: UUID): Promise<LocalRow<Debt>>;
  /** В архив (скрыть из списков). Операции и остаток сохраняются. Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<Debt>>;
  restore(id: UUID): Promise<LocalRow<Debt>>;
}

const INPUT_KEYS = ['direction', 'counterparty', 'principalMinor', 'currency', 'openedOn', 'dueOn', 'note'] as const;
const DATA_KEYS: readonly (keyof DebtData)[] = [
  'direction',
  'counterparty',
  'principalMinor',
  'currency',
  'openedOn',
  'dueOn',
  'note',
  'closedAt',
  'archivedAt',
];

const dataOf = (d: Debt): DebtData => ({
  direction: d.direction,
  counterparty: d.counterparty,
  principalMinor: d.principalMinor,
  currency: d.currency,
  openedOn: d.openedOn,
  dueOn: d.dueOn,
  note: d.note,
  closedAt: d.closedAt,
  archivedAt: d.archivedAt,
});

function checkDates(d: DebtData): void {
  if (d.dueOn !== null && d.dueOn < d.openedOn) throw new ValidationError('Срок возврата не может быть раньше даты долга');
}

export function createDebtsRepo(ctx: RepoContext): DebtsRepo {
  const { db } = ctx;

  async function getLiveDebt(id: UUID): Promise<LocalRow<Debt>> {
    const d = await db.debts.get(id);
    if (!d) throw new ValidationError('Долг не найден');
    if (d.deletedAt !== null) throw new ValidationError(`Долг «${d.counterparty}» удалён`);
    return d;
  }

  /** Любая операция (даже удалённая) и любой живой регулярный платёж закрепляют направление и валюту долга. */
  async function hasLinks(id: UUID): Promise<boolean> {
    if ((await db.transactions.where('debtId').equals(id).count()) > 0) return true;
    return (await db.recurring_rules.filter((r) => r.debtId === id && r.deletedAt === null).count()) > 0;
  }

  async function save(id: UUID, change: (d: LocalRow<Debt>) => DebtData): Promise<LocalRow<Debt>> {
    return writeTx(ctx, [db.debts, db.transactions, db.recurring_rules], async () => {
      const cur = await getLiveDebt(id);
      const next = change(cur);
      if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
      checkDates(next);
      if ((next.direction !== cur.direction || next.currency !== cur.currency) && (await hasLinks(id))) {
        throw new ValidationError(
          `Нельзя менять направление или валюту долга «${cur.counterparty}»: по нему уже есть операции. Заведите новый долг.`,
        );
      }
      const row = withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, ...next, ...touch(ctx).fields });
      await db.debts.put(row);
      return row;
    });
  }

  return {
    async create(input, opts) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Долг');
      const id = opts?.id;
      if (id !== undefined) reqId(id, 'Долг: id');
      const data = parseDebtData({ ...clean, closedAt: null, archivedAt: null });
      checkDates(data);
      return writeTx(ctx, [db.debts], async () => {
        const newRowId = id ?? newId();
        if (id !== undefined && (await db.debts.get(newRowId))) throw new ValidationError('Долг с таким id уже существует');
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<Debt> = {
          id: newRowId,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создан здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.debts.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, INPUT_KEYS, 'Долг');
      return save(id, (cur) => parseDebtData({ ...dataOf(cur), ...clean }));
    },

    async close(id) {
      return save(id, (cur) => (cur.closedAt !== null ? dataOf(cur) : { ...dataOf(cur), closedAt: ctx.clock.tick() }));
    },

    async reopen(id) {
      return save(id, (cur) => ({ ...dataOf(cur), closedAt: null }));
    },

    async archive(id) {
      return save(id, (cur) => (cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() }));
    },

    async restore(id) {
      return save(id, (cur) => ({ ...dataOf(cur), archivedAt: null }));
    },
  };
}
