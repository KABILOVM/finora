import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, ValidationError } from '@/db';
import { basics, makeStore, USER_A } from './helpers';

/** Цели накопления в «Бюджетах»: проверки репозитория, привязка к кошельку-накоплению, архив, удаление, резервная копия. */

const goal = { name: 'Отпуск', targetMinor: 500_000, dueOn: '2026-12-31' } as const;

async function withSavings(store: Awaited<ReturnType<typeof makeStore>>) {
  const b = await basics(store);
  const savings = await store.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#16a34a', icon: '🐷' });
  const savings2 = await store.wallets.create({ name: 'Копилка 2', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#16a34a', icon: '🐖' });
  const usdSavings = await store.wallets.create({ name: 'Копилка $', currency: 'USD', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' });
  return { ...b, savings, savings2, usdSavings };
}

describe('SavingsGoalsRepo.create', () => {
  it('создаёт цель: валюта — основная, dirty, без кошелька, строка совпадает с базой', async () => {
    const store = await makeStore({ deviceId: 'dev-g1' });
    await basics(store);
    const g = await store.savingsGoals.create({ ...goal, name: '  Отпуск ' });
    expect(g).toMatchObject({
      name: 'Отпуск', targetMinor: 500_000, currency: 'TJS', dueOn: '2026-12-31', walletId: null, archivedAt: null, deletedAt: null,
      dirty: 1, serverSeq: null, deviceId: 'dev-g1', dirtyGroups: [],
    });
    expect(await store.db.savings_goals.get(g.id)).toEqual(g);
  });

  it('валюта берётся из настроек в момент создания', async () => {
    const store = await makeStore();
    await basics(store);
    await store.settings.update({ baseCurrency: 'USD' });
    expect((await store.savingsGoals.create(goal)).currency).toBe('USD');
  });

  it('привязывается к кошельку-накоплению той же валюты', async () => {
    const store = await makeStore();
    const { savings } = await withSavings(store);
    const g = await store.savingsGoals.create({ ...goal, walletId: savings.id });
    expect(g.walletId).toBe(savings.id);
  });

  it.each([
    ['пустое название', { name: '  ' }, /Название/],
    ['название 61 символ', { name: 'я'.repeat(61) }, /Название/],
    ['сумма 0', { targetMinor: 0 }, /Сумма цели/],
    ['отрицательная сумма', { targetMinor: -5 }, /Сумма цели/],
    ['дробная сумма', { targetMinor: 1.5 }, /Сумма цели/],
    ['сумма больше предела', { targetMinor: 1_000_000_000_000_001 }, /Сумма цели/],
    ['срок не дата', { dueOn: '2026-02-31' }, /Срок цели/],
    ['срок раньше 2000 года', { dueOn: '1999-12-31' }, /Срок цели/],
    ['срок позже 2100 года', { dueOn: '2100-01-02' }, /Срок цели/],
    ['срок не задан', { dueOn: undefined }, /Срок цели/],
    ['служебное поле', { currency: 'USD' }, /менять нельзя/],
    ['архивация при создании', { archivedAt: '2026-10-10T10:00:00.000Z' }, /менять нельзя/],
  ])('отвергает: %s', async (_n, bad, msg) => {
    const store = await makeStore();
    await basics(store);
    await expect(store.savingsGoals.create({ ...goal, ...bad } as never)).rejects.toThrow(msg);
    expect(await store.db.savings_goals.count()).toBe(0);
  });

  it('без настроек (до первой загрузки) цель не создаётся', async () => {
    const store = await makeStore();
    await expect(store.savingsGoals.create(goal)).rejects.toThrow(/Настройки ещё не созданы/);
  });

  it.each([
    ['кошелька нет', () => 'no-such-wallet', /не найден/],
    ['кошелёк не «Накопления»', (w: Awaited<ReturnType<typeof withSavings>>) => w.cash.id, /только к кошельку вида «Накопления»/],
    ['кошелёк в другой валюте', (w: Awaited<ReturnType<typeof withSavings>>) => w.usdSavings.id, /в USD, а цель в TJS/],
  ])('кошелёк цели: %s — отказ', async (_n, pick, msg) => {
    const store = await makeStore();
    const w = await withSavings(store);
    await expect(store.savingsGoals.create({ ...goal, walletId: pick(w as never) })).rejects.toThrow(msg);
    expect(await store.db.savings_goals.count()).toBe(0);
  });

  it('кошелёк в архиве или удалённый не подходит', async () => {
    const store = await makeStore();
    const { savings, savings2 } = await withSavings(store);
    await store.wallets.archive(savings.id);
    await expect(store.savingsGoals.create({ ...goal, walletId: savings.id })).rejects.toThrow(/в архиве/);
    await store.db.wallets.update(savings2.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    await expect(store.savingsGoals.create({ ...goal, walletId: savings2.id })).rejects.toThrow(/не найден/);
  });

  it('один кошелёк — одна действующая цель; после архива или удаления первой кошелёк свободен', async () => {
    const store = await makeStore();
    const { savings } = await withSavings(store);
    const first = await store.savingsGoals.create({ ...goal, walletId: savings.id });
    await expect(store.savingsGoals.create({ ...goal, name: 'Ноутбук', walletId: savings.id })).rejects.toThrow(/уже занят целью «Отпуск»/);
    await store.savingsGoals.archive(first.id);
    const second = await store.savingsGoals.create({ ...goal, name: 'Ноутбук', walletId: savings.id });
    await store.savingsGoals.remove(second.id);
    expect((await store.savingsGoals.create({ ...goal, name: 'Машина', walletId: savings.id })).walletId).toBe(savings.id);
  });
});

describe('SavingsGoalsRepo.update', () => {
  it('меняет название, сумму и срок; без изменений — ничего не пишет; группы слияния запоминаются', async () => {
    const store = await makeStore();
    await basics(store);
    const g = await store.savingsGoals.create(goal);
    const u = await store.savingsGoals.update(g.id, { name: 'Отпуск в Дубае', targetMinor: 700_000, dueOn: '2027-03-01' });
    expect(u).toMatchObject({ name: 'Отпуск в Дубае', targetMinor: 700_000, dueOn: '2027-03-01', currency: 'TJS', dirty: 1 });
    expect(u.clientUpdatedAt > g.clientUpdatedAt).toBe(true);
    expect(u.dirtyGroups).toEqual(['name', 'target', 'due']);
    const same = await store.savingsGoals.update(g.id, { name: 'Отпуск в Дубае' });
    expect(same.clientUpdatedAt).toBe(u.clientUpdatedAt);
  });

  it('новая сумма вводится в сегодняшней основной валюте, а правка названия валюту не трогает', async () => {
    const store = await makeStore();
    await basics(store);
    const g = await store.savingsGoals.create(goal);
    await store.settings.update({ baseCurrency: 'USD' });
    expect((await store.savingsGoals.update(g.id, { name: 'Отпуск 2' })).currency).toBe('TJS');
    expect((await store.savingsGoals.update(g.id, { targetMinor: 1_000 })).currency).toBe('USD');
  });

  it('привязка и отвязка кошелька; чужой вид и занятый кошелёк — отказ', async () => {
    const store = await makeStore();
    const { savings, savings2, cash } = await withSavings(store);
    const g = await store.savingsGoals.create(goal);
    const other = await store.savingsGoals.create({ ...goal, name: 'Ноутбук', walletId: savings2.id });
    const bound = await store.savingsGoals.update(g.id, { walletId: savings.id });
    expect(bound.walletId).toBe(savings.id);
    expect(bound.dirtyGroups).toEqual(['wallet']);
    await expect(store.savingsGoals.update(g.id, { walletId: cash.id })).rejects.toThrow(/Накопления/);
    await expect(store.savingsGoals.update(g.id, { walletId: other.walletId })).rejects.toThrow(/уже занят/);
    const unbound = await store.savingsGoals.update(g.id, { walletId: null });
    expect(unbound.walletId).toBeNull();
    expect(unbound.dirtyGroups).toEqual([]); // привязали и отвязали до отправки = ничего не менялось
  });

  it('несуществующая и удалённая цели: понятная ошибка', async () => {
    const store = await makeStore();
    await basics(store);
    await expect(store.savingsGoals.update('no-such-goal', { name: 'X' })).rejects.toThrow(/не найдена/);
    const g = await store.savingsGoals.create(goal);
    await store.savingsGoals.remove(g.id);
    await expect(store.savingsGoals.update(g.id, { name: 'X' })).rejects.toThrow(/удалена/);
  });

  it('лишние поля менять нельзя', async () => {
    const store = await makeStore();
    await basics(store);
    const g = await store.savingsGoals.create(goal);
    await expect(store.savingsGoals.update(g.id, { archivedAt: '2026-10-10T10:00:00.000Z' } as never)).rejects.toThrow(ValidationError);
    await expect(store.savingsGoals.update(g.id, { id: 'x' } as never)).rejects.toThrow(/менять нельзя/);
  });
});

describe('SavingsGoalsRepo: архив, возврат, удаление', () => {
  it('archive: повтор безопасен; restore возвращает; метка движется только при настоящей правке', async () => {
    const store = await makeStore();
    await basics(store);
    const g = await store.savingsGoals.create(goal);
    const a = await store.savingsGoals.archive(g.id);
    expect(a.archivedAt).not.toBeNull();
    expect((await store.savingsGoals.archive(g.id)).clientUpdatedAt).toBe(a.clientUpdatedAt);
    const r = await store.savingsGoals.restore(g.id);
    expect(r.archivedAt).toBeNull();
    expect((await store.savingsGoals.restore(g.id)).clientUpdatedAt).toBe(r.clientUpdatedAt);
  });

  it('remove: строка остаётся с deletedAt, повтор безопасен, restore отменяет удаление', async () => {
    const store = await makeStore();
    await basics(store);
    const g = await store.savingsGoals.create(goal);
    const d = await store.savingsGoals.remove(g.id);
    expect(d.deletedAt).not.toBeNull();
    expect(await store.db.savings_goals.count()).toBe(1);
    expect((await store.savingsGoals.remove(g.id)).clientUpdatedAt).toBe(d.clientUpdatedAt);
    const back = await store.savingsGoals.restore(g.id);
    expect(back).toMatchObject({ deletedAt: null, archivedAt: null, name: 'Отпуск' });
  });

  it('restore: кошелёк, занятый за это время другой целью, — понятный отказ, цель остаётся в архиве', async () => {
    const store = await makeStore();
    const { savings } = await withSavings(store);
    const first = await store.savingsGoals.create({ ...goal, walletId: savings.id });
    await store.savingsGoals.archive(first.id);
    await store.savingsGoals.create({ ...goal, name: 'Ноутбук', walletId: savings.id });
    await expect(store.savingsGoals.restore(first.id)).rejects.toThrow(/Не удалось вернуть цель «Отпуск».*Выберите другой кошелёк/);
    expect((await store.db.savings_goals.get(first.id))?.archivedAt).not.toBeNull();
  });
});

describe('кошелёк, к которому привязана цель', () => {
  it('нельзя сменить вид или валюту, пока цель действует; после архива цели — можно', async () => {
    const store = await makeStore();
    const { savings } = await withSavings(store);
    const g = await store.savingsGoals.create({ ...goal, walletId: savings.id });
    await expect(store.wallets.update(savings.id, { kind: 'cash' })).rejects.toThrow(/привязан к цели «Отпуск»/);
    await expect(store.wallets.update(savings.id, { currency: 'USD' })).rejects.toThrow(/привязан к цели/);
    expect((await store.wallets.update(savings.id, { name: 'Новая копилка' })).name).toBe('Новая копилка'); // переименовать можно
    await store.savingsGoals.archive(g.id);
    expect((await store.wallets.update(savings.id, { kind: 'cash' })).kind).toBe('cash');
  });
});

describe('резервная копия', () => {
  it('цели попадают в экспорт и возвращаются импортом; старый файл без блока читается как «целей нет»', async () => {
    const a = await makeStore({ deviceId: 'dev-a' });
    const { savings } = await withSavings(a);
    const g = await a.savingsGoals.create({ ...goal, walletId: savings.id });
    const archived = await a.savingsGoals.create({ ...goal, name: 'Старая' });
    await a.savingsGoals.archive(archived.id);
    const file = await exportBackup(a);
    expect(file.savingsGoals.map((x) => x.id).sort()).toEqual([g.id, archived.id].sort());

    const b = await makeStore({ deviceId: 'dev-b' });
    await b.settings.ensure({ baseCurrency: 'TJS' });
    await importBackup(b, JSON.parse(JSON.stringify(file)));
    expect(await b.db.savings_goals.get(g.id)).toMatchObject({ name: 'Отпуск', walletId: savings.id, dirty: 1 });
    expect((await b.db.savings_goals.get(archived.id))?.archivedAt).not.toBeNull();
    const again = await importBackup(b, JSON.parse(JSON.stringify(file)));
    expect(again).toMatchObject({ added: 0, replaced: 0 }); // повторный импорт ничего не меняет

    const old = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
    delete old['savingsGoals'];
    const c = await makeStore({ deviceId: 'dev-c' });
    await c.settings.ensure({ baseCurrency: 'TJS' });
    await importBackup(c, old);
    expect(await c.db.savings_goals.count()).toBe(0);
  });

  it('цель с несуществующим кошельком и цель-дубль id отвергаются целиком', async () => {
    const a = await makeStore({ deviceId: 'dev-a' });
    const { savings } = await withSavings(a);
    await a.savingsGoals.create({ ...goal, walletId: savings.id });
    const file = JSON.parse(JSON.stringify(await exportBackup(a))) as { wallets: { id: string }[]; savingsGoals: { id: string; walletId: string | null }[] };
    const b = await makeStore({ deviceId: 'dev-b' });
    await b.settings.ensure({ baseCurrency: 'TJS' });
    const noWallet = JSON.parse(JSON.stringify(file)) as typeof file;
    noWallet.wallets = noWallet.wallets.filter((w) => w.id !== savings.id);
    await expect(importBackup(b, noWallet)).rejects.toThrow(/ссылается на несуществующий кошелёк/);
    const dup = JSON.parse(JSON.stringify(file)) as typeof file;
    dup.savingsGoals.push({ ...dup.savingsGoals[0]! });
    await expect(importBackup(b, dup)).rejects.toThrow(/повторяющийся идентификатор/);
    expect(await b.db.savings_goals.count()).toBe(0);
  });

  it('чужая копия (без блока настроек): у целей свои id и кошелёк пересчитан вместе с кошельком', async () => {
    const a = await makeStore({ deviceId: 'dev-a', userId: USER_A });
    const { savings } = await withSavings(a);
    const g = await a.savingsGoals.create({ ...goal, walletId: savings.id });
    const file = JSON.parse(JSON.stringify(await exportBackup(a))) as { settings: unknown };
    file.settings = null;
    const b = await makeStore({ deviceId: 'dev-b', userId: '33333333-3333-4333-8333-333333333333' });
    await b.settings.ensure({ baseCurrency: 'TJS' });
    await importBackup(b, file);
    const [row] = await b.db.savings_goals.toArray();
    expect(row).toBeDefined();
    expect(row!.id).not.toBe(g.id);
    expect(row!.walletId).not.toBe(savings.id);
    expect((await b.db.wallets.get(row!.walletId!))?.name).toBe('Копилка');
  });
});
