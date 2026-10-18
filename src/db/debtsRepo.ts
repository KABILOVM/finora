import { addMinor, isMinor } from '@/domain/money';
import { normName } from '@/domain/names';
import type { CurrencyCode, Debt, DebtDirection, IsoDate, LocalRow, Minor, Transaction, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import { cleanPatch, sameFields, touch, withDirtyGroups, writeTx, type RepoContext } from './repoContext';
import { LIMITS, reqId } from './validate';
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

/**
 * Как удалить долг:
 *  - 'keep-operations' — только долг; его операции остаются обычными (debtId обнуляется), остатки кошельков не меняются;
 *  - 'with-operations' — долг и все его живые операции (остатки кошельков возвращаются к состоянию «до долга»).
 */
export type DebtDeleteMode = 'keep-operations' | 'with-operations';

/** Что именно сделало удаление: по этому описанию его можно отменить (undoDelete). Пустые списки — удалять было нечего (повтор). */
export interface DebtDeletion {
  debtId: UUID;
  mode: DebtDeleteMode;
  /** Операции, которые затронуло удаление (отвязаны от долга или удалены — по режиму). */
  txIds: UUID[];
  /** Регулярные платежи по этому долгу, которые ушли в архив. */
  ruleIds: UUID[];
  /** «Только долг»: операции без заметки, которым дописано «Долг «X» (удалён)» (отмена стирает её, если заметку не меняли). */
  notedTxIds: UUID[];
}

/** Заметка отвязанной операции без своей заметки: по ней видно, откуда в итогах взялись бывшие операции долга. */
export const deletedDebtNote = (counterparty: string): string => `Долг «${counterparty.trim()}» (удалён)`;

/**
 * Что сделало объединение долгов: по этому описанию его можно отменить (undoMerge).
 * Долги-источники тоже остаются в базе (мягко удалены), поэтому отмена возвращает всё как было.
 */
export interface DebtMerge {
  /** Долг, в который всё собрано. */
  targetId: UUID;
  /** Склеенные долги (после объединения они удалены). */
  sourceIds: UUID[];
  /** Операции, перешедшие к target, и долг, к которому каждая относилась (включая удалённые операции). */
  txs: { id: UUID; from: UUID }[];
  /** Регулярные платежи, перешедшие к target, и прежний долг каждого. */
  rules: { id: UUID; from: UUID }[];
  /** Данные target до объединения. */
  before: DebtData;
  /** Данные target сразу после объединения: если с тех пор долг правили, отменять уже нельзя. */
  after: DebtData;
}

export interface DebtsRepo {
  create(input: DebtInput, opts?: { id?: UUID }): Promise<LocalRow<Debt>>;
  /** Направление и валюту нельзя менять, когда по долгу уже есть операции или регулярные платежи: суммы поменяли бы смысл. */
  update(id: UUID, patch: DebtPatch): Promise<LocalRow<Debt>>;
  /**
   * «Добавить ещё в долг»: сумма долга растёт на deltaMinor (закрытый долг при этом открывается снова). Сама операция выдачи
   * или получения денег — отдельно (debtActions.saveTopUp), здесь только долг. dueOn — новый срок (undefined — не менять).
   */
  increase(id: UUID, deltaMinor: Minor, opts?: { dueOn?: IsoDate | null }): Promise<LocalRow<Debt>>;
  /**
   * Объединение долгов ОДНОЙ транзакцией базы: всё из sourceIds переходит в targetId, источники удаляются (мягко).
   * Долги обязаны быть живыми, не в архиве, одного направления и одной валюты. Деньги в кошельках не двигаются.
   * Сумма — сумма всех сумм, дата — самая ранняя, срок — ближайший, заметки склеиваются, платежи и регулярные платежи переезжают.
   */
  merge(targetId: UUID, sourceIds: readonly UUID[]): Promise<DebtMerge>;
  /** Отмена объединения. Долг, который с тех пор правили, не трогает (ValidationError). Повтор безопасен. */
  undoMerge(merge: DebtMerge): Promise<LocalRow<Debt>>;
  /** Долг закрыт (погашен или прощён). Остаток при этом не обнуляется — он считается из операций. Повтор безопасен. */
  close(id: UUID): Promise<LocalRow<Debt>>;
  reopen(id: UUID): Promise<LocalRow<Debt>>;
  /** В архив (скрыть из списков). Операции и остаток сохраняются. Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<Debt>>;
  restore(id: UUID): Promise<LocalRow<Debt>>;
  /**
   * Мягкое удаление долга (deletedAt) вместе с последствиями, ОДНОЙ транзакцией базы: либо всё, либо ничего.
   * Регулярные платежи по долгу уходят в архив (debtId сохраняется: вернуть платёж из архива можно, но проводиться как обычный
   * расход он не станет — автопроведение скажет «долг удалён»). Уже удалённый долг — ничего не меняет (пустой результат).
   * «Только долг»: операции отвязываются, а тем, у кого заметки нет, дописывается «Долг «X» (удалён)» (deletedDebtNote).
   */
  softDelete(id: UUID, mode: DebtDeleteMode): Promise<DebtDeletion>;
  /** Отмена удаления: возвращает долг и то, что затронуло удаление (то, что с тех пор успели изменить иначе, не трогает). Повтор безопасен. */
  undoDelete(deletion: DebtDeletion): Promise<LocalRow<Debt>>;
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

const NOTE_SEPARATOR = '\n';

/** Склеенные заметки не длиннее предела: лишнее обрезается с «…», не разрывая символ-пару (иначе заметка не пройдёт проверку). */
function joinNotes(notes: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of notes) {
    const n = raw.trim();
    if (n !== '' && !parts.includes(n)) parts.push(n);
  }
  const all = parts.join(NOTE_SEPARATOR);
  if (all.length <= LIMITS.note) return all;
  let cut = all.slice(0, LIMITS.note - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // «голова» пары без «хвоста»
  return `${cut.trimEnd()}…`;
}

const ruDay = (iso: IsoDate): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Строки «Объединён с: Бобур (от 05.03.2026)» для долгов с другим именем, чем у основного. */
function mergedWith(target: Pick<Debt, 'counterparty'>, sources: readonly Pick<Debt, 'counterparty' | 'openedOn'>[]): string[] {
  const name = normName(target.counterparty);
  return sources.filter((s) => normName(s.counterparty) !== name).map((s) => `Объединён с: ${s.counterparty.trim()} (от ${ruDay(s.openedOn)})`);
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

    async increase(id, deltaMinor, opts) {
      if (!isMinor(deltaMinor) || deltaMinor <= 0) throw new ValidationError('Сумма пополнения должна быть больше нуля');
      const due = opts?.dueOn;
      return save(id, (cur) => {
        if (cur.archivedAt !== null) throw new ValidationError(`Долг «${cur.counterparty}» в архиве: сначала верните его из архива`);
        return parseDebtData({
          ...dataOf(cur),
          principalMinor: addMinor(cur.principalMinor, deltaMinor),
          ...(due !== undefined ? { dueOn: due } : {}),
          closedAt: null,
        });
      });
    },

    async merge(targetId, sourceIds) {
      const ids = [...new Set(sourceIds)];
      if (ids.length === 0) throw new ValidationError('Выберите долги, которые нужно объединить');
      if (ids.includes(targetId)) throw new ValidationError('Долг нельзя объединить с самим собой');
      return writeTx(ctx, [db.debts, db.transactions, db.recurring_rules], async () => {
        const target = await getLiveDebt(targetId);
        const sources: LocalRow<Debt>[] = [];
        for (const id of ids) sources.push(await getLiveDebt(id));
        const all = [target, ...sources];
        for (const d of all) {
          if (d.archivedAt !== null) throw new ValidationError(`Долг «${d.counterparty}» в архиве: сначала верните его из архива`);
          if (d.direction !== target.direction || d.currency !== target.currency) {
            throw new ValidationError('Объединять можно только долги одного направления и одной валюты');
          }
        }

        let principal = target.principalMinor;
        for (const s of sources) principal = addMinor(principal, s.principalMinor);
        const dues = all.map((d) => d.dueOn).filter((d): d is IsoDate => d !== null);
        const before = dataOf(target);
        const after = parseDebtData({
          ...before,
          principalMinor: principal,
          openedOn: all.reduce((min, d) => (d.openedOn < min ? d.openedOn : min), target.openedOn),
          dueOn: dues.length > 0 ? dues.reduce((min, d) => (d < min ? d : min)) : null,
          // другое имя пропадёт из списка — в заметке остаётся, с кем объединён (сразу после своей заметки: при обрезке не теряется)
          note: joinNotes([target.note, ...mergedWith(target, sources), ...sources.map((d) => d.note)]),
          // открыт хотя бы один — общий долг открыт; все закрыты — остаётся закрытым
          closedAt: all.some((d) => d.closedAt === null) ? null : target.closedAt,
        });
        checkDates(after);

        const txs: DebtMerge['txs'] = [];
        const rules: DebtMerge['rules'] = [];
        const allRules = await db.recurring_rules.toArray();
        for (const s of sources) {
          // Все операции источника, в том числе удалённые: иначе «вернуть платёж» потом бы упёрлось в удалённый долг.
          for (const t of await db.transactions.where('debtId').equals(s.id).toArray()) {
            await db.transactions.put(withDirtyGroups<LocalRow<Transaction>>('transactions', t, { ...t, debtId: targetId, ...touch(ctx).fields }));
            txs.push({ id: t.id, from: s.id });
          }
          for (const r of allRules) {
            if (r.debtId !== s.id || r.deletedAt !== null) continue;
            await db.recurring_rules.put(withDirtyGroups('recurring_rules', r, { ...r, debtId: targetId, ...touch(ctx).fields }));
            rules.push({ id: r.id, from: s.id });
          }
          const { stamp, fields } = touch(ctx);
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', s, { ...s, deletedAt: stamp, ...fields }));
        }
        if (!sameFields(before, after, DATA_KEYS)) {
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', target, { ...target, ...after, ...touch(ctx).fields }));
        }
        return { targetId, sourceIds: ids, txs, rules, before, after };
      });
    },

    async undoMerge(merge) {
      return writeTx(ctx, [db.debts, db.transactions, db.recurring_rules], async () => {
        const target = await db.debts.get(merge.targetId);
        if (!target) throw new ValidationError('Долг не найден');
        if (target.deletedAt !== null) throw new ValidationError(`Долг «${target.counterparty}» удалён: объединение уже не отменить`);
        const sources: LocalRow<Debt>[] = [];
        for (const id of merge.sourceIds) {
          const s = await db.debts.get(id);
          if (!s) throw new ValidationError('Долг не найден');
          sources.push(s);
        }
        const gone = sources.filter((s) => s.deletedAt !== null);
        if (gone.length === 0) return target; // уже отменено
        if (!sameFields(dataOf(target), merge.after, DATA_KEYS)) {
          throw new ValidationError(`Долг «${target.counterparty}» уже изменили после объединения, поэтому отменить его нельзя`);
        }
        for (const s of gone) {
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', s, { ...s, deletedAt: null, ...touch(ctx).fields }));
        }
        const back = new Set(gone.map((s) => s.id));
        for (const { id, from } of merge.txs) {
          const t = await db.transactions.get(id);
          if (!t || t.debtId !== merge.targetId || !back.has(from)) continue; // с тех пор перепривязана или источник не удалён
          await db.transactions.put(withDirtyGroups<LocalRow<Transaction>>('transactions', t, { ...t, debtId: from, ...touch(ctx).fields }));
        }
        for (const { id, from } of merge.rules) {
          const r = await db.recurring_rules.get(id);
          if (!r || r.deletedAt !== null || r.debtId !== merge.targetId || !back.has(from)) continue;
          await db.recurring_rules.put(withDirtyGroups('recurring_rules', r, { ...r, debtId: from, ...touch(ctx).fields }));
        }
        const row = withDirtyGroups<LocalRow<Debt>>('debts', target, { ...target, ...merge.before, ...touch(ctx).fields });
        await db.debts.put(row);
        return row;
      });
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

    async softDelete(id, mode) {
      if (mode !== 'keep-operations' && mode !== 'with-operations') throw new ValidationError('Не понятно, как удалять долг');
      return writeTx(ctx, [db.debts, db.transactions, db.recurring_rules], async () => {
        const cur = await db.debts.get(id);
        if (!cur) throw new ValidationError('Долг не найден');
        if (cur.deletedAt !== null) return { debtId: id, mode, txIds: [], ruleIds: [], notedTxIds: [] };

        const txs = (await db.transactions.where('debtId').equals(id).toArray()).filter((t) => t.deletedAt === null);
        const autoNote = deletedDebtNote(cur.counterparty);
        const notedTxIds: UUID[] = [];
        for (const t of txs) {
          const { stamp, fields } = touch(ctx);
          let next: LocalRow<Transaction>;
          if (mode === 'with-operations') next = { ...t, deletedAt: stamp, ...fields };
          else if (t.note.trim() === '') {
            next = { ...t, debtId: null, note: autoNote, ...fields };
            notedTxIds.push(t.id);
          } else next = { ...t, debtId: null, ...fields };
          await db.transactions.put(withDirtyGroups<LocalRow<Transaction>>('transactions', t, next));
        }
        const rules = (await db.recurring_rules.toArray()).filter((r) => r.debtId === id && r.deletedAt === null && r.archivedAt === null);
        for (const r of rules) {
          const { stamp, fields } = touch(ctx);
          await db.recurring_rules.put(withDirtyGroups('recurring_rules', r, { ...r, archivedAt: stamp, ...fields }));
        }
        const { stamp, fields } = touch(ctx);
        await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, deletedAt: stamp, ...fields }));
        return { debtId: id, mode, txIds: txs.map((t) => t.id), ruleIds: rules.map((r) => r.id), notedTxIds };
      });
    },

    async undoDelete(deletion) {
      const { debtId, mode } = deletion;
      return writeTx(ctx, [db.debts, db.transactions, db.recurring_rules], async () => {
        const cur = await db.debts.get(debtId);
        if (!cur) throw new ValidationError('Долг не найден');
        if (cur.deletedAt === null) return cur; // уже возвращён
        const noted = new Set(deletion.notedTxIds ?? []);
        const autoNote = deletedDebtNote(cur.counterparty);
        for (const txId of deletion.txIds) {
          const t = await db.transactions.get(txId);
          if (!t) continue;
          if (mode === 'with-operations') {
            if (t.deletedAt === null) continue;
            await db.transactions.put(withDirtyGroups<LocalRow<Transaction>>('transactions', t, { ...t, deletedAt: null, ...touch(ctx).fields }));
          } else {
            if (t.deletedAt !== null || t.debtId !== null) continue; // с тех пор удалена или привязана к другому долгу
            // дописанную заметку убираем, только если её не меняли
            const note = noted.has(t.id) && t.note === autoNote ? '' : t.note;
            await db.transactions.put(withDirtyGroups<LocalRow<Transaction>>('transactions', t, { ...t, debtId, note, ...touch(ctx).fields }));
          }
        }
        for (const ruleId of deletion.ruleIds) {
          const r = await db.recurring_rules.get(ruleId);
          if (!r || r.deletedAt !== null || r.archivedAt === null || r.debtId !== debtId) continue;
          await db.recurring_rules.put(withDirtyGroups('recurring_rules', r, { ...r, archivedAt: null, ...touch(ctx).fields }));
        }
        const row = withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, deletedAt: null, ...touch(ctx).fields });
        await db.debts.put(row);
        return row;
      });
    },
  };
}
