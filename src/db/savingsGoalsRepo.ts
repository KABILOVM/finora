import type { IsoDate, LocalRow, Minor, SavingsGoal, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import { cleanPatch, requireSettings, sameFields, touch, withDirtyGroups, writeTx, type RepoContext } from './repoContext';
import { parseSavingsGoalData, type SavingsGoalData } from './validatePlans';

export interface SavingsGoalInput {
  /** Название: от 1 до 60 символов («Отпуск», «Ноутбук»). */
  name: string;
  /** Сколько накопить: от 1 до 1e15 минимальных единиц, в основной валюте настроек. */
  targetMinor: Minor;
  /** Срок: к какой дате накопить. */
  dueOn: IsoDate;
  /**
   * Кошелёк вида «Накопления», остаток которого считается накопленным (той же валюты, живой, не в архиве, не занятый другой
   * действующей целью). Не задан или null — не привязан: накоплено 0.
   */
  walletId?: UUID | null;
}

export type SavingsGoalPatch = Partial<SavingsGoalInput>;

export interface SavingsGoalsRepo {
  /** Валюта цели = основная валюта настроек на момент создания. */
  create(input: SavingsGoalInput): Promise<LocalRow<SavingsGoal>>;
  /** Правка. Если меняется сумма цели, валюта цели снова берётся из настроек (как у лимитов бюджета). */
  update(id: UUID, patch: SavingsGoalPatch): Promise<LocalRow<SavingsGoal>>;
  /** В архив: цель перестаёт учитываться в расчёте, кошелёк освобождается. Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<SavingsGoal>>;
  /** Из архива в работу; заодно возвращает и удалённую цель (отмена удаления). Если её кошелёк теперь занят другой целью — ошибка. */
  restore(id: UUID): Promise<LocalRow<SavingsGoal>>;
  /** Удаление (запись только скрывается: так синхронизация узнаёт об удалении). Повтор безопасен. */
  remove(id: UUID): Promise<LocalRow<SavingsGoal>>;
}

const INPUT_KEYS = ['name', 'targetMinor', 'dueOn', 'walletId'] as const;
const DATA_KEYS: readonly (keyof SavingsGoalData)[] = ['name', 'targetMinor', 'currency', 'dueOn', 'walletId', 'archivedAt'];

const dataOf = (g: SavingsGoal): SavingsGoalData => ({
  name: g.name,
  targetMinor: g.targetMinor,
  currency: g.currency,
  dueOn: g.dueOn,
  walletId: g.walletId,
  archivedAt: g.archivedAt,
});

export function createSavingsGoalsRepo(ctx: RepoContext): SavingsGoalsRepo {
  const { db } = ctx;
  const TABLES = [db.savings_goals, db.wallets, db.settings];

  async function getGoal(id: UUID): Promise<LocalRow<SavingsGoal>> {
    const g = await db.savings_goals.get(id);
    if (!g) throw new ValidationError('Цель не найдена');
    return g;
  }

  async function getLiveGoal(id: UUID): Promise<LocalRow<SavingsGoal>> {
    const g = await getGoal(id);
    if (g.deletedAt !== null) throw new ValidationError(`Цель «${g.name}» удалена`);
    return g;
  }

  /**
   * Кошелёк цели: живой, не в архиве, вида «Накопления», той же валюты, и ни у какой другой действующей цели (не удалённой и не в
   * архиве) на него нет привязки: иначе одни и те же деньги засчитались бы двум целям.
   */
  async function checkWallet(goalId: UUID, data: SavingsGoalData): Promise<void> {
    if (data.walletId === null) return;
    const wallet = await db.wallets.get(data.walletId);
    if (!wallet || wallet.deletedAt !== null) throw new ValidationError('Кошелёк цели не найден');
    if (wallet.archivedAt !== null) throw new ValidationError(`Кошелёк «${wallet.name}» в архиве: верните его или выберите другой`);
    if (wallet.kind !== 'savings') throw new ValidationError(`Цель можно привязать только к кошельку вида «Накопления», а «${wallet.name}» — другого вида`);
    if (wallet.currency !== data.currency) {
      throw new ValidationError(`Кошелёк «${wallet.name}» в ${wallet.currency}, а цель в ${data.currency}: выберите кошелёк в валюте цели`);
    }
    const other = await db.savings_goals
      .where('walletId')
      .equals(data.walletId)
      .filter((g) => g.id !== goalId && g.deletedAt === null && g.archivedAt === null)
      .first();
    if (other) throw new ValidationError(`Кошелёк «${wallet.name}» уже занят целью «${other.name}»: у каждой цели свой кошелёк`);
  }

  async function write(cur: LocalRow<SavingsGoal>, next: SavingsGoalData, extra: Partial<SavingsGoal> = {}): Promise<LocalRow<SavingsGoal>> {
    if (sameFields(dataOf(cur), next, DATA_KEYS) && Object.keys(extra).length === 0) return cur;
    const row = withDirtyGroups<LocalRow<SavingsGoal>>('savings_goals', cur, { ...cur, ...next, ...extra, ...touch(ctx).fields });
    await db.savings_goals.put(row);
    return row;
  }

  return {
    async create(input) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Цель');
      return writeTx(ctx, TABLES, async () => {
        const settings = await requireSettings(ctx);
        const data = parseSavingsGoalData({
          walletId: null,
          ...clean,
          currency: settings.baseCurrency,
          archivedAt: null,
        });
        const id = newId();
        await checkWallet(id, data);
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<SavingsGoal> = {
          id,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создана здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.savings_goals.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, INPUT_KEYS, 'Цель');
      return writeTx(ctx, TABLES, async () => {
        const cur = await getLiveGoal(id);
        const settings = await requireSettings(ctx);
        const next = parseSavingsGoalData({
          ...dataOf(cur),
          ...clean,
          // новая сумма вводится в сегодняшней основной валюте; без новой суммы валюта цели не меняется
          currency: clean.targetMinor !== undefined ? settings.baseCurrency : cur.currency,
        });
        if (next.walletId !== cur.walletId || next.currency !== cur.currency) await checkWallet(id, next);
        return write(cur, next);
      });
    },

    async archive(id) {
      return writeTx(ctx, TABLES, async () => {
        const cur = await getLiveGoal(id);
        return write(cur, cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() });
      });
    },

    async restore(id) {
      return writeTx(ctx, TABLES, async () => {
        const cur = await getGoal(id);
        if (cur.deletedAt === null && cur.archivedAt === null) return cur;
        const next: SavingsGoalData = { ...dataOf(cur), archivedAt: null };
        // привязка к кошельку может устареть, пока цель лежала в архиве (кошелёк заняла другая цель, ушёл в архив или удалён)
        try {
          await checkWallet(id, next);
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e;
          throw new ValidationError(`Не удалось вернуть цель «${cur.name}»: ${e.message}. Выберите другой кошелёк в правке цели`);
        }
        return write(cur, next, cur.deletedAt !== null ? { deletedAt: null } : {});
      });
    },

    async remove(id) {
      return writeTx(ctx, TABLES, async () => {
        const cur = await getGoal(id);
        if (cur.deletedAt !== null) return cur;
        const { stamp, fields } = touch(ctx);
        const row = withDirtyGroups<LocalRow<SavingsGoal>>('savings_goals', cur, { ...cur, deletedAt: stamp, ...fields });
        await db.savings_goals.put(row);
        return row;
      });
    },
  };
}
