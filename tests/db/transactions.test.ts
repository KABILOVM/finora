import { describe, expect, it } from 'vitest';
import { FxRequiredError, ValidationError } from '@/db';
import { basics, expense, makeStore } from './helpers';

const day = '2026-10-05';

async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  return { store, ...b };
}

describe('TransactionsRepo.create — норма', () => {
  it('расход в валюте, равной базовой: снимок «same», курс 1', async () => {
    const { store, cash, food } = await setup();
    const t = await store.transactions.create({
      kind: 'expense', walletId: cash.id, amountMinor: 12_345, categoryId: food.id, occurredOn: day, note: '  обед  ',
    });
    expect(t).toMatchObject({
      kind: 'expense', walletId: cash.id, toWalletId: null, toAmountMinor: null, amountMinor: 12_345, categoryId: food.id,
      occurredOn: day, note: 'обед', baseCurrency: 'TJS', baseAmountMinor: 12_345, fxRate: 1, fxSource: 'same',
      dirty: 1, syncError: null, deletedAt: null, serverSeq: null,
    });
    expect(await store.db.transactions.get(t.id)).toEqual(t);
  });

  it('доход без категории допустим; заметка по умолчанию пустая', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1, occurredOn: day });
    expect(t.categoryId).toBeNull();
    expect(t.note).toBe('');
  });

  it('заметка ровно 500 символов — можно; максимальная допустимая сумма (1e15, граница сервера) — можно', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.create({
      kind: 'income', walletId: cash.id, amountMinor: 1_000_000_000_000_000, occurredOn: day, note: 'я'.repeat(500),
    });
    expect(t.note).toHaveLength(500);
    expect(t.amountMinor).toBe(1_000_000_000_000_000);
  });

  it('29 февраля високосного года — настоящая дата', async () => {
    const { store, cash } = await setup();
    expect((await expense(store, cash.id, 100, { occurredOn: '2028-02-29' })).occurredOn).toBe('2028-02-29');
  });
});

describe('TransactionsRepo.create — нарушения', () => {
  it.each([
    ['нулевая сумма', { amountMinor: 0 }],
    ['отрицательная сумма', { amountMinor: -5 }],
    ['дробная сумма', { amountMinor: 10.5 }],
    ['сумма NaN', { amountMinor: Number.NaN }],
    ['сумма Infinity', { amountMinor: Infinity }],
    ['сумма за пределом безопасных целых', { amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['сумма текстом', { amountMinor: '100' }],
    ['31 февраля', { occurredOn: '2026-02-31' }],
    ['29 февраля невисокосного года', { occurredOn: '2026-02-29' }],
    ['13-й месяц', { occurredOn: '2026-13-01' }],
    ['дата без нулей', { occurredOn: '2026-1-1' }],
    ['дата словами', { occurredOn: 'вчера' }],
    ['дата с временем', { occurredOn: '2026-10-05T10:00:00Z' }],
    ['дата вне разумного диапазона', { occurredOn: '1800-01-01' }],
    ['заметка 501 символ', { note: 'я'.repeat(501) }],
    ['заметка не текст', { note: 5 }],
    ['неизвестный вид', { kind: 'loan' }],
    ['расход с кошельком зачисления', { toWalletId: 'w' }],
    ['расход с суммой зачисления', { toAmountMinor: 100 }],
    ['лишнее поле', { dirty: 0 }],
  ])('отвергает: %s', async (_n, bad) => {
    const { store, cash } = await setup();
    const before = await store.db.transactions.count();
    await expect(
      store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: day, ...bad } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.transactions.count()).toBe(before);
  });

  it('кошелёк: нет такого / удалён / в архиве', async () => {
    const { store, cash, usd } = await setup();
    await expect(expense(store, 'no-such-id', 100)).rejects.toThrow(/Кошелёк не найден/);
    await store.db.wallets.update(usd.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    await expect(expense(store, usd.id, 100)).rejects.toThrow(/удалён/);
    await store.wallets.archive(cash.id);
    await expect(expense(store, cash.id, 100)).rejects.toThrow(/в архиве/);
  });

  it('категория: нет такой; вид не совпадает; null допустим', async () => {
    const { store, cash, food, salary } = await setup();
    await expect(expense(store, cash.id, 100, { categoryId: 'no-such-id' })).rejects.toThrow(/Категория не найдена/);
    await expect(expense(store, cash.id, 100, { categoryId: salary.id })).rejects.toThrow(/не подходит/);
    await expect(
      store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: day, categoryId: food.id }),
    ).rejects.toThrow(/не подходит/);
    expect((await expense(store, cash.id, 100, { categoryId: null })).categoryId).toBeNull();
  });

  it('без настроек операцию записать нельзя (неизвестна базовая валюта)', async () => {
    const store = await makeStore();
    const w = await store.wallets.create({ name: 'A', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await expect(expense(store, w.id, 100)).rejects.toThrow(/Настройки ещё не созданы/);
  });
});

describe('TransactionsRepo.create — переводы', () => {
  it('перевод в той же валюте: сумма зачисления берётся из суммы списания; снимок нулевой', async () => {
    const { store, cash } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 5000, occurredOn: day });
    expect(t).toMatchObject({
      toWalletId: other.id, toAmountMinor: 5000, categoryId: null, baseAmountMinor: 0, fxRate: null, fxSource: null, baseCurrency: 'TJS',
    });
  });

  it('перевод между валютами: сумма зачисления обязательна, указанная сохраняется', async () => {
    const { store, cash, usd } = await setup();
    await expect(
      store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, occurredOn: day }),
    ).rejects.toThrow(/сумму зачисления/);
    const t = await store.transactions.create({
      kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: day,
    });
    expect(t.toAmountMinor).toBe(1000);
  });

  it('перевод в ту же валюту с явной суммой зачисления (комиссия) сохраняет её', async () => {
    const { store, cash } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({
      kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 5000, toAmountMinor: 4950, occurredOn: day,
    });
    expect(t.toAmountMinor).toBe(4950);
  });

  it.each([
    ['на тот же кошелёк', (c: { cash: string }) => ({ toWalletId: c.cash })],
    ['без кошелька зачисления', () => ({ toWalletId: null })],
    ['на несуществующий кошелёк', () => ({ toWalletId: 'no-such-id' })],
    ['с категорией', (c: { other: string }) => ({ toWalletId: c.other, categoryId: 'любая' })],
    ['с нулевой суммой зачисления', (c: { other: string }) => ({ toWalletId: c.other, toAmountMinor: 0 })],
    ['с дробной суммой зачисления', (c: { other: string }) => ({ toWalletId: c.other, toAmountMinor: 1.5 })],
  ])('отвергает перевод %s', async (_n, mk) => {
    const { store, cash } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await expect(
      store.transactions.create({
        kind: 'transfer', walletId: cash.id, amountMinor: 100, occurredOn: day, ...mk({ cash: cash.id, other: other.id }),
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('перевод на кошелёк в архиве отвергается', async () => {
    const { store, cash, usd } = await setup();
    await store.wallets.archive(usd.id);
    await expect(
      store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 100, toAmountMinor: 10, occurredOn: day }),
    ).rejects.toThrow(/в архиве/);
  });
});

describe('TransactionsRepo.create — курс (снимок базовой валюты)', () => {
  it('валюта кошелька ≠ базовой и курса нет — FxRequiredError с данными о валютах', async () => {
    const { store, usd } = await setup();
    const err = await expense(store, usd.id, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FxRequiredError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ walletCurrency: 'USD', baseCurrency: 'TJS' });
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('с курсом: сумма пересчитана, курс и источник сохранены', async () => {
    const { store, usd } = await setup();
    const t = await expense(store, usd.id, 1000, { fx: { rate: 10.9, source: 'nbt' } });
    expect(t).toMatchObject({ baseCurrency: 'TJS', baseAmountMinor: 10_900, fxRate: 10.9, fxSource: 'nbt', amountMinor: 1000 });
  });

  it('курс при кошельке в базовой валюте игнорируется: остаётся 1/same', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000, { fx: { rate: 99, source: 'manual' } });
    expect(t).toMatchObject({ fxRate: 1, fxSource: 'same', baseAmountMinor: 1000 });
  });

  it.each([
    ['курс 0', { rate: 0, source: 'nbt' }],
    ['курс отрицательный', { rate: -1, source: 'nbt' }],
    ['курс NaN', { rate: Number.NaN, source: 'nbt' }],
    ['курс Infinity', { rate: Infinity, source: 'nbt' }],
    ['курс текстом', { rate: '10' as never, source: 'nbt' }],
    ['неизвестный источник', { rate: 10, source: 'гадание' }],
    ['источник same выдумывать нельзя', { rate: 10, source: 'same' }],
  ])('отвергает: %s', async (_n, fx) => {
    const { store, usd } = await setup();
    await expect(expense(store, usd.id, 1000, { fx })).rejects.toBeInstanceOf(ValidationError);
  });

  it('переполнение при пересчёте — понятная ошибка, а не тихая потеря точности', async () => {
    const { store, usd } = await setup();
    // 1e15 дозволено как сумма, но при курсе 1000 пересчёт выходит за безопасные целые
    await expect(expense(store, usd.id, 1_000_000_000_000_000, { fx: { rate: 1000, source: 'manual' } })).rejects.toThrow(/пересчёта/);
  });
});

describe('TransactionsRepo.update', () => {
  it('смена заметки/категории/даты не трогает снимок и курс, даже если «сегодняшний» курс другой', async () => {
    const { store, usd, food } = await setup();
    const t = await expense(store, usd.id, 1000, { fx: { rate: 10.9, source: 'nbt' } });
    const u = await store.transactions.update(t.id, { note: 'позже', occurredOn: '2026-10-06', categoryId: food.id });
    expect(u).toMatchObject({ note: 'позже', occurredOn: '2026-10-06', baseAmountMinor: 10_900, fxRate: 10.9, fxSource: 'nbt' });
    expect(u.clientUpdatedAt > t.clientUpdatedAt).toBe(true);
    expect(u.dirty).toBe(1);
  });

  it('смена суммы без нового курса пересчитывает по ПРЕЖНЕМУ курсу операции', async () => {
    const { store, usd } = await setup();
    const t = await expense(store, usd.id, 1000, { fx: { rate: 10.9, source: 'nbt' } });
    const u = await store.transactions.update(t.id, { amountMinor: 2000 });
    expect(u).toMatchObject({ amountMinor: 2000, baseAmountMinor: 21_800, fxRate: 10.9, fxSource: 'nbt' });
  });

  it('новый fx переоценивает операцию', async () => {
    const { store, usd } = await setup();
    const t = await expense(store, usd.id, 1000, { fx: { rate: 10.9, source: 'nbt' } });
    const u = await store.transactions.update(t.id, { fx: { rate: 11, source: 'manual' } });
    expect(u).toMatchObject({ baseAmountMinor: 11_000, fxRate: 11, fxSource: 'manual' });
  });

  it('смена кошелька на другую валюту без курса — FxRequiredError; с курсом — пересчёт', async () => {
    const { store, cash, usd } = await setup();
    const t = await expense(store, cash.id, 1000);
    await expect(store.transactions.update(t.id, { walletId: usd.id })).rejects.toBeInstanceOf(FxRequiredError);
    const u = await store.transactions.update(t.id, { walletId: usd.id, fx: { rate: 10, source: 'manual' } });
    expect(u).toMatchObject({ walletId: usd.id, baseAmountMinor: 10_000, fxRate: 10 });
  });

  it('после смены базовой валюты правка заметки оставляет старый снимок (не переоценивает)', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.settings.update({ baseCurrency: 'USD' });
    const u = await store.transactions.update(t.id, { note: 'старая' });
    expect(u).toMatchObject({ baseCurrency: 'TJS', baseAmountMinor: 1000, fxRate: 1, fxSource: 'same' });
    // а вот смена суммы требует снимка в НОВОЙ базовой валюте — нужен курс
    await expect(store.transactions.update(t.id, { amountMinor: 2000 })).rejects.toBeInstanceOf(FxRequiredError);
  });

  it('правка без изменений ничего не пишет', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.db.transactions.update(t.id, { dirty: 0 });
    const u = await store.transactions.update(t.id, { amountMinor: 1000, note: '' });
    expect(u.dirty).toBe(0);
    expect(u.clientUpdatedAt).toBe(t.clientUpdatedAt);
  });

  it('удалённую операцию править нельзя; после восстановления можно', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.transactions.softDelete(t.id);
    await expect(store.transactions.update(t.id, { note: 'x' })).rejects.toThrow(/сначала восстановите/);
    await store.transactions.restore(t.id);
    expect((await store.transactions.update(t.id, { note: 'x' })).note).toBe('x');
  });

  it('правка карантинной операции снимает карантин', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.sync.quarantine('transactions', [t.id], 'FK');
    const u = await store.transactions.update(t.id, { note: 'исправил' });
    expect(u.syncError).toBeNull();
  });

  it('те же проверки, что при создании: сумма, дата, категория, служебные поля', async () => {
    const { store, cash, salary } = await setup();
    const t = await expense(store, cash.id, 1000);
    await expect(store.transactions.update(t.id, { amountMinor: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.transactions.update(t.id, { occurredOn: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.transactions.update(t.id, { categoryId: salary.id })).rejects.toThrow(/не подходит/);
    await expect(store.transactions.update(t.id, { deletedAt: null } as never)).rejects.toThrow(/менять нельзя/);
    await expect(store.transactions.update('no-such-id', { note: 'x' })).rejects.toThrow(/не найдена/);
    expect(await store.db.transactions.get(t.id)).toEqual(t); // ничего не записано
  });

  it('смена вида расход → доход требует явно выбрать категорию (старая не подходит)', async () => {
    const { store, cash, food, salary } = await setup();
    const t = await expense(store, cash.id, 1000, { categoryId: food.id });
    await expect(store.transactions.update(t.id, { kind: 'income' })).rejects.toThrow(/не подходит/);
    const u = await store.transactions.update(t.id, { kind: 'income', categoryId: salary.id });
    expect(u).toMatchObject({ kind: 'income', categoryId: salary.id });
  });

  it('расход → перевод: категория сбрасывается сама, снимок обнуляется; обратно — зачисление сбрасывается', async () => {
    const { store, cash, food } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await expense(store, cash.id, 1000, { categoryId: food.id });
    const tr = await store.transactions.update(t.id, { kind: 'transfer', toWalletId: other.id });
    expect(tr).toMatchObject({ kind: 'transfer', categoryId: null, toWalletId: other.id, toAmountMinor: 1000, baseAmountMinor: 0, fxRate: null, fxSource: null });
    const back = await store.transactions.update(t.id, { kind: 'expense' });
    expect(back).toMatchObject({ kind: 'expense', toWalletId: null, toAmountMinor: null, baseAmountMinor: 1000, fxRate: 1, fxSource: 'same' });
  });

  it('изменение суммы перевода в той же валюте двигает и сумму зачисления', async () => {
    const { store, cash } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 5000, occurredOn: day });
    const u = await store.transactions.update(t.id, { amountMinor: 7000 });
    expect(u).toMatchObject({ amountMinor: 7000, toAmountMinor: 7000 });
  });

  it('перевод с комиссией: изменение суммы не затирает осознанную разницу в зачислении', async () => {
    const { store, cash } = await setup();
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 5000, toAmountMinor: 4950, occurredOn: day });
    const u = await store.transactions.update(t.id, { amountMinor: 6000 });
    expect(u).toMatchObject({ amountMinor: 6000, toAmountMinor: 4950 });
  });

  it('перевод между валютами: смена суммы без новой суммы зачисления отвергается; заметка — нет', async () => {
    const { store, cash, usd } = await setup();
    const t = await store.transactions.create({
      kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: day,
    });
    await expect(store.transactions.update(t.id, { amountMinor: 21_800 })).rejects.toThrow(/сумму зачисления заново/);
    expect((await store.transactions.update(t.id, { note: 'обмен' })).toAmountMinor).toBe(1000);
    const u = await store.transactions.update(t.id, { amountMinor: 21_800, toAmountMinor: 2000 });
    expect(u).toMatchObject({ amountMinor: 21_800, toAmountMinor: 2000 });
  });

  it('перевод между валютами: кошелёк зачисления заменён на одновалютный — курс обмена не остаётся «комиссией»', async () => {
    const { store, cash, usd } = await setup();
    const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({
      kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: day,
    });
    const u = await store.transactions.update(t.id, { toWalletId: card.id });
    expect(u).toMatchObject({ toWalletId: card.id, amountMinor: 10_900, toAmountMinor: 10_900 });
  });

  it('перевод с комиссией: замена кошелька зачисления на другой в той же валюте комиссию не теряет', async () => {
    const { store, cash } = await setup();
    const a = await store.wallets.create({ name: 'Карта А', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const b = await store.wallets.create({ name: 'Карта Б', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: a.id, amountMinor: 5000, toAmountMinor: 4950, occurredOn: day });
    const u = await store.transactions.update(t.id, { toWalletId: b.id });
    expect(u).toMatchObject({ toWalletId: b.id, amountMinor: 5000, toAmountMinor: 4950 });
  });

  it('кошелёк в архиве: у существующей операции остаётся, но перенести операцию в архивный нельзя', async () => {
    const { store, cash, usd } = await setup();
    const t = await expense(store, cash.id, 1000);
    const t2 = await expense(store, usd.id, 1000, { fx: { rate: 10, source: 'manual' } });
    await store.wallets.archive(cash.id);
    expect((await store.transactions.update(t.id, { note: 'в архивном кошельке' })).note).toBe('в архивном кошельке');
    await expect(store.transactions.update(t2.id, { walletId: cash.id })).rejects.toThrow(/в архиве/);
  });
});

describe('TransactionsRepo.softDelete / restore', () => {
  it('мягкое удаление: строка остаётся, deletedAt и метка, dirty; повтор безопасен', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.db.transactions.update(t.id, { dirty: 0 });
    const d = await store.transactions.softDelete(t.id);
    expect(d.deletedAt).not.toBeNull();
    expect(d).toMatchObject({ dirty: 1, deletedAt: d.clientUpdatedAt });
    expect(await store.db.transactions.count()).toBe(1);
    const again = await store.transactions.softDelete(t.id);
    expect(again.clientUpdatedAt).toBe(d.clientUpdatedAt);
  });

  it('restore возвращает операцию; повтор на живой — без записи', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    const d = await store.transactions.softDelete(t.id);
    const r = await store.transactions.restore(t.id);
    expect(r.deletedAt).toBeNull();
    expect(r.clientUpdatedAt > d.clientUpdatedAt).toBe(true);
    expect((await store.transactions.restore(t.id)).clientUpdatedAt).toBe(r.clientUpdatedAt);
  });

  it('нельзя удалить/восстановить несуществующую; нельзя восстановить при удалённом кошельке', async () => {
    const { store, cash } = await setup();
    await expect(store.transactions.softDelete('no-such-id')).rejects.toThrow(/не найдена/);
    await expect(store.transactions.restore('no-such-id')).rejects.toThrow(/не найдена/);
    const t = await expense(store, cash.id, 1000);
    await store.transactions.softDelete(t.id);
    await store.db.wallets.update(cash.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    await expect(store.transactions.restore(t.id)).rejects.toThrow(/удалён/);
  });

  it('восстановление операции в архивном кошельке разрешено', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 1000);
    await store.transactions.softDelete(t.id);
    await store.wallets.archive(cash.id);
    expect((await store.transactions.restore(t.id)).deletedAt).toBeNull();
  });
});

describe('дата операции — ровно в границах сервера (2000-01-01 … 2100-01-01 включительно)', () => {
  it.each(['2000-01-01', '2100-01-01'])('граница %s принимается', async (occurredOn) => {
    const { store, cash } = await setup();
    expect((await expense(store, cash.id, 100, { occurredOn })).occurredOn).toBe(occurredOn);
  });

  it.each(['1999-12-31', '2100-01-02', '1900-05-05', '2999-01-01'])('дата %s отвергается до записи в базу', async (occurredOn) => {
    const { store, cash } = await setup();
    await expect(expense(store, cash.id, 100, { occurredOn })).rejects.toThrow(/2000-01-01/);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('правка даты тоже не выпускает операцию за границы', async () => {
    const { store, cash } = await setup();
    const t = await expense(store, cash.id, 100);
    await expect(store.transactions.update(t.id, { occurredOn: '1925-01-01' })).rejects.toBeInstanceOf(ValidationError);
    expect((await store.db.transactions.get(t.id))?.occurredOn).toBe(day);
  });
});
