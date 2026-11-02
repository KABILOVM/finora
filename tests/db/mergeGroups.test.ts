import { describe, expect, it } from 'vitest';
import {
  MERGE_GROUPS,
  NON_MERGED_FIELDS,
  auditGroups,
  changedGroups,
  groupNames,
  groupOfField,
  mergeByGroups,
  mergedFields,
  MAX_SENT,
  markSent,
  needsRemoteMerge,
  normalizeGroups,
  readTracking,
  withTracking,
  sameMergedFields,
  unionGroups,
  type Tracking,
} from '@/db/mergeGroups';
import { SYNC_TABLES, TABLE_SPECS, type SyncTableName } from '@/sync/tables';

/** (б) Тест-страж и (а) чистые таблицы слияния по каждой группе и сущности. */

describe('страж: поля договора и группы слияния', () => {
  it('страж покрывает все девять таблиц договора: групп слияния ровно столько же, сколько синхронизируемых таблиц', () => {
    expect([...SYNC_TABLES].sort()).toEqual(['budgets', 'categories', 'debts', 'recurring_rules', 'savings_goals', 'settings', 'shopping_items', 'transactions', 'wallets']);
    expect(Object.keys(MERGE_GROUPS).sort()).toEqual([...SYNC_TABLES].sort());
    expect(Object.keys(TABLE_SPECS).sort()).toEqual([...SYNC_TABLES].sort());
  });

  it.each(SYNC_TABLES)('%s: каждое синхронизируемое поле принадлежит ровно одной группе', (table) => {
    const audit = auditGroups(table);
    expect(audit.orphans, `поля без группы (добавьте в src/db/mergeGroups.ts): ${audit.orphans.join(', ')}`).toEqual([]);
    expect(audit.duplicated, `поля в двух группах: ${audit.duplicated.join(', ')}`).toEqual([]);
    expect(audit.unknown, `в группах поля, которых нет в TABLE_SPECS (или служебные): ${audit.unknown.join(', ')}`).toEqual([]);
  });

  it.each(SYNC_TABLES)('%s: объединение групп + SyncFields = все колонки договора, без лишних', (table) => {
    const fromSpec = TABLE_SPECS[table].columns.map((c) => c.field).sort();
    const fromGroups = [...mergedFields(table), ...NON_MERGED_FIELDS].sort();
    expect(fromGroups).toEqual(fromSpec);
  });

  it('служебные поля SyncFields в слиянии не участвуют', () => {
    expect(NON_MERGED_FIELDS).toEqual(['id', 'createdAt', 'clientUpdatedAt', 'deviceId']);
    for (const table of SYNC_TABLES) for (const f of NON_MERGED_FIELDS) expect(groupOfField(table, f)).toBeUndefined();
  });

  it('страж действительно краснеет: поле без группы и поле в двух группах находятся', () => {
    const spec = TABLE_SPECS.wallets;
    spec.columns.push({ field: 'newField', column: 'new_field', type: 'text' });
    try {
      expect(auditGroups('wallets').orphans).toEqual(['newField']);
    } finally {
      spec.columns.pop();
    }
    (MERGE_GROUPS.wallets as Record<string, readonly string[]>)['extra'] = ['name'];
    try {
      expect(auditGroups('wallets').duplicated).toEqual(['name']);
    } finally {
      delete (MERGE_GROUPS.wallets as Record<string, readonly string[]>)['extra'];
    }
    expect(auditGroups('wallets')).toEqual({ orphans: [], unknown: [], duplicated: [] });
  });
});

describe('состав групп (как в договоре задачи)', () => {
  it('transactions', () => {
    expect(MERGE_GROUPS.transactions).toEqual({
      money: ['kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'debtId', 'baseCurrency', 'baseAmountMinor', 'fxRate', 'fxSource', 'foreignCurrency', 'foreignAmountMinor'],
      date: ['occurredOn'],
      note: ['note'],
      origin: ['recurringRuleId'],
      deleted: ['deletedAt'],
    });
  });
  it('budgets', () => {
    expect(MERGE_GROUPS.budgets).toEqual({
      limit: ['amountMinor', 'currency', 'period'],
      target: ['categoryId'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('debts', () => {
    expect(MERGE_GROUPS.debts).toEqual({
      party: ['direction', 'counterparty'],
      amount: ['principalMinor', 'currency'],
      interest: ['interestMinor', 'interestRateBp', 'termMonths'],
      link: ['mergedIntoId'],
      category: ['category'],
      dates: ['openedOn', 'dueOn'],
      note: ['note'],
      closed: ['closedAt'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('recurring_rules', () => {
    expect(MERGE_GROUPS.recurring_rules).toEqual({
      money: ['kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'debtId'],
      schedule: ['frequency', 'intervalN', 'startOn', 'endOn'],
      mode: ['autoPost'],
      note: ['note'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('wallets', () => {
    expect(MERGE_GROUPS.wallets).toEqual({
      name: ['name'],
      money: ['currency', 'kind', 'openingBalanceMinor'],
      look: ['color', 'icon', 'sortOrder'],
      goal: ['goalMinor', 'goalOn'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('categories', () => {
    expect(MERGE_GROUPS.categories).toEqual({
      name: ['name'],
      kind: ['kind', 'parentId'],
      look: ['color', 'icon', 'sortOrder'],
      essential: ['essential'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('savings_goals', () => {
    expect(MERGE_GROUPS.savings_goals).toEqual({
      name: ['name'],
      target: ['targetMinor', 'currency'],
      due: ['dueOn'],
      wallet: ['walletId'],
      archived: ['archivedAt'],
      deleted: ['deletedAt'],
    });
  });
  it('shopping_items', () => {
    expect(MERGE_GROUPS.shopping_items).toEqual({
      name: ['name'],
      qty: ['qtyMilli', 'unit'],
      state: ['priceMinor', 'checkedAt', 'purchasedAt', 'transactionId'],
      deleted: ['deletedAt'],
    });
  });
  it('settings', () => {
    expect(MERGE_GROUPS.settings).toEqual({
      baseCurrency: ['baseCurrency'],
      week: ['weekStartsOn'],
      defaultWallet: ['defaultWalletId'],
      locale: ['locale'],
      weather: ['weather'],
      deleted: ['deletedAt'],
    });
  });
});

const BASE: Record<SyncTableName, Record<string, unknown>> = {
  transactions: {
    kind: 'expense', walletId: 'w1', toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: 'c1', occurredOn: '2026-10-05',
    note: 'n', baseCurrency: 'TJS', baseAmountMinor: 100, fxRate: 1, fxSource: 'same', debtId: null, recurringRuleId: null, foreignCurrency: null, foreignAmountMinor: null, deletedAt: null,
  },
  budgets: { categoryId: null, amountMinor: 100, currency: 'TJS', period: 'month', archivedAt: null, deletedAt: null },
  debts: {
    direction: 'lent', counterparty: 'Али', principalMinor: 100, interestMinor: null, interestRateBp: null, termMonths: null, mergedIntoId: null, category: '', currency: 'TJS',
    openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null, deletedAt: null,
  },
  recurring_rules: {
    kind: 'expense', walletId: 'w1', toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: null, debtId: null, note: '',
    frequency: 'monthly', intervalN: 1, startOn: '2026-10-01', endOn: null, autoPost: 0, archivedAt: null, deletedAt: null,
  },
  wallets: { name: 'N', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null, goalMinor: null, goalOn: null, deletedAt: null },
  categories: { name: 'N', kind: 'expense', parentId: null, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null, essential: 0, deletedAt: null },
  savings_goals: { name: 'Отпуск', targetMinor: 500_000, currency: 'TJS', dueOn: '2026-12-31', walletId: null, archivedAt: null, deletedAt: null },
  settings: { baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: null, weather: null, deletedAt: null },
  shopping_items: { name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: null, checkedAt: null, purchasedAt: null, transactionId: null, deletedAt: null },
};

/** Другое значение поля (для проверки, что именно эта группа заметила разницу). */
const bump = (v: unknown): unknown => (typeof v === 'number' ? v + 1 : v === null ? 'x' : `${String(v)}!`);

const cases = SYNC_TABLES.flatMap((table) => groupNames(table).map((group) => ({ table, group })));

describe.each(cases)('$table / $group', ({ table, group }) => {
  const fields = MERGE_GROUPS[table][group] as readonly string[];
  const a = BASE[table];

  it('изменение ЛЮБОГО поля группы видно ровно в этой группе', () => {
    for (const f of fields) {
      const b = { ...a, [f]: bump(a[f]) };
      expect(changedGroups(table, a, b), `поле ${f}`).toEqual([group]);
      expect(sameMergedFields(table, a, b)).toBe(false);
    }
  });

  it('слияние: группа в локальных — значения группы локальные, всё остальное серверное', () => {
    const local = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, bump(v)]));
    const merged = mergeByGroups(table, a, local, [group]);
    for (const k of mergedFields(table)) expect(merged[k], k).toEqual(fields.includes(k) ? local[k] : a[k]);
  });

  it('слияние: группа не в локальных — значения группы серверные', () => {
    const local = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, bump(v)]));
    const others = groupNames(table).filter((g) => g !== group);
    const merged = mergeByGroups(table, a, local, others);
    for (const f of fields) expect(merged[f], f).toEqual(a[f]);
  });

  it('группа берётся ЦЕЛИКОМ из одного источника (не смесь полей)', () => {
    const local = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, bump(v)]));
    const merged = mergeByGroups(table, a, local, [group]);
    const fromLocal = fields.map((f) => merged[f] === local[f]);
    expect(new Set(fromLocal).size).toBe(1);
  });
});

describe('вспомогательные', () => {
  it('одинаковые значения и null/undefined не считаются различием; -0 и 0 тоже', () => {
    expect(changedGroups('transactions', { toWalletId: null, fxRate: 0 }, { toWalletId: undefined, fxRate: -0 })).toEqual([]);
  });

  it('normalizeGroups: канонический порядок без повторов; чужое имя или не список → undefined', () => {
    expect(normalizeGroups('wallets', ['archived', 'name', 'name'])).toEqual(['name', 'archived']);
    expect(normalizeGroups('wallets', [])).toEqual([]);
    expect(normalizeGroups('wallets', ['name', 'зачем-то'])).toBeUndefined();
    expect(normalizeGroups('wallets', ['week'])).toBeUndefined(); // группа чужой таблицы
    expect(normalizeGroups('wallets', 'name')).toBeUndefined();
    expect(normalizeGroups('wallets', undefined)).toBeUndefined();
    expect(normalizeGroups('wallets', [1])).toBeUndefined();
  });

  it('unionGroups: объединение в каноническом порядке', () => {
    expect(unionGroups('transactions', ['deleted'], ['money', 'deleted'])).toEqual(['money', 'deleted']);
  });

  it('SyncFields и лишние ключи в слиянии игнорируются', () => {
    const merged = mergeByGroups('wallets', { ...BASE.wallets, id: 's', clientUpdatedAt: 'S' }, { ...BASE.wallets, name: 'L', id: 'l', clientUpdatedAt: 'L' }, ['name']);
    expect(Object.keys(merged).sort()).toEqual(mergedFields('wallets').sort());
    expect(merged['name']).toBe('L');
  });
});

describe('память о правках (dirtyBase)', () => {
  const entry = { b: { name: 'до' }, at: '2026-10-01T10:00:00.000Z' };

  it('readTracking: нет групп → undefined; непонятная память по группе отбрасывается, группа остаётся', () => {
    expect(readTracking('wallets', { dirtyGroups: undefined })).toBeUndefined();
    const t = readTracking('wallets', { dirtyGroups: ['name', 'look'], dirtyBase: { name: entry, look: { b: 5, at: 1 }, чужая: entry } });
    expect(t?.groups).toEqual(['name', 'look']);
    expect(Object.keys(t!.base)).toEqual(['name']);
  });

  it('withTracking: пустая память не оставляет следов (кроме явной отметки), память — только по группам из списка', () => {
    const row = { id: 'x', dirtyGroups: ['name'], dirtyBase: { name: entry } };
    expect(Object.keys(withTracking(row, undefined, false))).toEqual(['id']);
    expect(Object.keys(withTracking(row, { groups: ['name'], base: {} }, false))).toEqual(['id']);
    expect(withTracking(row, { groups: ['name'], base: {} }, true)).toMatchObject({ dirtyGroups: ['name'], dirtyBase: {} });
    const kept = withTracking({ id: 'x' }, { groups: ['look'], base: { name: entry, look: { ...entry, b: { color: 'a' } } } }, false);
    expect(Object.keys((kept as unknown as { dirtyBase: object }).dirtyBase)).toEqual(['look']);
  });

  it('markSent: помечает переданным и запоминает текущее значение; повтор того же значения его не множит; число значений ограничено', () => {
    let t: Tracking = { groups: ['name'], base: { name: entry } };
    t = markSent('wallets', t, { name: 'а' });
    t = markSent('wallets', t, { name: 'а' });
    expect(t.base.name).toMatchObject({ s: true, p: [{ name: 'а' }] });
    for (let i = 0; i < MAX_SENT + 3; i++) t = markSent('wallets', t, { name: `v${i}` });
    expect(t.base.name?.p).toHaveLength(MAX_SENT);
    expect(t.base.name?.p?.at(-1)).toEqual({ name: `v${MAX_SENT + 2}` });
  });

  it('needsRemoteMerge: правка существующей — да; созданная здесь и не правленная — нет; без групп (импорт) — нет', () => {
    expect(needsRemoteMerge('wallets', { dirtyGroups: ['name'], serverSeq: null })).toBe(true);
    expect(needsRemoteMerge('wallets', { dirtyGroups: [], serverSeq: null })).toBe(false);
    expect(needsRemoteMerge('wallets', { dirtyGroups: [], dirtyBase: {}, serverSeq: null })).toBe(true); // правили и вернули
    expect(needsRemoteMerge('wallets', { dirtyGroups: [], serverSeq: 3 })).toBe(true);
    expect(needsRemoteMerge('wallets', { serverSeq: 3 })).toBe(false);
  });
});
