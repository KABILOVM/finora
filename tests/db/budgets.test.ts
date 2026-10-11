import { describe, expect, it } from 'vitest';
import { defaultId, ValidationError } from '@/db';
import { basics, makeStore, USER_A } from './helpers';

/** Бюджеты: id детерминирован от категории, повторное создание обновляет, валюта = базовая валюта настроек. */

describe('BudgetsRepo.create', () => {
  it('создаёт общий лимит и лимит на категорию с детерминированным id; валюта — базовая', async () => {
    const store = await makeStore({ deviceId: 'device-b-1' });
    const { food } = await basics(store);
    const total = await store.budgets.create({ amountMinor: 500_000 });
    const byCat = await store.budgets.create({ categoryId: food.id, amountMinor: 120_000 });
    expect(total).toMatchObject({ categoryId: null, amountMinor: 500_000, currency: 'TJS', period: 'month', archivedAt: null, deletedAt: null, dirty: 1, serverSeq: null, deviceId: 'device-b-1' });
    expect(total.id).toBe(await defaultId(USER_A, 'budget:total'));
    expect(byCat.id).toBe(await defaultId(USER_A, `budget:${food.id}`));
    expect(byCat.dirtyGroups).toEqual([]);
    expect(await store.db.budgets.count()).toBe(2);
  });

  it('повторное создание лимита на ту же категорию ОБНОВЛЯЕТ существующий, а не плодит', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    const a = await store.budgets.create({ categoryId: food.id, amountMinor: 100_000 });
    const b = await store.budgets.create({ categoryId: food.id, amountMinor: 150_000 });
    expect(b.id).toBe(a.id);
    expect(b.amountMinor).toBe(150_000);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.clientUpdatedAt > a.clientUpdatedAt).toBe(true);
    expect(await store.db.budgets.count()).toBe(1);
  });

  it('повтор с тем же лимитом ничего не пишет (метка не сдвигается)', async () => {
    const store = await makeStore();
    await basics(store);
    const a = await store.budgets.create({ amountMinor: 100_000 });
    const b = await store.budgets.create({ amountMinor: 100_000 });
    expect(b.clientUpdatedAt).toBe(a.clientUpdatedAt);
  });

  it('параллельные создания одного бюджета: ровно одна строка', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    await Promise.all([1, 2, 3].map((i) => store.budgets.create({ categoryId: food.id, amountMinor: i * 1000 })));
    expect(await store.db.budgets.count()).toBe(1);
  });

  it('создание на ту же категорию возвращает бюджет из архива', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    const a = await store.budgets.create({ categoryId: food.id, amountMinor: 100_000 });
    await store.budgets.archive(a.id);
    const b = await store.budgets.create({ categoryId: food.id, amountMinor: 90_000 });
    expect(b).toMatchObject({ id: a.id, archivedAt: null, amountMinor: 90_000 });
  });

  it('валюта берётся из настроек в момент создания', async () => {
    const store = await makeStore();
    await basics(store);
    await store.settings.update({ baseCurrency: 'USD' });
    expect((await store.budgets.create({ amountMinor: 1000 })).currency).toBe('USD');
  });

  it.each([
    ['ноль', { amountMinor: 0 }, /больше нуля/],
    ['минус', { amountMinor: -5 }, /больше нуля/],
    ['дробь', { amountMinor: 10.5 }, /целое/],
    ['больше 1e15', { amountMinor: 1_000_000_000_000_001 }, /слишком велика/],
    ['текст', { amountMinor: '100' }, /целое/],
    ['лишнее поле', { amountMinor: 100, currency: 'USD' }, /менять нельзя/],
    ['не UUID в категории', { amountMinor: 100, categoryId: 'food' }, /UUID/],
  ])('отвергает: %s', async (_n, bad, re) => {
    const store = await makeStore();
    await basics(store);
    await expect(store.budgets.create(bad as never)).rejects.toThrow(re);
    expect(await store.db.budgets.count()).toBe(0);
  });

  it('граница 1e15 принимается', async () => {
    const store = await makeStore();
    await basics(store);
    expect((await store.budgets.create({ amountMinor: 1_000_000_000_000_000 })).amountMinor).toBe(1_000_000_000_000_000);
  });

  it('категория: должна существовать, быть расходной, живой и не в архиве', async () => {
    const store = await makeStore();
    const { food, salary } = await basics(store);
    await expect(store.budgets.create({ categoryId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', amountMinor: 100 })).rejects.toThrow(/не найдена/);
    await expect(store.budgets.create({ categoryId: salary.id, amountMinor: 100 })).rejects.toThrow(/для доходов/);
    await store.categories.archive(food.id);
    await expect(store.budgets.create({ categoryId: food.id, amountMinor: 100 })).rejects.toThrow(/в архиве/);
    expect(await store.db.budgets.count()).toBe(0);
  });

  it('без настроек (до первой загрузки) бюджет не создаётся', async () => {
    const store = await makeStore();
    await expect(store.budgets.create({ amountMinor: 100 })).rejects.toThrow(/Настройки ещё не созданы/);
  });
});

describe('BudgetsRepo.update / archive / restore', () => {
  it('update меняет только сумму и пересчитывает валюту по настройкам; те же данные — без записи', async () => {
    const store = await makeStore();
    await basics(store);
    const a = await store.budgets.create({ amountMinor: 100_000 });
    const same = await store.budgets.update(a.id, { amountMinor: 100_000 });
    expect(same.clientUpdatedAt).toBe(a.clientUpdatedAt);
    const b = await store.budgets.update(a.id, { amountMinor: 80_000 });
    expect(b).toMatchObject({ amountMinor: 80_000, dirty: 1 });
    expect(b.dirtyGroups).toEqual(['limit']);
    await expect(store.budgets.update(a.id, { categoryId: null } as never)).rejects.toThrow(/менять нельзя/);
    await expect(store.budgets.update(a.id, { amountMinor: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.budgets.update('нет', { amountMinor: 5 })).rejects.toThrow(/не найден/);
  });

  it('archive/restore: повтор безопасен, остальное не меняется', async () => {
    const store = await makeStore();
    await basics(store);
    const a = await store.budgets.create({ amountMinor: 100_000 });
    const arch = await store.budgets.archive(a.id);
    expect(arch.archivedAt).not.toBeNull();
    expect((await store.budgets.archive(a.id)).clientUpdatedAt).toBe(arch.clientUpdatedAt);
    const back = await store.budgets.restore(a.id);
    expect(back).toMatchObject({ archivedAt: null, amountMinor: 100_000 });
    expect((await store.budgets.restore(a.id)).clientUpdatedAt).toBe(back.clientUpdatedAt);
  });

  it('удалённый (на другом устройстве) бюджет нельзя править, но создание оживляет его', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    const a = await store.budgets.create({ categoryId: food.id, amountMinor: 100_000 });
    await store.db.budgets.put({ ...a, deletedAt: '2026-10-10T00:00:00.000Z' });
    await expect(store.budgets.update(a.id, { amountMinor: 1 })).rejects.toThrow(/удалён/);
    await expect(store.budgets.archive(a.id)).rejects.toThrow(/удалён/);
    const again = await store.budgets.create({ categoryId: food.id, amountMinor: 70_000 });
    expect(again).toMatchObject({ id: a.id, deletedAt: null, amountMinor: 70_000 });
  });

  it('вид категории с бюджетом менять нельзя', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    await store.budgets.create({ categoryId: food.id, amountMinor: 100 });
    await expect(store.categories.update(food.id, { kind: 'income' })).rejects.toThrow(/бюджет или регулярный платёж/);
  });
});
