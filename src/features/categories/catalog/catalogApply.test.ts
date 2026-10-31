import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultId, ensureSeeded, openStore, ValidationError, type Store } from '@/db';
import { applyCatalog, applyText } from './catalogApply';
import { childSlug, groupSlug, CATALOG } from './catalogData';
import { defaultSelection, planCatalog, toggleGroup, type CatalogPlan, type ExistingCategory } from './catalogPlan';

const opened: Store[] = [];
afterEach(() => {
  while (opened.length) opened.pop()?.close();
});
async function newStore(userId = 'user-catalog', factory = new IDBFactory()): Promise<Store> {
  const s = await openStore(userId, { deviceId: `dev-${Math.random()}`, dexie: { indexedDB: factory, IDBKeyRange } });
  opened.push(s);
  return s;
}

async function planFor(store: Store): Promise<CatalogPlan> {
  const rows = await store.db.categories.toArray();
  const existing: ExistingCategory[] = rows
    .filter((c) => c.deletedAt === null)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, archived: c.archivedAt !== null, color: c.color }));
  return planCatalog(existing);
}

const live = async (store: Store) => (await store.db.categories.toArray()).filter((c) => c.deletedAt === null);
const byName = (rows: Awaited<ReturnType<typeof live>>, name: string, kind = 'expense') => rows.find((c) => c.name === name && c.kind === kind);

describe('applyCatalog', () => {
  it('новый человек со стартовыми категориями: «Коммунальные услуги» создаются со всем составом, «Продукты» пополняются', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const before = await live(store);
    const plan = await planFor(store);
    const result = await applyCatalog(store, plan, defaultSelection(plan));
    const rows = await live(store);

    const util = byName(rows, 'Коммунальные услуги')!;
    expect(util.parentId).toBeNull();
    expect(util.essential).toBe(1);
    const kids = rows.filter((c) => c.parentId === util.id).map((c) => c.name);
    expect(kids).toEqual(expect.arrayContaining(['Электричество', 'Вода', 'Газ', 'Отопление', 'Вывоз мусора']));

    const groceries = byName(rows, 'Продукты')!;
    expect(groceries.id).toBe(before.find((c) => c.name === 'Продукты')!.id); // стартовая, не копия
    expect(rows.filter((c) => c.parentId === groceries.id).map((c) => c.name)).toEqual(expect.arrayContaining(['Мясо и птица', 'Овощи и фрукты']));

    const family = byName(rows, 'Семья')!;
    expect(rows.filter((c) => c.parentId === family.id).map((c) => c.name)).toEqual(expect.arrayContaining(['Супруг(а)', 'Дети']));

    expect(result.created).toBe(rows.length - before.length);
    expect(result.moved).toBe(0);
    // подкатегории берут цвет родителя
    for (const c of rows.filter((x) => x.parentId === util.id)) expect(c.color).toBe(util.color);
    // значки — встроенные иконки приложения
    expect(util.icon).toBe('i:bulb');
  });

  it('категории человека переносятся под нужного родителя, их названия, цвета и операции не меняются', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const wallet = (await store.db.wallets.toArray())[0]!;
    const light = await store.categories.create({ name: 'Свет', kind: 'expense', color: '#abcdef', icon: '💡' });
    const wife = await store.categories.create({ name: 'Жена', kind: 'expense', color: '#fedcba', icon: '👩' });
    await store.categories.create({ name: 'Коммуналка', kind: 'expense', color: '#111111', icon: '🏠' });
    const tx = await store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 5000, occurredOn: '2026-10-01', categoryId: light.id });

    const plan = await planFor(store);
    const result = await applyCatalog(store, plan, defaultSelection(plan));
    const rows = await live(store);
    const komm = byName(rows, 'Коммуналка')!;
    const nowLight = rows.find((c) => c.id === light.id)!;
    const nowWife = rows.find((c) => c.id === wife.id)!;
    expect(nowLight).toMatchObject({ name: 'Свет', parentId: komm.id, color: '#abcdef' });
    expect(nowWife).toMatchObject({ name: 'Жена', color: '#fedcba' });
    expect(nowWife.parentId).toBe(byName(rows, 'Семья')!.id);
    expect(result.moved).toBe(2);
    expect(byName(rows, 'Коммунальные услуги')).toBeUndefined(); // «Коммуналка» — уже она, второй не заводим
    expect((await store.db.transactions.get(tx.id))!.categoryId).toBe(light.id);
  });

  it('повторный вызов ничего не дублирует', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const plan = await planFor(store);
    await applyCatalog(store, plan, defaultSelection(plan));
    const count = (await live(store)).length;
    const again = await applyCatalog(store, plan, defaultSelection(plan)); // тот же план, ничего не пересчитано
    expect(again).toEqual({ created: 0, moved: 0, restored: 0 });
    expect((await live(store)).length).toBe(count);
    const replanned = await planFor(store);
    const second = await applyCatalog(store, replanned, defaultSelection(replanned));
    expect(second.created + second.moved).toBe(0);
    expect((await live(store)).length).toBe(count);
  });

  it('снятые галочки не создаются; подкатегории без родителя пропускаются', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const plan = await planFor(store);
    const util = plan.groups.find((g) => g.group.slug === 'utilities')!;
    const chosen = defaultSelection(plan);
    chosen.delete(util.key); // родитель снят, подкатегории остались отмеченными
    await applyCatalog(store, plan, chosen);
    const rows = await live(store);
    expect(byName(rows, 'Коммунальные услуги')).toBeUndefined();
    expect(byName(rows, 'Электричество')).toBeUndefined();
    expect(byName(rows, 'Продукты')).toBeDefined();

    const only = new Set<string>();
    const travel = plan.groups.find((g) => g.group.slug === 'travel')!;
    for (const k of toggleGroup(travel, only)) only.add(k);
    only.delete(travel.children[0]!.key);
    await applyCatalog(store, plan, only);
    const after = await live(store);
    expect(byName(after, 'Путешествия')).toBeDefined();
    expect(byName(after, travel.children[0]!.child.name)).toBeUndefined();
    expect(byName(after, travel.children[1]!.child.name)).toBeDefined();
  });

  it('родитель из архива возвращается вместе с выбранными подкатегориями', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const groceries = byName(await live(store), 'Продукты')!;
    await store.categories.archive(groceries.id);
    const plan = await planFor(store);
    const result = await applyCatalog(store, plan, defaultSelection(plan));
    expect(result.restored).toBe(1);
    const rows = await live(store);
    expect(rows.find((c) => c.id === groceries.id)!.archivedAt).toBeNull();
    expect(rows.some((c) => c.parentId === groceries.id)).toBe(true);
  });

  it('два устройства одного человека создают одни и те же строки (id от пользователя и вечного slug)', async () => {
    const phone = await newStore('same-user');
    const laptop = await newStore('same-user');
    await ensureSeeded(phone);
    await ensureSeeded(laptop);
    for (const s of [phone, laptop]) {
      const plan = await planFor(s);
      await applyCatalog(s, plan, defaultSelection(plan));
    }
    const ids = async (s: Store) => (await live(s)).map((c) => c.id).sort();
    expect(await ids(phone)).toEqual(await ids(laptop));
    const util = CATALOG.find((g) => g.slug === 'utilities')!;
    expect(byName(await live(phone), 'Коммунальные услуги')!.id).toBe(await defaultId('same-user', groupSlug(util)));
    expect(byName(await live(phone), 'Вода')!.id).toBe(await defaultId('same-user', childSlug(util, util.children[1]!)));
  });

  it('если id занят удалённой строкой, категория заводится с новым id, а не падает', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const util = CATALOG.find((g) => g.slug === 'utilities')!;
    const id = await defaultId(store.userId, groupSlug(util));
    await store.categories.create({ name: 'Коммунальные услуги', kind: 'expense', color: '#ca8a04', icon: '💡' }, { id });
    // имитируем «надгробие»: строка удалена (след синхронизации)
    await store.db.categories.update(id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const plan = await planFor(store);
    await applyCatalog(store, plan, defaultSelection(plan));
    const rows = await live(store);
    const created = byName(rows, 'Коммунальные услуги')!;
    expect(created.id).not.toBe(id);
    expect(rows.filter((c) => c.parentId === created.id).length).toBeGreaterThan(3);
  });

  it('сбой посреди записи откатывает всё: ни одной новой категории и ни одного переноса', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const light = await store.categories.create({ name: 'Свет', kind: 'expense', color: '#abcdef', icon: '💡' });
    const before = JSON.stringify(await store.db.categories.orderBy('id').toArray());
    const plan = await planFor(store);
    const real = store.categories.create.bind(store.categories);
    let calls = 0;
    const spy = vi.spyOn(store.categories, 'create').mockImplementation(async (...args) => {
      if (++calls === 8) throw new ValidationError('сбой посреди записи');
      return real(...args);
    });
    await expect(applyCatalog(store, plan, defaultSelection(plan))).rejects.toThrow(/сбой посреди/);
    spy.mockRestore();
    expect(JSON.stringify(await store.db.categories.orderBy('id').toArray())).toBe(before);
    expect((await store.db.categories.get(light.id))!.parentId).toBeNull();
  });

  it('доходные группы заводятся доходными и без «обязательной» отметки', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const plan = await planFor(store);
    const income = new Set<string>();
    for (const g of plan.groups.filter((x) => x.group.kind === 'income')) for (const k of toggleGroup(g, new Set())) income.add(k);
    await applyCatalog(store, plan, income);
    const rows = (await live(store)).filter((c) => c.kind === 'income');
    expect(byName(rows, 'Пенсии и пособия', 'income')).toBeDefined();
    expect(rows.every((c) => c.essential === 0)).toBe(true);
    expect(rows.filter((c) => c.parentId !== null).every((c) => rows.some((p) => p.id === c.parentId && p.kind === 'income'))).toBe(true);
  });

  it('отметка «обязательная» ставится на аренду и коммунальные, но не на остальные', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const plan = await planFor(store);
    await applyCatalog(store, plan, defaultSelection(plan));
    const rows = await live(store);
    expect(byName(rows, 'Аренда жилья')!.essential).toBe(1);
    expect(byName(rows, 'Электричество')!.essential).toBe(1);
    expect(byName(rows, 'Мясо и птица')!.essential).toBe(0);
  });

  it('помечает локальное изменение: синхронизатор отправит новые строки', async () => {
    const store = await newStore();
    await ensureSeeded(store);
    const seen = vi.fn();
    store.onLocalChange(seen);
    const plan = await planFor(store);
    await applyCatalog(store, plan, defaultSelection(plan));
    expect(seen).toHaveBeenCalled();
    expect((await live(store)).every((c) => c.dirty === 1)).toBe(true);
  });
});

describe('applyText', () => {
  it('говорит словами, что сделано', () => {
    expect(applyText({ created: 1, moved: 0, restored: 0 })).toBe('Добавлено 1 категория');
    expect(applyText({ created: 12, moved: 3, restored: 0 })).toBe('Добавлено 12 категорий, перенесено 3');
    expect(applyText({ created: 0, moved: 2, restored: 1 })).toBe('Перенесено 2, возвращено из архива 1');
    expect(applyText({ created: 0, moved: 0, restored: 0 })).toBe('Ничего не изменилось');
  });
});
