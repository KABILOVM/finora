import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, ValidationError, type Store } from '@/db';
import { hasLoneSurrogate } from '@/db/validate';
import { basics, expense, makeStore } from './helpers';

/**
 * Одинокий суррогат UTF-16 (обрезанный смайлик) в названиях и заметках отвергается на входе:
 * в репозиториях (создание и правка) и при импорте резервной копии. Целый смайлик — допустим.
 */

const CUT_EMOJI = '\uD83D'; // половинка 😀 (голова без хвоста)
const TAIL_ONLY = '\uDE00'; // хвост без головы
const FULL_EMOJI = '😀'; // 😀
const MESSAGE = /Некорректный символ в тексте/;

const fresh = () => makeStore({ factory: new IDBFactory() });

async function dump(store: Store): Promise<string> {
  return JSON.stringify(await Promise.all([store.db.settings, store.db.wallets, store.db.categories, store.db.transactions].map((t) => t.toArray())));
}

async function rejects(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as Error).message).toMatch(MESSAGE);
}

describe('hasLoneSurrogate: чистая проверка', () => {
  it.each([
    ['пустая строка', '', false],
    ['обычный русский текст', 'Обед в кафе', false],
    ['целый смайлик', `Обед ${FULL_EMOJI}`, false],
    ['несколько целых смайликов подряд', '😀😀🍽️💵', false],
    ['обрезанный смайлик в конце', `Обед ${CUT_EMOJI}`, true],
    ['обрезанный смайлик в начале', `${CUT_EMOJI}Обед`, true],
    ['обрезанный смайлик в середине', `Об${CUT_EMOJI}ед`, true],
    ['только голова', CUT_EMOJI, true],
    ['только хвост', TAIL_ONLY, true],
    ['хвост перед головой (пара задом наперёд)', '\uDE00\uD83D', true],
    ['голова, голова, хвост', '\uD83D😀', true],
    ['целая пара и потом одинокая голова', `${FULL_EMOJI}${CUT_EMOJI}`, true],
  ])('%s', (_name, text, expected) => {
    expect(hasLoneSurrogate(text)).toBe(expected);
  });
});

describe('репозитории: создание', () => {
  it('кошелёк: название, цвет, значок', async () => {
    const store = await fresh();
    const base = { name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#16a34a', icon: '💵' } as const;
    await rejects(store.wallets.create({ ...base, name: `Нал ${CUT_EMOJI}` }));
    await rejects(store.wallets.create({ ...base, icon: CUT_EMOJI }));
    await rejects(store.wallets.create({ ...base, color: `#${TAIL_ONLY}` }));
    expect(await store.db.wallets.count()).toBe(0);
    // целый смайлик в названии проходит и сохраняется как есть
    const ok = await store.wallets.create({ ...base, name: `Нал ${FULL_EMOJI}` });
    expect((await store.db.wallets.get(ok.id))?.name).toBe(`Нал ${FULL_EMOJI}`);
  });

  it('категория: название и значок', async () => {
    const store = await fresh();
    await rejects(store.categories.create({ name: `Еда ${CUT_EMOJI}`, kind: 'expense', color: '#000000', icon: 'x' }));
    await rejects(store.categories.create({ name: 'Еда', kind: 'expense', color: '#000000', icon: TAIL_ONLY }));
    expect(await store.db.categories.count()).toBe(0);
    const ok = await store.categories.create({ name: `Еда ${FULL_EMOJI}`, kind: 'expense', color: '#000000', icon: '🍽️' });
    expect(ok.name).toBe(`Еда ${FULL_EMOJI}`);
  });

  it('операция: заметка; в базу ничего не попадает', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const before = await dump(store);
    await rejects(expense(store, cash.id, 1000, { note: `Обед ${CUT_EMOJI}` }));
    await rejects(expense(store, cash.id, 1000, { note: `${TAIL_ONLY} обед` }));
    expect(await dump(store)).toBe(before);
    const ok = await expense(store, cash.id, 1000, { note: `Обед ${FULL_EMOJI}` });
    expect(ok.note).toBe(`Обед ${FULL_EMOJI}`);
  });

  it('заметка, обрезанная по длине посреди смайлика, отвергается (типичный путь появления «половинки»)', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const cut = `${'а'.repeat(499)}${FULL_EMOJI}`.slice(0, 500); // 499 букв + только голова смайлика
    expect(hasLoneSurrogate(cut)).toBe(true);
    await rejects(expense(store, cash.id, 1000, { note: cut }));
  });
});

describe('репозитории: правки', () => {
  it('кошелёк: update названия отвергается, прежнее название и метка правки не меняются', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const before = await store.db.wallets.get(cash.id);
    await rejects(store.wallets.update(cash.id, { name: `Касса ${CUT_EMOJI}` }));
    expect(await store.db.wallets.get(cash.id)).toEqual(before);
    const ok = await store.wallets.update(cash.id, { name: `Касса ${FULL_EMOJI}` });
    expect(ok.name).toBe(`Касса ${FULL_EMOJI}`);
  });

  it('категория: update названия', async () => {
    const store = await fresh();
    const { food } = await basics(store);
    await rejects(store.categories.update(food.id, { name: `${CUT_EMOJI}` }));
    expect((await store.db.categories.get(food.id))?.name).toBe('Еда');
  });

  it('операция: update заметки; сумма в той же правке тоже не меняется', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const tx = await expense(store, cash.id, 1000, { note: 'Обед' });
    const before = await store.db.transactions.get(tx.id);
    await rejects(store.transactions.update(tx.id, { amountMinor: 2000, note: `Обед ${CUT_EMOJI}` }));
    expect(await store.db.transactions.get(tx.id)).toEqual(before);
  });

  it('архивация и удаление не затронуты проверкой (они не вводят текст)', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const tx = await expense(store, cash.id, 1000, { note: 'Обед' });
    await expect(store.transactions.softDelete(tx.id)).resolves.toMatchObject({ deletedAt: expect.any(String) });
    await expect(store.wallets.archive(cash.id)).resolves.toMatchObject({ archivedAt: expect.any(String) });
  });
});

describe('импорт резервной копии', () => {
  type Json = Record<string, any>;
  async function validFile(): Promise<Json> {
    const src = await fresh();
    const b = await basics(src);
    await expense(src, b.cash.id, 1200, { categoryId: b.food.id, note: 'Обед' });
    return JSON.parse(JSON.stringify(await exportBackup(src))) as Json;
  }

  const cases: [string, (f: Json) => void][] = [
    ['название кошелька', (f) => (f.wallets[0].name = `Нал ${CUT_EMOJI}`)],
    ['значок кошелька', (f) => (f.wallets[0].icon = TAIL_ONLY)],
    ['название категории', (f) => (f.categories[0].name = `Еда ${CUT_EMOJI}`)],
    ['заметка операции', (f) => (f.transactions[0].note = `Обед ${CUT_EMOJI}`)],
  ];

  it.each(cases)('отвергается целиком: %s, в базе ничего не меняется', async (_n, mutate) => {
    const file = await validFile();
    mutate(file);
    const dst = await fresh();
    const before = await dump(dst);
    const err = await importBackup(dst, file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(MESSAGE);
    expect((err as Error).message).toMatch(/Резервная копия/); // сказано, где искать
    expect(await dump(dst)).toBe(before);
  });

  it('JSON-текст с «\\ud83d» (так записывает JSON одинокую половинку) после разбора тоже отвергается', async () => {
    const file = await validFile();
    file.transactions[0].note = `Обед ${CUT_EMOJI}`;
    const text = JSON.stringify(file);
    expect(text).toContain('\\ud83d'); // в файле это экранирование JSON, а не сам символ
    const parsed = JSON.parse(text) as Json;
    expect(hasLoneSurrogate(parsed.transactions[0].note)).toBe(true);
    const dst = await fresh();
    await expect(importBackup(dst, parsed)).rejects.toThrow(MESSAGE);
  });

  it('целые смайлики в копии принимаются и возвращаются без изменений', async () => {
    const file = await validFile();
    file.wallets[0].name = `Нал ${FULL_EMOJI}`;
    file.transactions[0].note = `Обед ${FULL_EMOJI}🍽️`;
    const dst = await fresh();
    await importBackup(dst, file);
    const again = await exportBackup(dst);
    expect(again.wallets.find((w) => w.id === file.wallets[0].id)?.name).toBe(`Нал ${FULL_EMOJI}`);
    expect(again.transactions.find((t) => t.id === file.transactions[0].id)?.note).toBe(`Обед ${FULL_EMOJI}🍽️`);
  });
});
