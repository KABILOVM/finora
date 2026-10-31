import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { basics, expense, makeStore } from './helpers';

const base = { name: 'Кафе', kind: 'expense', color: '#f97316', icon: '☕' } as const;

describe('CategoriesRepo', () => {
  it('создаёт категорию: dirty, без родителя, порядок растёт', async () => {
    const store = await makeStore();
    const a = await store.categories.create(base);
    const b = await store.categories.create({ ...base, name: 'Такси' });
    expect(a).toMatchObject({ ...base, parentId: null, dirty: 1, syncError: null, archivedAt: null, deletedAt: null });
    expect(b.sortOrder).toBe(a.sortOrder + 1);
  });

  it.each([
    ['пустое название', { name: ' ' }],
    ['длинное название', { name: 'x'.repeat(61) }],
    ['вид transfer', { kind: 'transfer' }],
    ['вид не задан', { kind: undefined }],
    ['родитель не строка', { parentId: 5 }],
    ['лишнее поле', { sortOrder: 3, deviceId: 'x' }],
  ])('отвергает: %s', async (_n, bad) => {
    const store = await makeStore();
    await expect(store.categories.create({ ...base, ...bad } as never)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.categories.count()).toBe(0);
  });

  it('подкатегория: родитель обязан существовать и быть того же вида', async () => {
    const store = await makeStore();
    const parent = await store.categories.create(base);
    const child = await store.categories.create({ ...base, name: 'Кофе', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    await expect(store.categories.create({ ...base, name: 'Х', parentId: 'no-such-id' })).rejects.toThrow(/не найдена/);
    await expect(store.categories.create({ ...base, name: 'Доход', kind: 'income', parentId: parent.id })).rejects.toThrow(/того же вида/);
  });

  it('категорию с удалённым (на другом устройстве) родителем можно переименовать и архивировать', async () => {
    const store = await makeStore();
    const parent = await store.categories.create(base);
    const child = await store.categories.create({ ...base, name: 'Кофе', parentId: parent.id });
    await store.db.categories.update(parent.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    expect((await store.categories.update(child.id, { name: 'Кофейня' })).name).toBe('Кофейня');
    expect((await store.categories.archive(child.id)).archivedAt).not.toBeNull();
    const other = await store.categories.create({ ...base, name: 'Другая' });
    await expect(store.categories.update(other.id, { parentId: parent.id })).rejects.toThrow(/удалена/);
  });

  it('цикл родителей невозможен', async () => {
    const store = await makeStore();
    const a = await store.categories.create(base);
    const b = await store.categories.create({ ...base, name: 'B', parentId: a.id });
    const c = await store.categories.create({ ...base, name: 'C', parentId: b.id });
    await expect(store.categories.update(a.id, { parentId: c.id })).rejects.toThrow(/цикл/);
    await expect(store.categories.update(a.id, { parentId: a.id })).rejects.toThrow(/самой себе/);
  });

  it('вид можно менять, пока нет операций', async () => {
    const store = await makeStore();
    const c = await store.categories.create(base);
    expect((await store.categories.update(c.id, { kind: 'income' })).kind).toBe('income');
  });

  it('вид нельзя менять при живых операциях', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    await expense(store, cash.id, 500, { categoryId: food.id });
    await expect(store.categories.update(food.id, { kind: 'income' })).rejects.toThrow(/менять вид/);
  });

  it('вид можно менять, если операции по категории все удалены; восстановление такой операции затем запрещено', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    const t = await expense(store, cash.id, 500, { categoryId: food.id });
    await store.transactions.softDelete(t.id);
    await store.categories.update(food.id, { kind: 'income' });
    await expect(store.transactions.restore(t.id)).rejects.toThrow(/не подходит/);
  });

  it('вид нельзя менять у категории с подкатегориями', async () => {
    const store = await makeStore();
    const p = await store.categories.create(base);
    await store.categories.create({ ...base, name: 'Дочерняя', parentId: p.id });
    await expect(store.categories.update(p.id, { kind: 'income' })).rejects.toThrow(/подкатегории/);
  });

  it('архив/возврат; правка снимает карантин', async () => {
    const store = await makeStore();
    const c = await store.categories.create(base);
    const a = await store.categories.archive(c.id);
    expect(a.archivedAt).not.toBeNull();
    expect((await store.categories.restore(c.id)).archivedAt).toBeNull();
    await store.sync.quarantine('categories', [c.id], 'ошибка');
    const u = await store.categories.update(c.id, { name: 'Новое имя' });
    expect(u.syncError).toBeNull();
  });
});

describe('CategoriesRepo: «обязательная» категория (essential)', () => {
  it('по умолчанию 0; создаётся обязательной; только у расходных', async () => {
    const store = await makeStore();
    const plain = await store.categories.create(base);
    expect(plain.essential).toBe(0);
    const rent = await store.categories.create({ ...base, name: 'Аренда', essential: true });
    expect(rent).toMatchObject({ essential: 1, dirty: 1 });
    await expect(store.categories.create({ name: 'Зарплата', kind: 'income', color: '#16a34a', icon: '💼', essential: true })).rejects.toThrow(/только категорию расходов/);
    const income = await store.categories.create({ name: 'Зарплата', kind: 'income', color: '#16a34a', icon: '💼', essential: false });
    expect(income.essential).toBe(0);
  });

  it('setEssential: ставит и снимает, повтор безопасен, у доходной — отказ; группа слияния отдельная', async () => {
    const store = await makeStore();
    const c = await store.categories.create(base);
    const on = await store.categories.setEssential(c.id, true);
    expect(on).toMatchObject({ essential: 1, dirtyGroups: ['essential'] });
    expect((await store.categories.setEssential(c.id, true)).clientUpdatedAt).toBe(on.clientUpdatedAt);
    const off = await store.categories.setEssential(c.id, false);
    expect(off).toMatchObject({ essential: 0, dirtyGroups: [] }); // поставили и сняли до отправки = ничего не менялось
    const income = await store.categories.create({ name: 'Подарки', kind: 'income', color: '#f43f5e', icon: '🎁' });
    await expect(store.categories.setEssential(income.id, true)).rejects.toThrow(/только категорию расходов/);
    await expect(store.categories.setEssential(c.id, 1 as never)).rejects.toThrow(ValidationError);
  });

  it('update: меняет отметку вместе с другими полями; смена вида на доходный снимает отметку; true у доходной — отказ', async () => {
    const store = await makeStore();
    const c = await store.categories.create({ ...base, essential: true });
    expect((await store.categories.update(c.id, { name: 'Кофе' })).essential).toBe(1); // отметка при правке имени сохраняется
    expect((await store.categories.update(c.id, { essential: false })).essential).toBe(0);
    const again = await store.categories.update(c.id, { essential: true });
    expect(again.essential).toBe(1);
    expect(await store.categories.update(c.id, { kind: 'income' })).toMatchObject({ kind: 'income', essential: 0 });
    await expect(store.categories.update(c.id, { essential: true })).rejects.toThrow(/только категорию расходов/);
  });

  it('стартовый набор: жильё, связь и долги обязательные, остальное нет', async () => {
    const store = await makeStore();
    const { ensureSeeded } = await import('@/db');
    await ensureSeeded(store);
    const essential = (await store.db.categories.toArray()).filter((c) => c.essential === 1).map((c) => c.name).sort();
    expect(essential).toEqual(['Долги', 'Жильё', 'Связь']);
    expect((await store.db.categories.toArray()).every((c) => c.kind === 'expense' || c.essential === 0)).toBe(true);
  });
});
