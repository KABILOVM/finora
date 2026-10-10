import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { exportBackup, exportTransactionsCsv, importBackup, ValidationError, type BackupFile, type Store } from '@/db';
import { basics, expense, makeStore, USER_A, USER_B } from './helpers';

/** Источник с данными: настройки, 2 кошелька, 2 категории, расход, доход, перевод, удалённая операция. */
async function populated(store: Store) {
  const b = await basics(store);
  const e1 = await expense(store, b.cash.id, 12_050, { categoryId: b.food.id, note: 'Обед' });
  await store.transactions.create({ kind: 'income', walletId: b.cash.id, amountMinor: 500_000, categoryId: b.salary.id, occurredOn: '2026-10-01' });
  await store.transactions.create({ kind: 'transfer', walletId: b.cash.id, toWalletId: b.usd.id, amountMinor: 10_900, toAmountMinor: 1000, occurredOn: '2026-10-02' });
  const gone = await expense(store, b.usd.id, 300, { fx: { rate: 10.9, source: 'nbt' } });
  await store.transactions.softDelete(gone.id);
  return { ...b, e1, gone };
}

const fresh = () => makeStore({ factory: new IDBFactory() });
const clone = (f: BackupFile): Record<string, any> => JSON.parse(JSON.stringify(f));

async function snapshotDb(store: Store) {
  return JSON.stringify(await Promise.all([store.db.settings, store.db.wallets, store.db.categories, store.db.transactions].map((t) => t.toArray())));
}

describe('exportBackup', () => {
  it('формат, версия, все разделы; удалённые операции включены; служебных полей нет', async () => {
    const store = await fresh();
    const { gone } = await populated(store);
    const file = await exportBackup(store);
    expect(file).toMatchObject({ format: 'finora-backup', version: 1 });
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
    expect(file.settings?.id).toBe(store.userId);
    expect(file.wallets).toHaveLength(2);
    expect(file.categories).toHaveLength(2);
    expect(file.transactions).toHaveLength(4);
    expect(file.transactions.find((t) => t.id === gone.id)?.deletedAt).not.toBeNull();
    for (const row of [...file.wallets, ...file.categories, ...file.transactions, file.settings!]) {
      expect(row).not.toHaveProperty('dirty');
      expect(row).not.toHaveProperty('serverSeq');
      expect(row).not.toHaveProperty('syncError');
    }
  });

  it('пустая база экспортируется без ошибок', async () => {
    const store = await fresh();
    const file = await exportBackup(store);
    expect(file).toMatchObject({ settings: null, wallets: [], categories: [], transactions: [] });
  });
});

describe('importBackup — круговой обмен', () => {
  it('экспорт → JSON → импорт на другом устройстве даёт те же данные; всё помечено dirty', async () => {
    const src = await fresh();
    await populated(src);
    const text = JSON.stringify(await exportBackup(src));

    const dst = await fresh();
    const res = await importBackup(dst, JSON.parse(text));
    expect(res).toEqual({ added: 1 + 2 + 2 + 4, replaced: 0, keptLocal: 0 });

    const again = await exportBackup(dst);
    const orig = JSON.parse(text) as BackupFile;
    expect({ ...again, exportedAt: '' }).toEqual({ ...orig, exportedAt: '' });
    const rows = [...(await dst.db.wallets.toArray()), ...(await dst.db.categories.toArray()), ...(await dst.db.transactions.toArray()), ...(await dst.db.settings.toArray())];
    expect(rows.every((r) => r.dirty === 1 && r.syncError === null && r.serverSeq === null)).toBe(true);
    expect(await dst.sync.counts()).toEqual({ pending: 9, quarantined: 0 });
  });

  it('повторный импорт того же файла ничего не меняет', async () => {
    const src = await fresh();
    await populated(src);
    const file = await exportBackup(src);
    const dst = await fresh();
    await importBackup(dst, file);
    const before = await snapshotDb(dst);
    const res = await importBackup(dst, file);
    expect(res).toEqual({ added: 0, replaced: 0, keptLocal: 9 });
    expect(await snapshotDb(dst)).toBe(before);
  });

  it('вызывает onLocalChange после успеха и не вызывает при отказе', async () => {
    const src = await fresh();
    await populated(src);
    const file = await exportBackup(src);
    const dst = await fresh();
    const seen = vi.fn();
    dst.onLocalChange(seen);
    await expect(importBackup(dst, { ...file, version: 9 })).rejects.toBeInstanceOf(ValidationError);
    expect(seen).not.toHaveBeenCalled();
    await importBackup(dst, file);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('лишние и служебные поля из файла отбрасываются', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    file.evil = '<script>';
    file.wallets[0].evil = 'x';
    file.wallets[0].dirty = 0;
    file.wallets[0].serverSeq = 99999;
    file.wallets[0].syncError = 'подмена';
    // настоящий файл приходит из JSON.parse: ключ «__proto__» там — обычное собственное поле
    const hostile = JSON.parse(JSON.stringify(file).replace('"wallets":[{', '"wallets":[{"__proto__":{"polluted":true},'));
    const dst = await fresh();
    await importBackup(dst, hostile);
    const w = (await dst.db.wallets.get(file.wallets[0].id)) as unknown as Record<string, unknown>;
    expect(w).toMatchObject({ dirty: 1, serverSeq: null, syncError: null });
    expect(w['evil']).toBeUndefined();
    expect(Object.getPrototypeOf(w)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('importBackup — мусорные файлы: ничего не записывается', () => {
  const garbage: [string, unknown][] = [
    ['null', null],
    ['число', 42],
    ['строка', 'привет'],
    ['массив', []],
    ['пустой объект', {}],
    ['чужой формат', { format: 'other', version: 1 }],
    ['более новая версия', { format: 'finora-backup', version: 2, exportedAt: '2026-01-01T00:00:00.000Z', wallets: [], categories: [], transactions: [], settings: null }],
    ['нет списков', { format: 'finora-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z' }],
    ['нет даты создания', { format: 'finora-backup', version: 1, wallets: [], categories: [], transactions: [] }],
    ['списки не массивы', { format: 'finora-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', wallets: {}, categories: 'x', transactions: null }],
  ];
  it.each(garbage)('%s', async (_n, data) => {
    const store = await fresh();
    await populated(store);
    const before = await snapshotDb(store);
    await expect(importBackup(store, data)).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshotDb(store)).toBe(before);
  });

  it('слишком много записей', async () => {
    const store = await fresh();
    const file = clone(await exportBackup(store));
    file.wallets = Array.from({ length: 1001 }, () => ({}));
    await expect(importBackup(store, file)).rejects.toThrow(/Слишком много записей/);
  });

  /** Каждая правка портит ОДНУ запись в корректном файле; одна ошибка — и откат всего файла. */
  type Mutate = (f: Record<string, any>) => void;
  const lastTx = (f: Record<string, any>) => f.transactions[f.transactions.length - 1];
  const expenseTx = (f: Record<string, any>) => f.transactions.find((t: any) => t.kind === 'expense' && t.deletedAt === null);
  const transferTx = (f: Record<string, any>) => f.transactions.find((t: any) => t.kind === 'transfer');
  const broken: [string, Mutate, RegExp][] = [
    ['дробная сумма', (f) => (expenseTx(f).amountMinor = 10.5), /Сумма/],
    ['огромная сумма за пределом безопасных целых', (f) => (expenseTx(f).amountMinor = Number.MAX_SAFE_INTEGER + 1), /Сумма/],
    ['сумма 1e300', (f) => (expenseTx(f).amountMinor = 1e300), /Сумма/],
    ['сумма Infinity (в JSON станет null)', (f) => (expenseTx(f).amountMinor = null), /Сумма/],
    ['сумма текстом', (f) => (expenseTx(f).amountMinor = '100'), /Сумма/],
    ['нулевая сумма', (f) => (expenseTx(f).amountMinor = 0), /больше нуля/],
    ['отрицательная сумма', (f) => (expenseTx(f).amountMinor = -1), /больше нуля/],
    ['отрицательная сумма в базовой валюте', (f) => (expenseTx(f).baseAmountMinor = -1), /базовой валюте/],
    ['дробный остаток кошелька', (f) => (f.wallets[0].openingBalanceMinor = 0.1), /остаток/],
    ['31 февраля', (f) => (expenseTx(f).occurredOn = '2026-02-31'), /дата/],
    ['заметка длиннее 500', (f) => (expenseTx(f).note = 'я'.repeat(501)), /Заметка/],
    ['неизвестный вид операции', (f) => (expenseTx(f).kind = 'loan'), /Вид операции/],
    ['перевод с категорией', (f) => (transferTx(f).categoryId = f.categories[0].id), /категории/],
    ['перевод на тот же кошелёк', (f) => (transferTx(f).toWalletId = transferTx(f).walletId), /отличаться/],
    ['перевод без суммы зачисления', (f) => (transferTx(f).toAmountMinor = null), /сумма зачисления/],
    ['расход с кошельком зачисления', (f) => (expenseTx(f).toWalletId = f.wallets[0].id), /только у перевода/],
    ['у перевода курс', (f) => (transferTx(f).fxRate = 1), /курс/i],
    ['у расхода нет курса', (f) => (expenseTx(f).fxRate = null), /Курс/],
    ['курс нулевой', (f) => (expenseTx(f).fxRate = 0), /Курс/],
    ['«same» с курсом не 1', (f) => (expenseTx(f).fxRate = 2), /курс должен быть 1/],
    ['неизвестный источник курса', (f) => (expenseTx(f).fxSource = 'гадание'), /Источник курса/],
    ['валюта кошелька строчными', (f) => (f.wallets[0].currency = 'tjs'), /валют/i],
    ['неизвестный вид кошелька', (f) => (f.wallets[0].kind = 'crypto'), /Вид кошелька/],
    ['пустое название категории', (f) => (f.categories[0].name = '  '), /Название/],
    ['метка времени не каноничная', (f) => (f.wallets[0].clientUpdatedAt = '2026-10-01 10:00:00'), /метка времени/],
    ['createdAt нет', (f) => delete f.wallets[0].createdAt, /Дата создания/],
    ['id с пробелом', (f) => (f.wallets[0].id = 'a b'), /идентификатор/],
    ['id пустой', (f) => (f.categories[0].id = ''), /идентификатор/],
    ['deviceId с пробелами', (f) => (f.wallets[0].deviceId = 'a b'), /Устройство/],
    ['повторяющийся id кошелька', (f) => (f.wallets[1].id = f.wallets[0].id), /повторяющийся/],
    ['повторяющийся id операции', (f) => (lastTx(f).id = f.transactions[0].id), /повторяющийся/],
    ['запись не объект', (f) => (f.wallets[0] = 'строка'), /объект/],
    ['операция на несуществующий кошелёк', (f) => (expenseTx(f).walletId = '99999999-9999-4999-8999-999999999999'), /несуществующий кошелёк/],
    ['перевод на несуществующий кошелёк', (f) => (transferTx(f).toWalletId = '99999999-9999-4999-8999-999999999999'), /несуществующий кошелёк/],
    ['операция в несуществующей категории', (f) => (expenseTx(f).categoryId = '99999999-9999-4999-8999-999999999999'), /несуществующую категорию/],
    ['вид категории не совпадает с видом операции', (f) => (expenseTx(f).categoryId = f.categories.find((c: any) => c.kind === 'income').id), /не подходит/],
    ['родитель категории не найден', (f) => (f.categories[0].parentId = '99999999-9999-4999-8999-999999999999'), /нет родительской/],
    ['категория — родитель самой себе', (f) => (f.categories[0].parentId = f.categories[0].id), /самой себе/],
    ['кошелёк по умолчанию не найден', (f) => (f.settings.defaultWalletId = '99999999-9999-4999-8999-999999999999'), /по умолчанию/],
    ['настройки: неверная неделя', (f) => (f.settings.weekStartsOn = 5), /недели/],
    ['копия другого аккаунта', (f) => (f.settings.id = USER_B), /другому аккаунту/],
  ];

  it.each(broken)('отвергает: %s', async (_name, mutate, message) => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    mutate(file);
    const dst = await fresh();
    await populated(dst); // в базе уже есть данные — они обязаны остаться нетронутыми
    const before = await snapshotDb(dst);
    await expect(importBackup(dst, file)).rejects.toThrow(message);
    await expect(importBackup(dst, file)).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshotDb(dst)).toBe(before);
  });

  it('суммы, которые вместе переполняют остаток, отвергаются', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    const file = clone(await exportBackup(src));
    // каждое число в границах сервера (≤ 1e15), но вместе они не помещаются в безопасное целое (≈ 9e15)
    file.wallets.find((w: any) => w.id === cash.id).openingBalanceMinor = 1_000_000_000_000_000;
    const income = file.transactions.find((t: any) => t.kind === 'income');
    income.amountMinor = 1_000_000_000_000_000;
    income.baseAmountMinor = 1_000_000_000_000_000;
    for (let i = 0; i < 9; i++) file.transactions.push({ ...income, id: crypto.randomUUID() });
    const dst = await fresh();
    await expect(importBackup(dst, file)).rejects.toThrow(/слишком велики/);
    expect(await dst.db.wallets.count()).toBe(0);
  });

  it('ошибка в последней записи большого файла не оставляет записанной первую половину', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    lastTx(file).amountMinor = -5;
    const dst = await fresh();
    await expect(importBackup(dst, file)).rejects.toBeInstanceOf(ValidationError);
    expect(await dst.db.wallets.count()).toBe(0);
    expect(await dst.db.categories.count()).toBe(0);
    expect(await dst.db.settings.count()).toBe(0);
  });

  it('сбой записи в середине импорта откатывает всё', async () => {
    const src = await fresh();
    await populated(src);
    const file = await exportBackup(src);
    const dst = await fresh();
    const proto = Object.getPrototypeOf(dst.db.transactions) as { bulkPut: (...a: unknown[]) => unknown };
    const original = proto.bulkPut;
    let calls = 0;
    const spy = vi.spyOn(proto, 'bulkPut').mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls += 1;
      if (calls === 3) return Promise.reject(new Error('квота исчерпана'));
      return original.apply(this, args);
    });
    await expect(importBackup(dst, file)).rejects.toThrow(/квота/);
    spy.mockRestore();
    expect(await dst.db.wallets.count()).toBe(0);
    expect(await dst.db.categories.count()).toBe(0);
    expect(await dst.db.transactions.count()).toBe(0);
  });
});

describe('importBackup — «новее побеждает», новые локальные данные не затираются', () => {
  it('локальная правка после экспорта остаётся; в облако уходит она, а не старая из файла', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    const file = await exportBackup(src);
    await src.wallets.update(cash.id, { name: 'Переименован позже' });
    const res = await importBackup(src, file);
    expect(res.keptLocal).toBeGreaterThanOrEqual(1);
    expect((await src.db.wallets.get(cash.id))?.name).toBe('Переименован позже');
  });

  it('удаление операции после экспорта не отменяется импортом старой копии', async () => {
    const src = await fresh();
    const { e1 } = await populated(src);
    const file = await exportBackup(src);
    await src.transactions.softDelete(e1.id);
    await importBackup(src, file);
    expect((await src.db.transactions.get(e1.id))?.deletedAt).not.toBeNull();
  });

  it('версия в файле новее локальной — заменяет, помечается dirty, serverSeq сохраняется', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    await src.wallets.update(cash.id, { name: 'Новое имя из файла' });
    const file = await exportBackup(src);

    const dst = await fresh();
    await importBackup(dst, await exportBackup(await (async () => { const o = await fresh(); await populated(o); return o; })())); // чужие данные, другие id
    // отправленная и принятая сервером локальная версия того же кошелька (старее файла)
    await dst.sync.applyRemotePage('wallets', [{ entity: { ...file.wallets.find((w) => w.id === cash.id)!, name: 'Старое имя', clientUpdatedAt: '2026-01-01T00:00:00.000Z' }, serverSeq: 7 }], 7);
    const res = await importBackup(dst, file);
    expect(res.replaced).toBeGreaterThanOrEqual(1);
    expect(await dst.db.wallets.get(cash.id)).toMatchObject({ name: 'Новое имя из файла', dirty: 1, serverSeq: 7, syncError: null });
  });

  it('локальная чистая новее файла остаётся чистой (ничего лишнего в облако)', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    const file = await exportBackup(src);
    const dst = await fresh();
    const newer = { ...file.wallets.find((w) => w.id === cash.id)!, name: 'С сервера, новее', clientUpdatedAt: new Date(Date.now() + 60_000).toISOString() };
    await dst.sync.applyRemotePage('wallets', [{ entity: newer, serverSeq: 3 }], 3);
    await importBackup(dst, file);
    expect(await dst.db.wallets.get(cash.id)).toMatchObject({ name: 'С сервера, новее', dirty: 0, serverSeq: 3 });
  });

  it('равные метки, разные устройства: побеждает большее deviceId — как при синхронизации', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    const file = clone(await exportBackup(src));
    const w = file.wallets.find((x: any) => x.id === cash.id);
    const dst = await fresh();
    await dst.sync.applyRemotePage('wallets', [{ entity: { ...w, name: 'локальное', deviceId: 'device-m-5555' }, serverSeq: 1 }], 1);
    w.deviceId = 'device-a-0001'; // меньше — проигрывает
    await importBackup(dst, file);
    expect((await dst.db.wallets.get(cash.id))?.name).toBe('локальное');
    w.deviceId = 'device-z-9999'; // больше — выигрывает
    await importBackup(dst, file);
    expect((await dst.db.wallets.get(cash.id))?.name).toBe(w.name);
  });

  it('после импорта следующая правка нового кошелька новее импортированных строк (часы учли файл)', async () => {
    const src = await fresh();
    const { cash } = await populated(src);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const file = clone(await exportBackup(src));
    file.wallets.find((x: any) => x.id === cash.id).clientUpdatedAt = soon;
    const dst = await fresh();
    await importBackup(dst, file);
    const edited = await dst.wallets.update(cash.id, { name: 'после импорта' });
    expect(edited.clientUpdatedAt > soon).toBe(true);
  });

  it('импорт в другой аккаунт того же устройства невозможен, а в свой — возможен', async () => {
    const src = await makeStore({ userId: USER_A, factory: new IDBFactory() });
    await populated(src);
    const file = await exportBackup(src);
    const other = await makeStore({ userId: USER_B, factory: new IDBFactory() });
    await expect(importBackup(other, file)).rejects.toThrow(/другому аккаунту/);
    expect(await other.db.wallets.count()).toBe(0);
  });
});

describe('exportTransactionsCsv', () => {
  it('BOM, разделитель «;», заголовок, суммы с запятой, названия, удалённые не попадают', async () => {
    const store = await fresh();
    await populated(store);
    const csv = await exportTransactionsCsv(store);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Дата;Вид;Кошелёк;Категория;Сумма;Валюта;Кошелёк зачисления;Сумма зачисления;Валюта зачисления;Заметка');
    expect(lines).toContain('2026-10-05;Расход;Нал;Еда;120,50;TJS;;;;Обед');
    expect(lines).toContain('2026-10-01;Доход;Нал;Зарплата;5000,00;TJS;;;;');
    expect(lines).toContain('2026-10-02;Перевод;Нал;;109,00;TJS;Доллары;10,00;USD;');
    expect(lines.filter((l) => l.startsWith('20'))).toHaveLength(3); // удалённая не вошла
    expect(lines.at(-1)).toBe('');
    // по возрастанию даты
    const dates = lines.filter((l) => l.startsWith('20')).map((l) => l.slice(0, 10));
    expect(dates).toEqual([...dates].sort());
  });

  it('валюты без копеек (JPY) и крупные суммы (до 1e15) печатаются без потерь', async () => {
    const store = await fresh();
    await store.settings.ensure({ baseCurrency: 'JPY' });
    const w = await store.wallets.create({ name: 'Иена', currency: 'JPY', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await expense(store, w.id, 1_000_000_000_000_000);
    const csv = await exportTransactionsCsv(store);
    expect(csv).toContain(';1000000000000000;JPY;');
  });

  it('текст из заметки/названий не исполняется как формула; кавычки и переводы строк экранируются', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    await expense(store, cash.id, 100, { note: '=HYPERLINK("http://evil")' });
    await expense(store, cash.id, 100, { note: '+1;2' });
    await expense(store, cash.id, 100, { note: '@cmd' });
    await expense(store, cash.id, 100, { note: 'строка "с кавычками"; и точкой с запятой' });
    const csv = await exportTransactionsCsv(store);
    expect(csv).toContain(`;"'=HYPERLINK(""http://evil"")"\r\n`);
    expect(csv).toContain(`;"'+1;2"\r\n`);
    expect(csv).toContain(`;'@cmd\r\n`);
    expect(csv).toContain(`;"строка ""с кавычками""; и точкой с запятой"\r\n`);
  });

  it('пустая база — только заголовок', async () => {
    const store = await fresh();
    const csv = await exportTransactionsCsv(store);
    expect(csv.slice(1).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('importBackup — метки из будущего и правила репозиториев', () => {
  it('метки с убежавших вперёд часов подрезаются до «сейчас + 5 минут»; следующая правка новее импортированного', async () => {
    const real = Date.now();
    const phone = await makeStore({ factory: new IDBFactory(), now: () => real + 3 * 3_600_000, deviceId: 'device-fast-0002' });
    const { cash } = await basics(phone);
    await phone.transactions.softDelete((await expense(phone, cash.id, 100)).id);
    const file = clone(await exportBackup(phone));

    const dst = await makeStore({ factory: new IDBFactory(), now: () => real });
    await importBackup(dst, file);
    const limit = new Date(Date.now() + 5 * 60_000).toISOString();
    for (const t of [dst.db.settings, dst.db.wallets, dst.db.categories, dst.db.transactions]) {
      for (const r of await t.toArray()) {
        expect(r.clientUpdatedAt <= limit && r.createdAt <= limit && (r.deletedAt === null || r.deletedAt <= limit)).toBe(true);
      }
    }
    const imported = (await dst.db.wallets.get(cash.id))!;
    const edited = await dst.wallets.update(cash.id, { name: 'После импорта' });
    expect(edited.clientUpdatedAt > imported.clientUpdatedAt).toBe(true);
  });

  it('метка после 2100 года больше не отвергает файл: подрезается (подробнее — backupClamp.test.ts)', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    file.wallets[0].clientUpdatedAt = '2100-01-01T00:00:00.001Z';
    const dst = await fresh();
    await expect(importBackup(dst, file)).resolves.toBeDefined();
    const limit = new Date(Date.now() + 5 * 60_000).toISOString();
    expect((await dst.db.wallets.get(file.wallets[0].id))!.clientUpdatedAt <= limit).toBe(true);
  });

  it('копия, где кошелёк переехал в другую валюту, а его операции — на другой кошелёк, загружается', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const a = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-laptop-2' });
    const b = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-phone-23' });
    const { cash, usd } = await basics(a);
    const tx = await expense(a, usd.id, 100, { fx: { rate: 10.9, source: 'manual' } });
    await importBackup(b, clone(await exportBackup(a)));
    // на ноутбуке операцию перенесли на «Нал», после чего у пустого «Доллары» сменили валюту
    t += 60_000;
    await a.transactions.update(tx.id, { walletId: cash.id });
    t += 60_000;
    await a.wallets.update(usd.id, { currency: 'EUR' });
    // телефон ещё держит операцию на «Доллары»: копия с ноутбука переносит операцию и меняет валюту вместе
    await expect(importBackup(b, clone(await exportBackup(a)))).resolves.toBeDefined();
    expect((await b.db.wallets.get(usd.id))?.currency).toBe('EUR');
    expect((await b.db.transactions.get(tx.id))?.walletId).toBe(cash.id);
  });

  it('копия меняет валюту кошелька, а локальная операция по нему осталась: отвергается, база нетронута', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const a = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-laptop-3' });
    const b = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-phone-24' });
    const { cash } = await basics(a);
    await importBackup(b, clone(await exportBackup(a)));
    t += 60_000;
    await b.wallets.update(cash.id, { currency: 'USD' });
    t += 60_000;
    await expense(a, cash.id, 5_000);
    const before = await snapshotDb(a);
    await expect(importBackup(a, clone(await exportBackup(b)))).rejects.toThrow(/меняет валюту кошелька/);
    expect(await snapshotDb(a)).toBe(before);
  });

  it('копия меняет вид категории, по которой локально есть живая операция: отвергается; по удалённой — нет', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const a = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-laptop-4' });
    const b = await makeStore({ factory: new IDBFactory(), now: () => t, deviceId: 'device-phone-25' });
    const { cash, food } = await basics(a);
    await importBackup(b, clone(await exportBackup(a)));
    t += 60_000;
    await b.categories.update(food.id, { kind: 'income' });
    t += 60_000;
    const live = await expense(a, cash.id, 5_000, { categoryId: food.id });
    const fileFromB = clone(await exportBackup(b));
    const before = await snapshotDb(a);
    await expect(importBackup(a, fileFromB)).rejects.toThrow(/меняет вид категории/);
    expect(await snapshotDb(a)).toBe(before);
    // та же операция удалена — вид категории уже ничему не мешает
    t += 60_000;
    await a.transactions.softDelete(live.id);
    await expect(importBackup(a, fileFromB)).resolves.toBeDefined();
    expect((await a.db.categories.get(food.id))?.kind).toBe('income');
  });
});
