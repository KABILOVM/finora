import { TABLE_SPECS, type SyncTableName } from '@/sync/tables';

/**
 * ГРУППЫ ПОЛЕЙ — единица слияния правок одной записи.
 *
 * Сервер хранит запись целиком с одной меткой, поэтому две правки РАЗНЫХ частей одной записи на разных устройствах
 * (сумму на телефоне, заметку на компьютере) по метке «целиком» теряли бы одну из них. Клиент помнит, какие группы
 * он изменил (LocalFields.dirtyGroups), и при получении серверной версии берёт СВОИ группы у себя, а остальные у сервера
 * (см. syncMerge.ts). Поля одной группы всегда едут вместе: иначе получилась бы несогласованная запись
 * (например, сумма одной правки с курсом другой).
 *
 * Поля SyncFields (id, createdAt, clientUpdatedAt, deviceId) в слиянии не участвуют: id и createdAt не меняются,
 * а метка и устройство выдаются заново при каждом слиянии.
 *
 * Новое синхронизируемое поле ОБЯЗАНО попасть ровно в одну группу — это проверяет tests/db/mergeGroups.test.ts.
 *
 * ПАМЯТЬ О ПРАВКАХ. Одного списка групп мало, чтобы отличить «сервер изменил группу» от «сервер ещё хранит то, с чего я начал»,
 * поэтому рядом с dirtyGroups строка хранит ЛОКАЛЬНУЮ память dirtyBase: для каждой нашей группы — значения полей ДО наших правок
 * (`b`, то, что было на сервере) и время нашей последней правки группы (`at`). Из неё следуют три правила (syncMerge.ts):
 *  - значение группы вернулось к исходному — группа убирается из списка (сменил и вернул = ничего не менял);
 *  - сервер группу не менял (там по-прежнему `b`) — побеждает наша правка; мы не менялись — берём серверное;
 *  - менялись обе стороны — побеждает правка с БОЛЕЕ ПОЗДНЕЙ меткой (метка серверной версии против `at`), а не та, кто пришёл позже.
 * Память живёт и у строки, УЖЕ отправленной, но ещё не подтверждённой (сервер вернул нашу же версию): ответ на отправку мог
 * потеряться, а сервер мог молча отклонить нашу версию как устаревшую или её могли перезаписать. Подтверждение — когда с сервера
 * приходит версия с нашей меткой и нашим устройством. Это поле, как и dirtyGroups, никуда не уходит (в договор LocalFields не входит).
 */

export type GroupName = string;

/** Поля, не входящие ни в одну группу. */
export const NON_MERGED_FIELDS: readonly string[] = ['id', 'createdAt', 'clientUpdatedAt', 'deviceId'];

export const MERGE_GROUPS: Readonly<Record<SyncTableName, Readonly<Record<GroupName, readonly string[]>>>> = {
  transactions: {
    money: ['kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'debtId', 'baseCurrency', 'baseAmountMinor', 'fxRate', 'fxSource'],
    date: ['occurredOn'],
    note: ['note'],
    /** Происхождение (регулярный платёж, по которому создана операция); задаётся при создании и не правится. */
    origin: ['recurringRuleId'],
    deleted: ['deletedAt'],
  },
  wallets: {
    name: ['name'],
    money: ['currency', 'kind', 'openingBalanceMinor'],
    look: ['color', 'icon', 'sortOrder'],
    /** Цель накопления: сумма и срок правятся вместе и не конфликтуют с валютой и начальным остатком. */
    goal: ['goalMinor', 'goalOn'],
    archived: ['archivedAt'],
    deleted: ['deletedAt'],
  },
  categories: {
    name: ['name'],
    kind: ['kind', 'parentId'],
    look: ['color', 'icon', 'sortOrder'],
    archived: ['archivedAt'],
    deleted: ['deletedAt'],
  },
  budgets: {
    limit: ['amountMinor', 'currency', 'period'],
    target: ['categoryId'],
    archived: ['archivedAt'],
    deleted: ['deletedAt'],
  },
  debts: {
    party: ['direction', 'counterparty'],
    amount: ['principalMinor', 'currency'],
    /** Проценты, ставка и срок — одной группой: ставка и срок без процентов сервер не примет. */
    interest: ['interestMinor', 'interestRateBp', 'termMonths'],
    /** Объединение: в состав какого долга входит этот. */
    link: ['mergedIntoId'],
    dates: ['openedOn', 'dueOn'],
    note: ['note'],
    closed: ['closedAt'],
    archived: ['archivedAt'],
    deleted: ['deletedAt'],
  },
  recurring_rules: {
    money: ['kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'debtId'],
    schedule: ['frequency', 'intervalN', 'startOn', 'endOn'],
    mode: ['autoPost'],
    note: ['note'],
    archived: ['archivedAt'],
    deleted: ['deletedAt'],
  },
  shopping_items: {
    name: ['name'],
    qty: ['qtyMilli', 'unit'],
    /** Отметка, цена, покупка и чек — одной группой: «куплено» без отметки и цены сервер не примет. */
    state: ['priceMinor', 'checkedAt', 'purchasedAt', 'transactionId'],
    deleted: ['deletedAt'],
  },
  settings: {
    baseCurrency: ['baseCurrency'],
    week: ['weekStartsOn'],
    defaultWallet: ['defaultWalletId'],
    locale: ['locale'],
    /** Города для погоды и выбранный город: правятся вместе и не конфликтуют с валютой, неделей и кошельком по умолчанию. */
    weather: ['weather'],
    deleted: ['deletedAt'],
  },
};

type Fields = Record<string, unknown>;

/** Память о правках одной группы (см. шапку файла). */
export interface GroupBase {
  /** Значения полей группы до наших правок. */
  b: Fields;
  /** Метка нашей последней правки этой группы. */
  at: string;
  /**
   * Версия строки уже передавалась на отправку: сервер мог принять наше значение (ответ мог потеряться). Пока флага нет, `b` —
   * точно то, что на сервере, и «вернулось к `b`» значит «не менялось». С флагом это не так (на сервере может лежать наше
   * отправленное значение), поэтому группа не убирается и в споре решает только метка.
   */
  s?: boolean;
  /**
   * Значения группы, которые мы уже передавали на отправку (последние MAX_SENT, старые первыми). Метка серверной версии — это
   * метка последней правки ЛЮБОЙ группы записи, и чужое устройство, сменив другую группу, поднимает её, перевозя наше прежнее
   * значение этой группы. Если серверное значение — одно из наших отправленных, это наш же прежний вариант, а не чужая правка:
   * наша более поздняя правка побеждает без сравнения меток.
   */
  p?: Fields[];
}

/** Сколько отправленных значений группы помнить. */
export const MAX_SENT = 8;
export type DirtyBase = Partial<Record<GroupName, GroupBase>>;

/** Локальные служебные поля строки сверх договора LocalFields. */
export interface MergeMemory {
  dirtyGroups?: string[];
  dirtyBase?: DirtyBase;
}

/** Названия групп таблицы в каноническом порядке (так их и хранит dirtyGroups). */
export const groupNames = (table: SyncTableName): GroupName[] => Object.keys(MERGE_GROUPS[table]);

/** Поле → группа (по таблице). Поля вне групп (SyncFields) → undefined. */
const fieldIndex = new Map<SyncTableName, Map<string, GroupName>>();
export function groupOfField(table: SyncTableName, field: string): GroupName | undefined {
  let idx = fieldIndex.get(table);
  if (!idx) {
    idx = new Map();
    for (const [g, fields] of Object.entries(MERGE_GROUPS[table])) for (const f of fields) idx.set(f, g);
    fieldIndex.set(table, idx);
  }
  return idx.get(field);
}

/** Все поля, участвующие в слиянии (без SyncFields). */
export const mergedFields = (table: SyncTableName): string[] => Object.values(MERGE_GROUPS[table]).flat();

const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

const groupEqual = (table: SyncTableName, group: GroupName, a: Fields, b: Fields): boolean =>
  (MERGE_GROUPS[table][group] ?? []).every((f) => same(a[f], b[f]));

/** Группы (в каноническом порядке), в которых хотя бы одно поле у a и b различается. */
export function changedGroups(table: SyncTableName, a: object, b: object): GroupName[] {
  return groupNames(table).filter((g) => !groupEqual(table, g, a as Fields, b as Fields));
}

/** Совпадают ли все поля, участвующие в слиянии (метки, id и служебные поля не сравниваются). */
export const sameMergedFields = (table: SyncTableName, a: object, b: object): boolean => changedGroups(table, a, b).length === 0;

/**
 * Приводит сохранённое dirtyGroups к каноническому виду (без повторов, в порядке таблицы).
 * undefined — списка нет или он непонятен (не массив, чужое имя группы): тогда строка ведёт себя как «вся запись».
 */
export function normalizeGroups(table: SyncTableName, groups: unknown): GroupName[] | undefined {
  if (!Array.isArray(groups)) return undefined;
  const known = groupNames(table);
  if (!groups.every((g) => typeof g === 'string' && known.includes(g))) return undefined;
  return known.filter((g) => groups.includes(g));
}

export function unionGroups(table: SyncTableName, a: readonly GroupName[], b: readonly GroupName[]): GroupName[] {
  return groupNames(table).filter((g) => a.includes(g) || b.includes(g));
}

/**
 * Значения полей по группам: для каждой группы из `localGroups` — из `local`, для остальных — из `server`.
 * Возвращает только поля слияния (без SyncFields). Группа всегда берётся ЦЕЛИКОМ из одного источника.
 */
export function mergeByGroups(
  table: SyncTableName,
  server: object,
  local: object,
  localGroups: readonly GroupName[],
): Fields {
  const out: Fields = {};
  for (const [g, fields] of Object.entries(MERGE_GROUPS[table])) {
    const src = (localGroups.includes(g) ? local : server) as Fields;
    for (const f of fields) out[f] = src[f] ?? null;
  }
  return out;
}

/** Колонки договора, не попавшие ни в одну группу (кроме SyncFields), и группы с чужими полями — для теста-стража. */
export function auditGroups(table: SyncTableName): { orphans: string[]; unknown: string[]; duplicated: string[] } {
  const spec = TABLE_SPECS[table].columns.map((c) => c.field);
  const all = mergedFields(table);
  const count = new Map<string, number>();
  for (const f of all) count.set(f, (count.get(f) ?? 0) + 1);
  return {
    orphans: spec.filter((f) => !NON_MERGED_FIELDS.includes(f) && !count.has(f)),
    unknown: all.filter((f) => !spec.includes(f) || NON_MERGED_FIELDS.includes(f)),
    duplicated: [...count].filter(([, n]) => n > 1).map(([f]) => f),
  };
}

export interface Tracking {
  /** Группы, правленные локально (канонический порядок). */
  groups: GroupName[];
  /** Память по группам; у группы из `groups` её может не быть (строка до обновления приложения) — тогда побеждает наше значение. */
  base: DirtyBase;
}

const isRecord = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Что строка помнит о своих правках. undefined — групп нет (новая из импорта, строка до обновления приложения): правило «целиком».
 * Непонятная память отбрасывается по группам: хуже, чем «нет памяти» (побеждает наше значение), она не станет.
 */
export function readTracking(table: SyncTableName, row: object): Tracking | undefined {
  const m = row as MergeMemory;
  const groups = normalizeGroups(table, m.dirtyGroups);
  if (groups === undefined) return undefined;
  const base: DirtyBase = {};
  if (isRecord(m.dirtyBase)) {
    for (const g of groups) {
      const e = (m.dirtyBase as Fields)[g];
      if (isRecord(e) && isRecord(e['b']) && typeof e['at'] === 'string') {
        const sent = Array.isArray(e['p']) ? (e['p'] as unknown[]).filter(isRecord).slice(-MAX_SENT) : [];
        base[g] = {
          b: e['b'],
          at: e['at'],
          ...(e['s'] === true ? { s: true } : {}),
          ...(sent.length > 0 ? { p: sent } : {}),
        };
      }
    }
  }
  return { groups, base };
}

/** Значения полей одной группы (без остального). */
export function pickGroup(table: SyncTableName, group: GroupName, src: object): Fields {
  const out: Fields = {};
  for (const f of MERGE_GROUPS[table][group] ?? []) out[f] = (src as Fields)[f] ?? null;
  return out;
}

/** Совпадает ли группа строки со сохранёнными значениями. */
export const groupMatches = (table: SyncTableName, group: GroupName, row: object, values: Fields): boolean =>
  (MERGE_GROUPS[table][group] ?? []).every((f) => same((row as Fields)[f], values[f]));

/** Пометка «передавалась на отправку» у каждой группы с памятью; текущее значение группы запоминается среди отправленных. */
export function markSent(table: SyncTableName, t: Tracking, row: object): Tracking {
  const base: DirtyBase = {};
  for (const g of t.groups) {
    const e = t.base[g];
    if (e === undefined) continue;
    const now = pickGroup(table, g, row);
    const sent = e.p ?? [];
    const last = sent[sent.length - 1];
    base[g] = { ...e, s: true, p: last !== undefined && groupMatches(table, g, now, last) ? sent : [...sent, now].slice(-MAX_SENT) };
  }
  return { groups: t.groups, base };
}

/** Есть ли группы, чьё текущее значение ещё не записано как переданное на отправку. */
export function hasUnsentMemory(table: SyncTableName, t: Tracking, row: object): boolean {
  return t.groups.some((g) => {
    const e = t.base[g];
    if (e === undefined) return false;
    if (e.s !== true) return true;
    const last = e.p?.[e.p.length - 1];
    return last === undefined || !groupMatches(table, g, row, last);
  });
}

/** Записывает память в строку: пустая память не оставляет следов, кроме отметки «правилась» (пустой dirtyBase). */
export function withTracking<R extends object>(row: R, t: Tracking | undefined, keepEmptyMark: boolean): R {
  const { dirtyGroups: _g, dirtyBase: _b, ...rest } = row as R & MergeMemory;
  void _g;
  void _b;
  if (t === undefined) return rest as R;
  const base: DirtyBase = {};
  for (const g of t.groups) if (t.base[g] !== undefined) base[g] = t.base[g];
  const hasBase = Object.keys(base).length > 0;
  if (!hasBase && !keepEmptyMark) return rest as R;
  return { ...rest, dirtyGroups: t.groups, dirtyBase: base } as R;
}

/**
 * Нужно ли перед отправкой свериться с сервером: правка СУЩЕСТВУЮЩЕЙ записи с известными группами. Строка, только что созданная
 * здесь и ни разу не правленная (нет групп, нет памяти, сервер её ещё не видел), сверки не требует: ей нечего терять.
 */
export function needsRemoteMerge(table: SyncTableName, row: object): boolean {
  const m = row as MergeMemory & { serverSeq?: number | null };
  const groups = normalizeGroups(table, m.dirtyGroups);
  if (groups === undefined) return false;
  return groups.length > 0 || m.dirtyBase !== undefined || (m.serverSeq ?? null) !== null;
}
