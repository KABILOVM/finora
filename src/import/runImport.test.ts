import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { fixtureText } from './__fixtures__/load';
import { makeBigCsv } from './__fixtures__/bigCsv';
import { computeIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan } from './plan';
import { runImport, writeOrder } from './runImport';
import type { ImportPlan } from './types';

const USER = 'user-import-1';
const stores: Store[] = [];

async function freshStore(): Promise<Store> {
  const store = await openStore(USER, { deviceId: 'device-test', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  stores.push(store);
  await ensureSeeded(store);
  return store;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.restoreAllMocks();
});

/** План по тому, что сейчас лежит в базе (как это делает экран). */
async function planFor(store: Store, text: string, rates: Record<string, number> = { USD: 10.9 }): Promise<ImportPlan> {
  const parsed = parseZenmoney(text);
  const ids = await computeIds(store.userId, parsed);
  const [wallets, categories, txs] = await Promise.all([store.db.wallets.toArray(), store.db.categories.toArray(), store.db.transactions.toArray()]);
  return buildPlan({
    parsed,
    ids,
    baseCurrency: 'TJS',
    wallets,
    categories,
    existing: new Map(txs.map((t) => [t.id, t.deletedAt !== null])),
    rates,
  });
}

async function balancesByName(store: Store): Promise<Record<string, number>> {
  const [wallets, txs] = await Promise.all([store.db.wallets.toArray(), store.db.transactions.toArray()]);
  const b = computeBalances(wallets.filter((w) => w.deletedAt === null), txs);
  return Object.fromEntries(wallets.filter((w) => w.deletedAt === null).map((w) => [w.name, b.get(w.id)!]));
}

const liveTx = (store: Store) => store.db.transactions.filter((t) => t.deletedAt === null).toArray();

describe('runImport: образец basic.csv', () => {
  const text = fixtureText('basic.csv');

  it('записывает всё, что в плане, через репозитории: кошельки, категории, операции, остатки', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    expect(plan.counts.add).toBe(10);
    const report = await runImport(store, plan);

    expect(report).toMatchObject({ added: 10, failedCount: 0, stopped: false, fatal: null, createdWallets: 2, createdCategories: 1, alreadyThere: 0, review: 4, skipped: 2 });
    expect(await liveTx(store)).toHaveLength(10);

    // начальный остаток новых кошельков 0, остаток = сумма движений по файлу
    const bal = await balancesByName(store);
    expect(bal['Карта Алиф']).toBe(311450);
    expect(bal['Доллары']).toBe(8550);
    expect(bal['Наличные']).toBe(80000); // найден существующий «Наличные», начальный остаток 0
    const wallets = await store.db.wallets.toArray();
    expect(wallets.find((w) => w.name === 'Карта Алиф')).toMatchObject({ openingBalanceMinor: 0, currency: 'TJS', kind: 'other' });

    // отчёт для сверки: только созданные кошельки
    expect(report.reconcile.map((r) => [r.name, r.currency, r.fileBalanceMinor, r.created])).toEqual([
      ['Карта Алиф', 'TJS', 311450, true],
      ['Доллары', 'USD', 8550, true],
    ]);
  });

  it('снимок курса: небазовая валюта пересчитана по введённому курсу (manual), комиссия — расход, обмен — без комиссии', async () => {
    const store = await freshStore();
    await runImport(store, await planFor(store, text));
    const txs = await liveTx(store);
    const usdExpense = txs.find((t) => t.amountMinor === 4000)!;
    expect(usdExpense).toMatchObject({ kind: 'expense', baseCurrency: 'TJS', baseAmountMinor: 43600, fxRate: 10.9, fxSource: 'manual' });
    const usdIncome = txs.find((t) => t.amountMinor === 2550)!;
    expect(usdIncome).toMatchObject({ kind: 'income', baseAmountMinor: 27795, fxSource: 'manual' });
    const fee = txs.find((t) => t.kind === 'transfer' && t.amountMinor === 50000)!;
    expect(fee).toMatchObject({ toAmountMinor: 49500, baseAmountMinor: 500, fxRate: null, fxSource: null });
    const exchange = txs.find((t) => t.kind === 'transfer' && t.amountMinor === 109000)!;
    expect(exchange).toMatchObject({ toAmountMinor: 10000, baseAmountMinor: 0 });
    const tjs = txs.find((t) => t.amountMinor === 12050)!;
    expect(tjs).toMatchObject({ baseAmountMinor: 12050, fxRate: 1, fxSource: 'same', note: 'Корвон — Хлеб и молоко', occurredOn: '2026-09-02' });
    expect(txs.some((t) => t.occurredOn === '2024-02-29')).toBe(true);
  });

  it('категории: найденные используются, «Кафе» создана внутри «Еда»', async () => {
    const store = await freshStore();
    await runImport(store, await planFor(store, text));
    const cats = await store.db.categories.toArray();
    const food = cats.find((c) => c.name === 'Еда')!;
    const cafe = cats.find((c) => c.name === 'Кафе')!;
    expect(cafe).toMatchObject({ kind: 'expense', parentId: food.id });
    expect(cats.filter((c) => c.name === 'Еда')).toHaveLength(1);
    const txs = await liveTx(store);
    expect(txs.filter((t) => t.categoryId === cafe.id)).toHaveLength(2);
  });

  it('повторный импорт того же файла: ничего не добавляется и ничего не меняется', async () => {
    const store = await freshStore();
    await runImport(store, await planFor(store, text));
    const before = JSON.stringify({
      tx: (await store.db.transactions.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      w: (await store.db.wallets.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await store.db.categories.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    });

    const plan2 = await planFor(store, text);
    expect(plan2.counts).toMatchObject({ add: 0, exists: 10, waitRate: 0, blocked: 0 });
    const report = await runImport(store, plan2);
    expect(report).toMatchObject({ added: 0, createdWallets: 0, createdCategories: 0, alreadyThere: 10 });

    const after = JSON.stringify({
      tx: (await store.db.transactions.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      w: (await store.db.wallets.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await store.db.categories.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect(after).toBe(before);
  });

  it('повторный запуск того же ПЛАНА (двойной тап, повтор после сбоя) не задваивает', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    await runImport(store, plan);
    const second = await runImport(store, plan); // тот же устаревший план
    expect(second.failedCount).toBe(0);
    expect(await liveTx(store)).toHaveLength(10);
    expect((await store.db.wallets.toArray()).filter((w) => w.name === 'Карта Алиф')).toHaveLength(1);
  });

  it('два запуска одновременно: дублей нет', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    await Promise.all([runImport(store, plan, { chunkSize: 3 }), runImport(store, plan, { chunkSize: 3 })]);
    expect(await liveTx(store)).toHaveLength(10);
    expect(await store.db.transactions.count()).toBe(10);
  });

  it('удалённую человеком операцию повторный импорт не воскрешает и не затирает правки', async () => {
    const store = await freshStore();
    await runImport(store, await planFor(store, text));
    const all = await store.db.transactions.toArray();
    const deleted = all.find((t) => t.amountMinor === 12050)!;
    const edited = all.find((t) => t.amountMinor === 4000)!;
    await store.transactions.softDelete(deleted.id);
    await store.transactions.update(edited.id, { note: 'моя правка' });

    const plan = await planFor(store, text);
    expect(plan.counts).toMatchObject({ add: 0, exists: 10, existsDeleted: 1 });
    await runImport(store, plan);
    expect((await store.db.transactions.get(deleted.id))!.deletedAt).not.toBeNull();
    expect((await store.db.transactions.get(edited.id))!.note).toBe('моя правка');
    expect(await liveTx(store)).toHaveLength(9);
  });

  it('импорт той же выгрузки с добавленными строками добавляет только новые', async () => {
    const store = await freshStore();
    await runImport(store, await planFor(store, text));
    const more = text + '2026-09-20,Продукты,Корвон,Новая покупка,Карта Алиф,15.00,TJS,,0,,,,\n' + '2026-09-03,Еда / Кафе,Чойхона,"Обед, ""с коллегами""",Карта Алиф,85.00,TJS,,0,,,,\n';
    const plan = await planFor(store, more);
    expect(plan.counts).toMatchObject({ add: 2, exists: 10 }); // новая покупка и ТРЕТИЙ одинаковый обед
    await runImport(store, plan);
    expect(await liveTx(store)).toHaveLength(12);
  });
});

describe('runImport: остановка, продолжение, ошибки', () => {
  const text = fixtureText('basic.csv');

  it('остановка между порциями: записанное цело, повторный запуск дописывает остальное без дублей', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    const ctl = new AbortController();
    const seen: number[] = [];
    const first = await runImport(store, plan, {
      chunkSize: 3,
      signal: ctl.signal,
      onProgress: (p) => {
        if (p.phase === 'transactions') {
          seen.push(p.done);
          if (p.done >= 3) ctl.abort();
        }
      },
    });
    expect(first.stopped).toBe(true);
    expect(first.added).toBe(3);
    expect(await liveTx(store)).toHaveLength(3);
    expect(seen[0]).toBe(0);

    const second = await runImport(store, await planFor(store, text), { chunkSize: 3 });
    expect(second).toMatchObject({ added: 7, stopped: false, alreadyThere: 3 });
    expect(await liveTx(store)).toHaveLength(10);
  });

  it('остановка до начала: ничего не записано', async () => {
    const store = await freshStore();
    const ctl = new AbortController();
    ctl.abort();
    const r = await runImport(store, await planFor(store, text), { signal: ctl.signal });
    expect(r).toMatchObject({ stopped: true, added: 0 });
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('прогресс идёт от 0 до всего', async () => {
    const store = await freshStore();
    const steps: number[] = [];
    await runImport(store, await planFor(store, text), { chunkSize: 4, onProgress: (p) => p.phase === 'transactions' && steps.push(p.done) });
    expect(steps).toEqual([0, 4, 8, 10]);
  });

  for (const chunkSize of [250, 1]) {
    it(`одна плохая строка (порция по ${chunkSize}): остальные записаны, ошибка названа в отчёте`, async () => {
      const store = await freshStore();
      const plan = await planFor(store, text);
      const victim = plan.ops.find((o) => o.row.line === 3)!;
      victim.input = { ...victim.input!, amountMinor: 0 }; // репозиторий такое не примет
      const r = await runImport(store, plan, { chunkSize });
      expect(r.added).toBe(9);
      expect(r.failedCount).toBe(1);
      expect(r.failed[0]).toMatchObject({ line: 3 });
      expect(r.failed[0]!.reason).toMatch(/Сумма: должна быть больше нуля/);
      expect(r.failed[0]!.label).toMatch(/^2026-09-02/);
      expect(await liveTx(store)).toHaveLength(9);
      // исправили — досыпается ровно одна
      const again = await runImport(store, await planFor(store, text));
      expect(again.added).toBe(1);
      expect(await liveTx(store)).toHaveLength(10);
    });
  }

  it('кошелёк не создался — его операции в отчёте «не импортировано», остальные записаны', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    const usd = plan.wallets.find((w) => w.name === 'Доллары')!;
    if (usd.target.kind === 'create') usd.target = { ...usd.target, name: '' }; // имя пустое — репозиторий откажет
    const r = await runImport(store, plan);
    expect(r.createdWallets).toBe(1);
    expect(r.failedCount).toBe(3); // обмен, расход и доход в долларах
    expect(r.failed[0]!.reason).toMatch(/Название кошелька/);
    expect(r.added).toBe(7);
  });

  it('writeOrder: старые даты раньше, внутри дня — как в файле', async () => {
    const store = await freshStore();
    const plan = await planFor(store, text);
    const order = writeOrder(plan.ops).map((o) => o.row.line);
    expect(order[0]).toBe(11); // 2024-02-29
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5)); // одинаковая дата 2026-09-03: сначала строка 4
  });
});

describe('runImport: замер скорости на 5 000 строк', () => {
  it('порциями в одной транзакции; результат записан целиком', async () => {
    const store = await freshStore();
    const plan = await planFor(store, makeBigCsv(5000), {});
    const t0 = Date.now();
    const r = await runImport(store, plan);
    const ms = Date.now() - t0;
    console.info(`[замер] импорт ${r.added} операций порциями по 250: ${ms} мс (${((ms / r.added) * 1000).toFixed(0)} мкс на операцию)`);
    expect(r).toMatchObject({ added: plan.counts.add, failedCount: 0 });
    expect(r.added).toBeGreaterThan(4900);
    expect(await store.db.transactions.count()).toBe(r.added);
    expect(ms).toBeLessThan(120_000);
  }, 180_000);

  it('для сравнения: по одной операции (тот же код репозитория, 1 000 строк)', async () => {
    const store = await freshStore();
    const plan = await planFor(store, makeBigCsv(1000), {});
    const t0 = Date.now();
    const r = await runImport(store, plan, { oneByOne: true });
    const ms = Date.now() - t0;
    console.info(`[замер] импорт ${r.added} операций по одной: ${ms} мс (${((ms / r.added) * 1000).toFixed(0)} мкс на операцию)`);
    expect(r.failedCount).toBe(0);
  }, 180_000);

  it('повторный импорт 5 000 строк: все «уже есть», план строится быстро', async () => {
    const store = await freshStore();
    const text = makeBigCsv(5000);
    await runImport(store, await planFor(store, text, {}));
    const t0 = Date.now();
    const plan = await planFor(store, text, {});
    const ms = Date.now() - t0;
    console.info(`[замер] повторный план на 5 000 строк: ${ms} мс`);
    expect(plan.counts.add).toBe(0);
    expect(plan.counts.exists).toBeGreaterThan(4900);
  }, 180_000);
});
