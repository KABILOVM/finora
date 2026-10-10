import { describe, expect, it } from 'vitest';
import { createClock, ValidationError } from '@/db';
import { MAX_STAMP, MIN_STAMP } from '@/db/clock';
import {
  AMOUNT_MAX,
  BASE_AMOUNT_MAX,
  OPENING_BALANCE_MAX,
  OPENING_BALANCE_MIN,
  SORT_ORDER_MAX,
} from '@/db/validate';
import { basics, expense, makeStore } from './helpers';

/**
 * Границы и запреты, которые клиент обязан держать так же, как CHECK в supabase/schema.sql:
 * иначе запись навсегда останется на устройстве (сервер её отвергнет, она уйдёт в карантин).
 */

const wallet = { name: 'Кошелёк', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' } as const;

describe('суммы: границы сервера (1e15)', () => {
  it('константы равны серверным CHECK', () => {
    expect([AMOUNT_MAX, BASE_AMOUNT_MAX, OPENING_BALANCE_MAX, -OPENING_BALANCE_MIN, SORT_ORDER_MAX]).toEqual(Array(5).fill(1e15));
  });

  it('сумма операции: ровно 1e15 можно, 1e15 + 1 — ValidationError по-русски', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    expect((await expense(s, cash.id, 1e15)).amountMinor).toBe(1e15);
    const err = await expense(s, cash.id, 1e15 + 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Сумма слишком велика.*1 000 000 000 000 000/);
  });

  it('сумма операции при правке: выход за 1e15 отвергается, операция не меняется', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const t = await expense(s, cash.id, 100);
    await expect(s.transactions.update(t.id, { amountMinor: 1e15 + 1 })).rejects.toBeInstanceOf(ValidationError);
    expect((await s.db.transactions.get(t.id))?.amountMinor).toBe(100);
  });

  it('сумма зачисления перевода: 1e15 + 1 отвергается (кошельки в разных валютах)', async () => {
    const s = await makeStore();
    const { cash, usd } = await basics(s);
    const base = { kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 100, occurredOn: '2026-10-05' } as const;
    expect((await s.transactions.create({ ...base, toAmountMinor: 1e15 })).toAmountMinor).toBe(1e15);
    const err = await s.transactions.create({ ...base, toAmountMinor: 1e15 + 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Сумма зачисления слишком велика/);
  });

  it('начальный остаток: ±1e15 можно, дальше — ValidationError (создание и правка)', async () => {
    const s = await makeStore();
    await s.settings.ensure();
    expect((await s.wallets.create({ ...wallet, openingBalanceMinor: 1e15 })).openingBalanceMinor).toBe(1e15);
    const minus = await s.wallets.create({ ...wallet, name: 'Минус', openingBalanceMinor: -1e15 });
    expect(minus.openingBalanceMinor).toBe(-1e15);
    for (const bad of [1e15 + 1, -1e15 - 1, 2e15]) {
      const err = await s.wallets.create({ ...wallet, openingBalanceMinor: bad }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/Начальный остаток: допустимо от −1 000 000 000 000 000 до 1 000 000 000 000 000/);
    }
    await expect(s.wallets.update(minus.id, { openingBalanceMinor: 1e15 + 1 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('пересчёт в базовую валюту: результат больше 1e15 — понятный отказ, хотя число и «безопасное»', async () => {
    const s = await makeStore();
    const { usd } = await basics(s); // база TJS, кошелёк в USD
    // 1e14 центов × курс 100 = 1e16 дирам: помещается в безопасное целое, но не в границу сервера
    const err = await expense(s, usd.id, 1e14, { fx: { rate: 100, source: 'manual' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Сумма слишком велика для пересчёта в базовую валюту/);
    // а ровно на границе — можно
    const ok = await expense(s, usd.id, 1e14, { fx: { rate: 10, source: 'manual' } });
    expect(ok.baseAmountMinor).toBe(1e15);
  });

  it('курс, который не поместится в numeric(20,10), отвергается сразу', async () => {
    const s = await makeStore();
    const { usd } = await basics(s);
    for (const rate of [1e10, 1e12, 1e-11, Number.MIN_VALUE]) {
      await expect(expense(s, usd.id, 100, { fx: { rate, source: 'manual' } })).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await expense(s, usd.id, 100, { fx: { rate: 9_999_999_999, source: 'manual' } })).fxRate).toBe(9_999_999_999);
  });
});

describe('текст: символ NUL запрещён везде', () => {
  const NUL = '\u0000';

  it('заметка, при создании и при правке', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const err = await expense(s, cash.id, 100, { note: `до${NUL}после` }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Заметка.*нулевого символа/);
    const t = await expense(s, cash.id, 100, { note: 'чисто' });
    await expect(s.transactions.update(t.id, { note: NUL })).rejects.toBeInstanceOf(ValidationError);
    expect((await s.db.transactions.get(t.id))?.note).toBe('чисто');
  });

  it('название, цвет и значок кошелька и категории', async () => {
    const s = await makeStore();
    await s.settings.ensure();
    for (const patch of [{ name: `a${NUL}` }, { color: `#${NUL}00` }, { icon: `${NUL}` }]) {
      await expect(s.wallets.create({ ...wallet, ...patch })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        s.categories.create({ name: 'Кат', kind: 'expense', color: '#000000', icon: 'x', ...patch }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const w = await s.wallets.create(wallet);
    await expect(s.wallets.update(w.id, { name: `Х${NUL}` })).rejects.toBeInstanceOf(ValidationError);
    const c = await s.categories.create({ name: 'Кат', kind: 'expense', color: '#000000', icon: 'x' });
    await expect(s.categories.update(c.id, { icon: `${NUL}` })).rejects.toBeInstanceOf(ValidationError);
    expect(await s.db.wallets.count()).toBe(1);
    expect(await s.db.categories.count()).toBe(1);
  });

  it('источник курса', async () => {
    const s = await makeStore();
    const { usd } = await basics(s);
    await expect(expense(s, usd.id, 100, { fx: { rate: 10, source: `nbt${NUL}` } })).rejects.toBeInstanceOf(ValidationError);
    await expect(expense(s, usd.id, 100, { fx: { rate: 10, source: NUL } })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('порядок (sortOrder): границы ±1e15', () => {
  it('правка за границу отвергается; ровно 1e15 можно', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    for (const bad of [Number.MAX_SAFE_INTEGER, 1e15 + 1, -1e15 - 1]) {
      await expect(s.wallets.update(cash.id, { sortOrder: bad })).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await s.wallets.update(cash.id, { sortOrder: 1e15 })).sortOrder).toBe(1e15);
  });

  it('следующий порядок у границы не выходит за неё и не переполняется — кошельки и категории создаются дальше', async () => {
    const s = await makeStore();
    const { cash, food } = await basics(s);
    await s.wallets.update(cash.id, { sortOrder: 1e15 });
    const w2 = await s.wallets.create({ ...wallet, name: 'Второй' });
    const w3 = await s.wallets.create({ ...wallet, name: 'Третий' });
    expect([w2.sortOrder, w3.sortOrder]).toEqual([1e15, 1e15]);
    await s.categories.update(food.id, { sortOrder: 1e15 - 1 });
    expect((await s.categories.create({ name: 'Новая', kind: 'expense', color: '#000000', icon: 'x' })).sortOrder).toBe(1e15);
  });

  it('старая запись с порядком за границей (раньше он был допустим): новая получает граничное значение, а не переполнение', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    await s.db.wallets.put({ ...(await s.db.wallets.get(cash.id))!, sortOrder: Number.MAX_SAFE_INTEGER });
    const w = await s.wallets.create({ ...wallet, name: 'Новый' });
    expect(w.sortOrder).toBe(1e15);
  });
});

describe('перевод в одной валюте не зачисляет больше, чем списал', () => {
  async function pair() {
    const s = await makeStore();
    const { cash, usd } = await basics(s);
    const card = await s.wallets.create({ ...wallet, name: 'Карта', kind: 'card' });
    const usd2 = await s.wallets.create({ ...wallet, name: 'Доллары 2', currency: 'USD' });
    return { s, cash, usd, card, usd2 };
  }
  const t = (walletId: string, toWalletId: string, amountMinor: number, toAmountMinor: number) =>
    ({ kind: 'transfer', walletId, toWalletId, amountMinor, toAmountMinor, occurredOn: '2026-10-05' }) as const;

  it('создание: больше — ошибка по-русски; поровну и меньше (комиссия) — можно', async () => {
    const { s, cash, card } = await pair();
    const err = await s.transactions.create(t(cash.id, card.id, 5000, 5001)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/одной валюты.*сумма зачисления не может быть больше суммы списания/);
    expect((await s.transactions.create(t(cash.id, card.id, 5000, 5000))).toAmountMinor).toBe(5000);
    expect((await s.transactions.create(t(cash.id, card.id, 5000, 4950))).toAmountMinor).toBe(4950);
    expect(await s.db.transactions.count()).toBe(2);
  });

  it('разные валюты: суммы независимы (зачисление может быть и больше, и меньше)', async () => {
    const { s, cash, usd } = await pair();
    expect((await s.transactions.create(t(usd.id, cash.id, 100, 1090))).toAmountMinor).toBe(1090);
    expect((await s.transactions.create(t(cash.id, usd.id, 1090, 100))).toAmountMinor).toBe(100);
    expect((await s.transactions.create(t(cash.id, usd.id, 100, 1090))).toAmountMinor).toBe(1090);
  });

  it('правка: поднять зачисление выше списания — отказ; опустить списание ниже зачисления — отказ; комиссия остаётся', async () => {
    const { s, cash, card } = await pair();
    const tr = await s.transactions.create(t(cash.id, card.id, 5000, 4950));
    await expect(s.transactions.update(tr.id, { toAmountMinor: 5001 })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.transactions.update(tr.id, { amountMinor: 4900 })).rejects.toBeInstanceOf(ValidationError);
    expect(await s.db.transactions.get(tr.id)).toMatchObject({ amountMinor: 5000, toAmountMinor: 4950 });
    expect((await s.transactions.update(tr.id, { toAmountMinor: 4000 })).toAmountMinor).toBe(4000);
    expect((await s.transactions.update(tr.id, { note: 'комментарий' })).note).toBe('комментарий');
  });

  it('правка: расход превращается в перевод с лишней суммой зачисления — отказ', async () => {
    const { s, cash, card } = await pair();
    const e = await expense(s, cash.id, 1000);
    await expect(
      s.transactions.update(e.id, { kind: 'transfer', toWalletId: card.id, toAmountMinor: 2000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await s.db.transactions.get(e.id))?.kind).toBe('expense');
  });

  it('удалённый перевод с лишней суммой (старые данные) не оживает', async () => {
    const { s, cash, card } = await pair();
    const tr = await s.transactions.create(t(cash.id, card.id, 5000, 4950));
    await s.transactions.softDelete(tr.id);
    const row = (await s.db.transactions.get(tr.id))!;
    await s.db.transactions.put({ ...row, toAmountMinor: 9999 }); // как если бы осталось от прежней версии
    await expect(s.transactions.restore(tr.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await s.db.transactions.get(tr.id))?.deletedAt).not.toBeNull();
  });
});

describe('часы: метки только в границах сервера (2000–2100), монотонность сохраняется', () => {
  it('константы границ', () => {
    expect([MIN_STAMP, MAX_STAMP]).toEqual(['2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z']);
  });

  it.each([0, -1, -5e12, Number.NaN, Number.NEGATIVE_INFINITY, Date.UTC(1999, 11, 31)])(
    'часы показывают %s: метки не раньше 2000 года и растут строго',
    (wall) => {
      const clock = createClock({ deviceId: 'd', now: () => wall, load: () => null, save: () => undefined });
      const stamps = [clock.tick(), clock.tick(), clock.tick()];
      expect(stamps[0]! >= MIN_STAMP).toBe(true);
      expect(stamps[0]! < stamps[1]! && stamps[1]! < stamps[2]!).toBe(true);
    },
  );

  it('хранилище с мёртвыми часами: все метки записей (создание, правка, удаление, архив) не раньше 2000-го и растут', async () => {
    const s = await makeStore({ now: () => 0, deviceId: 'device-dead-rtc2' });
    await s.settings.ensure();
    const w = await s.wallets.create(wallet);
    const upd = await s.wallets.update(w.id, { name: 'Новое имя' });
    const arch = await s.wallets.archive(w.id);
    expect(w.createdAt >= MIN_STAMP && w.clientUpdatedAt >= MIN_STAMP).toBe(true);
    expect(w.clientUpdatedAt < upd.clientUpdatedAt && upd.clientUpdatedAt < arch.clientUpdatedAt).toBe(true);
    expect(arch.archivedAt! >= MIN_STAMP).toBe(true);
  });

  it('когда часы наконец исправили, метки идут вперёд от последней (не возвращаются к 2000-му)', () => {
    let wall = 0;
    const clock = createClock({ deviceId: 'd', now: () => wall, load: () => null, save: () => undefined });
    const dead = clock.tick();
    wall = Date.UTC(2026, 9, 10);
    const fixed = clock.tick();
    expect(fixed > dead).toBe(true);
    expect(fixed).toBe('2026-10-10T00:00:00.000Z');
  });

  it('часы дальше 2100 года: ValidationError, метка не выдаётся и не запоминается; после исправления часов работа продолжается', () => {
    let wall = Date.UTC(2200, 0, 1);
    const saved: string[] = [];
    const clock = createClock({ deviceId: 'd', now: () => wall, load: () => null, save: (st) => saved.push(st) });
    expect(() => clock.tick()).toThrow(ValidationError);
    expect(() => clock.tick()).toThrow(/2100/);
    expect(saved).toEqual([]);
    wall = Date.UTC(2026, 9, 10);
    expect(clock.tick()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('запись при часах дальше 2100 года не проходит и ничего не оставляет в базе', async () => {
    let wall = Date.UTC(2026, 9, 10);
    const s = await makeStore({ now: () => wall });
    await s.settings.ensure();
    wall = Date.UTC(2200, 0, 1);
    await expect(s.wallets.create(wallet)).rejects.toBeInstanceOf(ValidationError);
    expect(await s.db.wallets.count()).toBe(0);
    wall = Date.UTC(2026, 9, 11);
    expect((await s.wallets.create(wallet)).createdAt >= '2026-10-11').toBe(true);
  });

  it('observe и сохранённая метка за границами сервера игнорируются (часы не «отравить»)', () => {
    const wall = Date.UTC(2026, 9, 10);
    const clock = createClock({ deviceId: 'd', now: () => wall, load: () => '2099-12-31T23:59:59.999Z' , save: () => undefined });
    // сохранённая метка внутри границ принимается как есть
    expect(clock.tick() > '2099-12-31T23:59:59.999Z').toBe(true);

    const poisoned = createClock({ deviceId: 'd', now: () => wall, load: () => '2300-01-01T00:00:00.000Z', save: () => undefined });
    expect(poisoned.tick()).toBe('2026-10-10T00:00:00.000Z');

    const c2 = createClock({ deviceId: 'd', now: () => wall, load: () => null, save: () => undefined });
    expect(c2.observe('1970-01-01T00:00:00.000Z')).toBe(false);
    expect(c2.observe('2100-01-01T00:00:00.001Z', true)).toBe(false);
    expect(c2.observe('2026-10-10T00:10:00.000Z')).toBe(true);
    expect(c2.tick() > '2026-10-10T00:10:00.000Z').toBe(true);
  });
});
