import { addMinor, isMinor } from '@/domain/money';
import { mergeLinks, partsOf } from '@/domain/debtGroups';
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
  /** Проценты за весь срок (кредит в банке); не указано или null — без процентов. Платят сверх principalMinor. */
  interestMinor?: Minor | null;
  /** Ставка, сотые доли процента годовых (2400 = 24 %). Только вместе с interestMinor. */
  interestRateBp?: number | null;
  /** Срок в месяцах. Только вместе с interestMinor. */
  termMonths?: number | null;
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
  /** Составляющие объединения, которые вышли из состава удалённого главного долга и стали отдельными (отмена возвращает их). */
  unmergedIds?: UUID[];
}

/** Заметка отвязанной операции без своей заметки: по ней видно, откуда в итогах взялись бывшие операции долга. */
export const deletedDebtNote = (counterparty: string): string => `Долг «${counterparty.trim()}» (удалён)`;

/**
 * Что сделало объединение долгов: по этому описанию его можно отменить (undoMerge). Долги не склеиваются: у каждой составляющей
 * остаются свои сумма, проценты, срок, даты, платежи и планы, меняется только ссылка на главный долг.
 */
export interface DebtMerge {
  /** Главный долг, в состав которого вошли остальные. */
  targetId: UUID;
  /** Кто вошёл в состав и в чьём составе был прежде (null — сам по себе). */
  links: { id: UUID; from: UUID | null }[];
}

/** Кто вышел из состава объединения: главный долг и его бывшие составляющие (повторное объединение = merge(targetId, partIds)). */
export interface DebtUnmerge {
  targetId: UUID;
  partIds: UUID[];
}

/** Действие над объединением целиком: withParts — то же самое сделать и со всеми составляющими главного долга. */
export interface GroupOpts {
  withParts?: boolean;
}

export interface DebtsRepo {
  create(input: DebtInput, opts?: { id?: UUID }): Promise<LocalRow<Debt>>;
  /** Направление и валюту нельзя менять, когда по долгу уже есть операции или регулярные платежи: суммы поменяли бы смысл. */
  update(id: UUID, patch: DebtPatch): Promise<LocalRow<Debt>>;
  /**
   * «Добавить ещё в долг»: сумма долга растёт на deltaMinor (закрытый долг при этом открывается снова). Сама операция выдачи
   * или получения денег — отдельно (debtActions.saveTopUp), здесь только долг. dueOn — новый срок (undefined — не менять).
   * journal — строка для истории: дописывается в конец заметки долга как есть, повтор тоже записывается (так «пополнение на бумаге»
   * оставляет след). Не помещается — уходят самые старые строки, а не новая.
   */
  increase(id: UUID, deltaMinor: Minor, opts?: { dueOn?: IsoDate | null; journal?: string }): Promise<LocalRow<Debt>>;
  /**
   * Объединение долгов ОДНОЙ транзакцией базы: sourceIds входят в состав targetId. Ничего не склеивается и не переезжает: у каждого
   * долга остаются свои сумма, проценты, ставка, срок, даты, платежи и планы; общая сумма — сумма по составляющим. Долги обязаны
   * быть живыми, не в архиве, одного направления и одной валюты; главный сам не может входить в чей-то состав. Составляющие
   * объединяемого долга переходят в состав главного. Деньги в кошельках не двигаются. Повтор безопасен.
   */
  merge(targetId: UUID, sourceIds: readonly UUID[]): Promise<DebtMerge>;
  /** Отмена объединения: каждый возвращается туда, где был. Кого с тех пор перенесли в другой состав, не трогает. Повтор безопасен. */
  undoMerge(merge: DebtMerge): Promise<LocalRow<Debt>>;
  /**
   * Выход из объединения. Составляющая выходит одна и становится отдельным долгом; у главного долга выходят все составляющие.
   * Ничего не удаляется: долги, платежи и планы те же. Пусто (долг сам по себе) — ничего не меняет.
   */
  unmerge(id: UUID): Promise<DebtUnmerge>;
  /**
   * Долг закрыт (погашен или прощён). Остаток при этом не обнуляется — он считается из операций. Повтор безопасен.
   * С withParts закрываются и все составляющие главного долга — одной транзакцией.
   */
  close(id: UUID, opts?: GroupOpts): Promise<LocalRow<Debt>>;
  reopen(id: UUID, opts?: GroupOpts): Promise<LocalRow<Debt>>;
  /** В архив (скрыть из списков). Операции и остаток сохраняются. Повтор безопасен. withParts — вместе со составляющими. */
  archive(id: UUID, opts?: GroupOpts): Promise<LocalRow<Debt>>;
  restore(id: UUID, opts?: GroupOpts): Promise<LocalRow<Debt>>;
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

const INPUT_KEYS = [
  'direction',
  'counterparty',
  'principalMinor',
  'interestMinor',
  'interestRateBp',
  'termMonths',
  'currency',
  'openedOn',
  'dueOn',
  'note',
] as const;
const DATA_KEYS: readonly (keyof DebtData)[] = [
  'direction',
  'counterparty',
  'principalMinor',
  'interestMinor',
  'interestRateBp',
  'termMonths',
  'mergedIntoId',
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
  interestMinor: d.interestMinor,
  interestRateBp: d.interestRateBp,
  termMonths: d.termMonths,
  mergedIntoId: d.mergedIntoId ?? null,
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

/**
 * Дописать строку в конец заметки (без слияния дублей: два одинаковых пополнения — две записи). Не помещается в предел — убираются
 * самые старые строки целиком (спереди остаётся «…»), новая строка сохраняется. Одна строка длиннее предела режется с конца.
 */
export function appendNoteLine(note: string, line: string): string {
  const add = line.trim();
  const lines = note.trim() === '' ? [] : note.trim().split(NOTE_SEPARATOR);
  if (add === '') return lines.join(NOTE_SEPARATOR);
  lines.push(add);
  let dropped = false;
  const joined = () => (dropped ? '…' + NOTE_SEPARATOR : '') + lines.join(NOTE_SEPARATOR);
  while (joined().length > LIMITS.note && lines.length > 1) {
    lines.shift();
    dropped = true;
  }
  const out = joined();
  return out.length <= LIMITS.note ? out : joinNotes([add]);
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

  /** Живые составляющие главного долга (по действующим связям). */
  async function liveParts(id: UUID): Promise<LocalRow<Debt>[]> {
    return partsOf(await db.debts.toArray(), id);
  }

  /** Правка одного долга; вызывается ВНУТРИ транзакции. */
  async function saveIn(id: UUID, change: (d: LocalRow<Debt>) => DebtData): Promise<LocalRow<Debt>> {
    const cur = await getLiveDebt(id);
    const next = change(cur);
    if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
    checkDates(next);
    if (next.direction !== cur.direction || next.currency !== cur.currency) {
      if (await hasLinks(id)) {
        throw new ValidationError(
          `Нельзя менять направление или валюту долга «${cur.counterparty}»: по нему уже есть операции. Заведите новый долг.`,
        );
      }
      // в объединении суммы складываются: у составляющих и главного направление и валюта обязаны совпадать
      if (cur.mergedIntoId != null || (await liveParts(id)).length > 0) {
        throw new ValidationError(
          `Нельзя менять направление или валюту долга «${cur.counterparty}»: он объединён с другими. Сначала выведите его из объединения.`,
        );
      }
    }
    const row = withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, ...next, ...touch(ctx).fields });
    await db.debts.put(row);
    return row;
  }

  const TABLES = [db.debts, db.transactions, db.recurring_rules];

  async function save(id: UUID, change: (d: LocalRow<Debt>) => DebtData): Promise<LocalRow<Debt>> {
    return writeTx(ctx, TABLES, () => saveIn(id, change));
  }

  /** То же, но с withParts — и для всех составляющих главного долга (всё или ничего). Возвращает сам долг. */
  async function saveGroup(id: UUID, opts: GroupOpts | undefined, change: (d: LocalRow<Debt>) => DebtData): Promise<LocalRow<Debt>> {
    return writeTx(ctx, TABLES, async () => {
      const row = await saveIn(id, change);
      if (opts?.withParts === true) for (const part of await liveParts(id)) await saveIn(part.id, change);
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
      return save(id, (cur) => {
        const next: Record<string, unknown> = { ...dataOf(cur), ...clean };
        // Проценты сняли, а ставку и срок не тронули: они без процентов не бывают — уходят вместе с ними
        if (clean.interestMinor === null) {
          if (clean.interestRateBp === undefined) next['interestRateBp'] = null;
          if (clean.termMonths === undefined) next['termMonths'] = null;
        }
        return parseDebtData(next);
      });
    },

    async increase(id, deltaMinor, opts) {
      if (!isMinor(deltaMinor) || deltaMinor <= 0) throw new ValidationError('Сумма пополнения должна быть больше нуля');
      const due = opts?.dueOn;
      const journal = opts?.journal?.trim() ?? '';
      return save(id, (cur) => {
        if (cur.archivedAt !== null) throw new ValidationError(`Долг «${cur.counterparty}» в архиве: сначала верните его из архива`);
        return parseDebtData({
          ...dataOf(cur),
          principalMinor: addMinor(cur.principalMinor, deltaMinor),
          ...(due !== undefined ? { dueOn: due } : {}),
          ...(journal !== '' ? { note: appendNoteLine(cur.note, journal) } : {}),
          closedAt: null,
        });
      });
    },

    async merge(targetId, sourceIds) {
      const ids = [...new Set(sourceIds)];
      if (ids.length === 0) throw new ValidationError('Выберите долги, которые нужно объединить');
      if (ids.includes(targetId)) throw new ValidationError('Долг нельзя объединить с самим собой');
      return writeTx(ctx, TABLES, async () => {
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
        const live = await db.debts.toArray();
        const { rootOf, parts } = mergeLinks(live);
        // главный сам не входит ни в чей состав (иначе вложенность)
        const targetRoot = rootOf.get(targetId);
        if (targetRoot !== undefined) {
          const root = live.find((d) => d.id === targetRoot);
          throw new ValidationError(`Долг «${target.counterparty}» уже входит в состав долга «${root?.counterparty ?? ''}»: объединяйте через него`);
        }
        const links: DebtMerge['links'] = [];
        const relink = async (d: LocalRow<Debt>) => {
          if ((d.mergedIntoId ?? null) === targetId) return; // уже в составе (повтор)
          links.push({ id: d.id, from: d.mergedIntoId ?? null });
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', d, { ...d, mergedIntoId: targetId, ...touch(ctx).fields }));
        };
        for (const s of sources) {
          const owner = rootOf.get(s.id);
          if (owner !== undefined && owner !== targetId) {
            const root = live.find((d) => d.id === owner);
            throw new ValidationError(`Долг «${s.counterparty}» уже входит в состав долга «${root?.counterparty ?? ''}»: сначала выведите его из объединения`);
          }
          await relink(s);
          // у присоединяемого главного долга были свои составляющие: они переходят вместе с ним (вложенности нет)
          for (const part of parts.get(s.id) ?? []) await relink(part);
        }
        return { targetId, links };
      });
    },

    async undoMerge(merge) {
      return writeTx(ctx, TABLES, async () => {
        const target = await db.debts.get(merge.targetId);
        if (!target) throw new ValidationError('Долг не найден');
        for (const { id, from } of merge.links) {
          const d = await db.debts.get(id);
          // с тех пор перенесли в другой состав или удалили — не трогаем
          if (!d || d.deletedAt !== null || (d.mergedIntoId ?? null) !== merge.targetId) continue;
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', d, { ...d, mergedIntoId: from, ...touch(ctx).fields }));
        }
        return (await db.debts.get(merge.targetId)) ?? target;
      });
    },

    async unmerge(id) {
      return writeTx(ctx, TABLES, async () => {
        const cur = await getLiveDebt(id);
        const live = await db.debts.toArray();
        const { rootOf, parts } = mergeLinks(live);
        const owner = rootOf.get(id);
        // составляющая выходит одна; главный долг — вся его группа
        const leaving = owner !== undefined ? [cur] : (parts.get(id) ?? []);
        const targetId = owner ?? id;
        for (const d of leaving) {
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', d, { ...d, mergedIntoId: null, ...touch(ctx).fields }));
        }
        return { targetId, partIds: leaving.map((d) => d.id) };
      });
    },

    async close(id, opts) {
      return saveGroup(id, opts, (cur) => (cur.closedAt !== null ? dataOf(cur) : { ...dataOf(cur), closedAt: ctx.clock.tick() }));
    },

    async reopen(id, opts) {
      return saveGroup(id, opts, (cur) => ({ ...dataOf(cur), closedAt: null }));
    },

    async archive(id, opts) {
      return saveGroup(id, opts, (cur) => (cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() }));
    },

    async restore(id, opts) {
      return saveGroup(id, opts, (cur) => ({ ...dataOf(cur), archivedAt: null }));
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
        // главный долг объединения: составляющие остаются отдельными долгами (у каждого свои платежи и планы), а не пропадают
        const unmergedIds: UUID[] = [];
        for (const part of await liveParts(id)) {
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', part, { ...part, mergedIntoId: null, ...touch(ctx).fields }));
          unmergedIds.push(part.id);
        }
        const { stamp, fields } = touch(ctx);
        await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, deletedAt: stamp, ...fields }));
        return { debtId: id, mode, txIds: txs.map((t) => t.id), ruleIds: rules.map((r) => r.id), notedTxIds, ...(unmergedIds.length > 0 ? { unmergedIds } : {}) };
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
        // составляющие, вышедшие из состава при удалении, возвращаются (кроме тех, кого с тех пор уже включили в другой состав)
        for (const partId of deletion.unmergedIds ?? []) {
          const part = await db.debts.get(partId);
          if (!part || part.deletedAt !== null || (part.mergedIntoId ?? null) !== null) continue;
          await db.debts.put(withDirtyGroups<LocalRow<Debt>>('debts', part, { ...part, mergedIntoId: debtId, ...touch(ctx).fields }));
        }
        const row = withDirtyGroups<LocalRow<Debt>>('debts', cur, { ...cur, deletedAt: null, ...touch(ctx).fields });
        await db.debts.put(row);
        return row;
      });
    },
  };
}
