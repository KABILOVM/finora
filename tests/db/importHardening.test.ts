import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { basics, makeStore, USER_B } from './helpers';

/**
 * Импорт чужого файла не должен принимать то, что сервер отвергнет навсегда или что нарушит правила репозиториев:
 * не-UUID id, UUID в верхнем регистре, суммы и порядок за границами, NUL в тексте, кольцо родителей,
 * перевод «из воздуха». Везде: ошибка — и в базе ничего не меняется.
 */

type Json = Record<string, any>;
const json = <T,>(v: T): Json => JSON.parse(JSON.stringify(v)) as Json;
const fresh = (userId?: string) => makeStore({ factory: new IDBFactory(), userId });

const STAMP = '2026-10-10T12:30:00.000Z';

/** Источник: настройки, 2 кошелька (TJS, USD), 3 категории (вложенная «Кафе» в «Еда»), расход, доход, перевод TJS→USD. */
async function source(store: Store) {
  const b = await basics(store);
  const cafe = await store.categories.create({ name: 'Кафе', kind: 'expense', color: '#000000', icon: 'x', parentId: b.food.id });
  await store.settings.update({ defaultWalletId: b.cash.id });
  const exp = await store.transactions.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 1200, categoryId: cafe.id, occurredOn: '2026-10-05', note: 'Обед' });
  await store.transactions.create({ kind: 'income', walletId: b.cash.id, amountMinor: 5000, categoryId: b.salary.id, occurredOn: '2026-10-01' });
  const tr = await store.transactions.create({ kind: 'transfer', walletId: b.cash.id, toWalletId: b.usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: '2026-10-02' });
  return { ...b, cafe, exp, tr };
}

async function dbDump(store: Store): Promise<string> {
  return JSON.stringify(await Promise.all([store.db.settings, store.db.wallets, store.db.categories, store.db.transactions].map((t) => t.toArray())));
}

async function expectRejected(dst: Store, file: Json, message: RegExp) {
  const before = await dbDump(dst);
  const err = await importBackup(dst, file).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as Error).message).toMatch(message);
  expect(await dbDump(dst), 'после отказа база не должна измениться').toBe(before);
}

describe('импорт: id и ссылки только UUID', () => {
  const cases: [string, (f: Json) => void][] = [
    ['id кошелька', (f) => (f.wallets[0].id = 'old-wallet-1')],
    ['id категории', (f) => (f.categories[0].id = 'cat-1')],
    ['id операции', (f) => (f.transactions[0].id = '123')],
    ['пустой id операции', (f) => (f.transactions[0].id = '')],
    ['walletId операции', (f) => (f.transactions[0].walletId = 'w1')],
    ['toWalletId перевода', (f) => (f.transactions.find((t: Json) => t.kind === 'transfer').toWalletId = 'w2')],
    ['categoryId операции', (f) => (f.transactions.find((t: Json) => t.categoryId).categoryId = 'food')],
    ['parentId категории', (f) => (f.categories.find((c: Json) => c.parentId).parentId = 'root')],
    ['defaultWalletId настроек', (f) => (f.settings.defaultWalletId = 'cash')],
    ['UUID без дефисов', (f) => (f.wallets[0].id = f.wallets[0].id.replaceAll('-', ''))],
    ['UUID с фигурными скобками', (f) => (f.wallets[0].id = `{${f.wallets[0].id}}`)],
  ];

  it.each(cases)('отвергается: %s не в виде UUID', async (_n, mutate) => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    mutate(file);
    const dst = await fresh();
    await expectRejected(dst, file, /UUID|идентификатор/);
    expect(await dst.db.wallets.count()).toBe(0);
  });
});

describe('импорт: UUID в верхнем регистре приводится к нижнему вместе со всеми ссылками', () => {
  /** Все идентификаторы и ссылки файла — заглавными. */
  function shout(f: Json): Json {
    const up = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v);
    for (const w of f.wallets) w.id = up(w.id);
    for (const c of f.categories) {
      c.id = up(c.id);
      c.parentId = up(c.parentId);
    }
    for (const t of f.transactions) {
      t.id = up(t.id);
      t.walletId = up(t.walletId);
      t.toWalletId = up(t.toWalletId);
      t.categoryId = up(t.categoryId);
    }
    f.settings.defaultWalletId = up(f.settings.defaultWalletId);
    return f;
  }

  it('в базе только строчные id, ссылки сходятся, остатки считаются как в источнике', async () => {
    const src = await fresh();
    const s = await source(src);
    const file = shout(json(await exportBackup(src)));
    expect(file.wallets[0].id).not.toBe(file.wallets[0].id.toLowerCase()); // файл и правда с заглавными

    const dst = await fresh();
    await importBackup(dst, file);

    const all = [
      ...(await dst.db.wallets.toArray()),
      ...(await dst.db.categories.toArray()),
      ...(await dst.db.transactions.toArray()),
    ];
    expect(all.filter((r) => r.id !== r.id.toLowerCase())).toEqual([]);
    expect((await dst.db.wallets.toArray()).map((w) => w.id).sort()).toEqual([s.cash.id, s.usd.id].sort());
    const txs = await dst.db.transactions.toArray();
    const walletIds = new Set((await dst.db.wallets.toArray()).map((w) => w.id));
    const catIds = new Set((await dst.db.categories.toArray()).map((c) => c.id));
    for (const t of txs) {
      expect(walletIds.has(t.walletId)).toBe(true);
      if (t.toWalletId) expect(walletIds.has(t.toWalletId)).toBe(true);
      if (t.categoryId) expect(catIds.has(t.categoryId)).toBe(true);
    }
    expect((await dst.db.categories.get(s.cafe.id))?.parentId).toBe(s.food.id);
    expect((await dst.db.settings.get(dst.userId))?.defaultWalletId).toBe(s.cash.id);
    expect(computeBalances(await dst.db.wallets.toArray(), txs)).toEqual(computeBalances(await src.db.wallets.toArray(), await src.db.transactions.toArray()));
  });

  it('повторный импорт того же файла не плодит дубли', async () => {
    const src = await fresh();
    await source(src);
    const file = shout(json(await exportBackup(src)));
    const dst = await fresh();
    await importBackup(dst, file);
    const counts = [await dst.db.wallets.count(), await dst.db.categories.count(), await dst.db.transactions.count()];
    const again = await importBackup(dst, file);
    expect(again.added).toBe(0);
    expect([await dst.db.wallets.count(), await dst.db.categories.count(), await dst.db.transactions.count()]).toEqual(counts);
  });

  it('заглавный id в файле и тот же id строчным в базе — это одна запись, а не две', async () => {
    const src = await fresh();
    const s = await source(src);
    const dst = await fresh();
    await importBackup(dst, json(await exportBackup(src)));
    const file = json(await exportBackup(src));
    file.wallets.find((w: Json) => w.id === s.cash.id).id = s.cash.id.toUpperCase();
    const res = await importBackup(dst, file);
    expect(res.added).toBe(0);
    expect(await dst.db.wallets.count()).toBe(2);
  });

  it('две записи с одним id, отличающиеся только регистром, — повторяющийся идентификатор', async () => {
    const src = await fresh();
    const s = await source(src);
    const file = json(await exportBackup(src));
    file.wallets.push({ ...file.wallets.find((w: Json) => w.id === s.cash.id), id: s.cash.id.toUpperCase() });
    await expectRejected(await fresh(), file, /повторяющийся/);
  });

  it('ссылка заглавными на кошелёк, записанный строчными (и наоборот), сходится', async () => {
    const src = await fresh();
    const s = await source(src);
    const file = json(await exportBackup(src));
    for (const t of file.transactions) if (t.walletId === s.cash.id) t.walletId = s.cash.id.toUpperCase();
    const dst = await fresh();
    await importBackup(dst, file);
    expect((await dst.db.transactions.toArray()).every((t) => t.walletId === t.walletId.toLowerCase())).toBe(true);
  });

  it('настройки: id заглавными = id пользователя строчными — это та же учётная запись', async () => {
    const userId = 'abcdef12-0000-4000-8000-0000000000ab';
    const src = await fresh(userId);
    await source(src);
    const file = json(await exportBackup(src));
    file.settings.id = userId.toUpperCase();
    const dst = await fresh(userId);
    await importBackup(dst, file);
    expect((await dst.db.settings.get(userId))?.id).toBe(userId);
  });
});

describe('импорт: порядок за границей сервера зажимается, суммы и остатки — отвергаются', () => {
  it('sortOrder кошелька и категории за ±1e15 зажимается до границы', async () => {
    const src = await fresh();
    const s = await source(src);
    const file = json(await exportBackup(src));
    file.wallets.find((w: Json) => w.id === s.cash.id).sortOrder = Number.MAX_SAFE_INTEGER;
    file.wallets.find((w: Json) => w.id === s.usd.id).sortOrder = -Number.MAX_SAFE_INTEGER;
    file.categories.find((c: Json) => c.id === s.food.id).sortOrder = 5e15;
    const dst = await fresh();
    await importBackup(dst, file);
    expect((await dst.db.wallets.get(s.cash.id))?.sortOrder).toBe(1e15);
    expect((await dst.db.wallets.get(s.usd.id))?.sortOrder).toBe(-1e15);
    expect((await dst.db.categories.get(s.food.id))?.sortOrder).toBe(1e15);
    // после этого кошельки по-прежнему создаются
    await expect(dst.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' })).resolves.toBeDefined();
  });

  it('sortOrder не целое — как и раньше, отказ', async () => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    file.wallets[0].sortOrder = 1.5;
    await expectRejected(await fresh(), file, /Порядок/);
  });

  const over: [string, (f: Json) => void, RegExp][] = [
    ['сумма операции 1e15 + 1', (f) => (f.transactions.find((t: Json) => t.kind === 'income').amountMinor = 1e15 + 1), /Сумма слишком велика/],
    ['сумма зачисления 1e15 + 1', (f) => (f.transactions.find((t: Json) => t.kind === 'transfer').toAmountMinor = 1e15 + 1), /Сумма зачисления слишком велика/],
    ['сумма в базовой валюте 1e15 + 1', (f) => (f.transactions.find((t: Json) => t.kind === 'income').baseAmountMinor = 1e15 + 1), /Сумма в базовой валюте: допустимо/],
    ['начальный остаток 1e15 + 1', (f) => (f.wallets[0].openingBalanceMinor = 1e15 + 1), /Начальный остаток: допустимо/],
    ['начальный остаток −1e15 − 1', (f) => (f.wallets[0].openingBalanceMinor = -1e15 - 1), /Начальный остаток: допустимо/],
  ];
  it.each(over)('отвергается: %s', async (_n, mutate, message) => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    mutate(file);
    await expectRejected(await fresh(), file, message);
  });

  it('ровно на границе (1e15) — принимается', async () => {
    const src = await fresh();
    const s = await source(src);
    const file = json(await exportBackup(src));
    const income = file.transactions.find((t: Json) => t.kind === 'income');
    income.amountMinor = 1e15;
    income.baseAmountMinor = 1e15;
    file.wallets.find((w: Json) => w.id === s.usd.id).openingBalanceMinor = -1e15;
    const dst = await fresh();
    await importBackup(dst, file);
    expect((await dst.db.transactions.get(income.id))?.baseAmountMinor).toBe(1e15);
  });
});

describe('импорт: символ NUL в тексте', () => {
  const NUL = '\u0000';
  const cases: [string, (f: Json) => void][] = [
    ['заметка', (f) => (f.transactions[0].note = `до${NUL}после`)],
    ['название кошелька', (f) => (f.wallets[0].name = `Нал${NUL}`)],
    ['цвет кошелька', (f) => (f.wallets[0].color = `#${NUL}`)],
    ['значок категории', (f) => (f.categories[0].icon = NUL)],
    ['название категории', (f) => (f.categories[0].name = `${NUL}Еда`)],
    ['устройство записи', (f) => (f.wallets[0].deviceId = `dev${NUL}ice`)],
    ['источник курса', (f) => (f.transactions.find((t: Json) => t.fxSource === 'same').fxSource = `same${NUL}`)],
  ];
  it.each(cases)('отвергается: %s', async (_n, mutate) => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    mutate(file);
    await expectRejected(await fresh(), file, /нулевого символа|Устройство|Источник курса/);
  });
});

describe('импорт: кольцо родительских категорий', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const cat = (base: Json, id: string, parentId: string | null) => ({ ...base, id, parentId, name: id.slice(0, 4), kind: 'expense', createdAt: STAMP, clientUpdatedAt: STAMP, deviceId: 'device-zzzzz-1' });

  it('A → B → A', async () => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    file.categories.push(cat(file.categories[0], A, B), cat(file.categories[0], B, A));
    await expectRejected(await fresh(), file, /кольц|цикл/);
  });

  it('A → B → C → A', async () => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    file.categories.push(cat(file.categories[0], A, B), cat(file.categories[0], B, C), cat(file.categories[0], C, A));
    await expectRejected(await fresh(), file, /кольц|цикл/);
  });

  it('кольцо замыкается через локальные данные: в базе Y → X, а новая версия X в файле указывает на Y', async () => {
    const dst = await fresh();
    const { food, cafe } = await source(dst); // cafe → food
    const file = json(await exportBackup(dst));
    const x = file.categories.find((c: Json) => c.id === food.id);
    x.parentId = cafe.id;
    x.clientUpdatedAt = new Date(Date.now() + 60_000).toISOString(); // новее локальной версии, но в пределах «сейчас + 5 минут»
    x.deviceId = 'device-zzzzz-1';
    await expectRejected(dst, file, /кольц|цикл/);
  });

  it('обычная цепочка из трёх категорий принимается', async () => {
    const src = await fresh();
    await source(src);
    const file = json(await exportBackup(src));
    file.categories.push(cat(file.categories[0], A, null), cat(file.categories[0], B, A), cat(file.categories[0], C, B));
    await expect(importBackup(await fresh(), file)).resolves.toBeDefined();
  });
});

describe('импорт: перевод в одной валюте не зачисляет больше, чем списал', () => {
  async function fileWithSameCurrencyTransfer(toAmountMinor: number, extra: Json = {}) {
    const src = await fresh();
    const s = await source(src);
    const card = await src.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const tr = await src.transactions.create({ kind: 'transfer', walletId: s.cash.id, toWalletId: card.id, amountMinor: 5000, toAmountMinor: 5000, occurredOn: '2026-10-05' });
    const file = json(await exportBackup(src));
    Object.assign(file.transactions.find((t: Json) => t.id === tr.id), { toAmountMinor }, extra);
    return file;
  }

  it('больше — отказ с понятным текстом, база не меняется', async () => {
    const file = await fileWithSameCurrencyTransfer(49_500);
    await expectRejected(await fresh(), file, /одной валюты.*не может быть больше суммы списания/);
  });

  it('поровну и меньше (комиссия) — принимается', async () => {
    await expect(importBackup(await fresh(), await fileWithSameCurrencyTransfer(5000))).resolves.toBeDefined();
    await expect(importBackup(await fresh(), await fileWithSameCurrencyTransfer(4950))).resolves.toBeDefined();
  });

  it('разные валюты: зачисление больше списания — это курс, принимается', async () => {
    const src = await fresh();
    const s = await source(src);
    await src.transactions.create({ kind: 'transfer', walletId: s.usd.id, toWalletId: s.cash.id, amountMinor: 100, toAmountMinor: 1090, occurredOn: '2026-10-05' });
    await expect(importBackup(await fresh(), json(await exportBackup(src)))).resolves.toBeDefined();
  });

  it('удалённая запись с лишней суммой (старый файл) не мешает импорту, но не оживает через restore', async () => {
    const file = await fileWithSameCurrencyTransfer(49_500, { deletedAt: STAMP });
    const dst = await fresh();
    await importBackup(dst, file);
    const bad = (await dst.db.transactions.toArray()).find((t) => t.toAmountMinor === 49_500)!;
    await expect(dst.transactions.restore(bad.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('принятое решение: копия без блока настроек принимается', () => {
  it('восстановление своей копии в новый аккаунт (старый потерян): настройки в файле нет — импорт проходит', async () => {
    const old = await fresh(USER_B);
    await source(old);
    const file = json(await exportBackup(old));
    file.settings = null;
    const brandNew = await fresh();
    const res = await importBackup(brandNew, file);
    expect(res.added).toBe(file.wallets.length + file.categories.length + file.transactions.length);
  });

  it('а копия с блоком настроек ДРУГОГО аккаунта по-прежнему отвергается', async () => {
    const old = await fresh(USER_B);
    await source(old);
    const dst = await fresh();
    await expectRejected(dst, json(await exportBackup(old)), /другому аккаунту/);
  });
});
