import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { forecastLookaheadEnd, occurrenceKey } from '@/domain/forecast';
import { loadForecastData, type ForecastData } from './useDailyForecast';

/** Загрузчик прогноза напрямую, без экрана: «сегодня» передаётся явно — 15 октября 2026. */
const TODAY = '2026-10-15';
const stores: Store[] = [];

async function freshStore(): Promise<Store> {
  const store = await openStore('user-forecast-1', { deviceId: 'device-test', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  stores.push(store);
  await ensureSeeded(store);
  return store;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

async function cashId(s: Store): Promise<string> {
  return (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
}

async function load(s: Store, horizonEnd?: string): Promise<ForecastData> {
  const loaded = await loadForecastData(s, TODAY, horizonEnd);
  if (loaded === null || loaded.overflow) throw new Error('ожидались данные');
  return loaded.data;
}

describe('loadForecastData: проведённые даты правил', () => {
  it('по умолчанию собираются на всё окно прогноза: аренда, проведённая на 40 дней вперёд, не вычтется второй раз', async () => {
    const s = await freshStore();
    const rule = await s.recurring.create({ kind: 'expense', walletId: await cashId(s), amountMinor: 30_000, frequency: 'monthly', startOn: '2026-11-24' });
    await s.transactions.createFromRule(rule.id, '2026-11-24'); // 15.10 + 40
    const data = await load(s);
    expect(data.doneOccurrences.has(occurrenceKey(rule.id, '2026-11-24'))).toBe(true);
    expect(forecastLookaheadEnd(TODAY)).toBe('2026-11-29');
  });

  it('просроченные даты: правило получает overdueFrom, а пропущенная прошлая дата попадает в «проведено или пропущено»', async () => {
    const s = await freshStore();
    const rule = await s.recurring.create({ kind: 'expense', walletId: await cashId(s), amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-10' });
    const stamp = '2026-10-01T07:00:00.000Z';
    await s.db.recurring_rules.update(rule.id, { createdAt: stamp, clientUpdatedAt: stamp });
    await s.transactions.skipOccurrence(rule.id, '2026-10-10');
    const data = await load(s);
    expect(data.rules.find((r) => r.id === rule.id)?.overdueFrom).toBe('2026-10-10');
    expect(data.doneOccurrences.has(occurrenceKey(rule.id, '2026-10-10'))).toBe(true);
  });
});

describe('loadForecastData: «сегодня потрачено» и «обычно»', () => {
  it('операция по регулярному платежу не входит ни в «сегодня потрачено», ни в «обычно»; в лимит месяца — входит, но не в «сегодня» лимита', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000, occurredOn: '2026-10-01' });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 2_000, occurredOn: TODAY });
    const rent = await s.recurring.create({ kind: 'expense', walletId: cash, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-05' });
    await s.transactions.createFromRule(rent.id, '2026-10-05');
    const today = await s.recurring.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, frequency: 'monthly', startOn: TODAY });
    await s.transactions.createFromRule(today.id, TODAY);
    await s.budgets.create({ categoryId: null, amountMinor: 1_000_000 });

    const data = await load(s);
    expect(data.spentTodayMinor).toBe(2_000);
    expect(data.usualPerDayMinor).toBe(71); // 1 000 ÷ 14 дней с первой операции
    expect(data.totalBudget?.spentTodayMinor).toBe(2_000); // проведённая сегодня — до проведения уже была отложена из лимита
    expect(data.totalBudget?.spentMonthMinor).toBe(83_000);
  });

  it('«обычно»: траты с накоплений не входят, траты с карты, убранной потом в архив, — входят; комиссия перевода — по кошельку списания', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_400, occurredOn: '2026-10-01' });
    const box = await s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 500_000, color: '#2563eb', icon: '🪙' });
    await s.transactions.create({ kind: 'expense', walletId: box.id, amountMinor: 100_000, occurredOn: '2026-10-02' });
    const card = await s.wallets.create({ name: 'Старая карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💳' });
    await s.transactions.create({ kind: 'expense', walletId: card.id, amountMinor: 1_400, occurredOn: '2026-10-03' });
    await s.wallets.archive(card.id);
    // комиссия перевода = списано − зачислено
    await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: box.id, amountMinor: 11_400, toAmountMinor: 10_000, occurredOn: '2026-10-04' });
    await s.transactions.create({ kind: 'transfer', walletId: box.id, toWalletId: cash, amountMinor: 17_000, toAmountMinor: 10_000, occurredOn: '2026-10-05' });

    const data = await load(s);
    expect(data.usualPerDayMinor).toBe(300); // (1 400 + 1 400 + 1 400) ÷ 14
  });
});

describe('loadForecastData: просроченные после правки правила и комиссия регулярного перевода', () => {
  it('правка правила (имя, «Проводить само») неоплаченную прошлую дату не прячет', async () => {
    const s = await freshStore();
    const rule = await s.recurring.create({ kind: 'expense', walletId: await cashId(s), amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-10' });
    const stamp = '2026-10-01T07:00:00.000Z';
    await s.db.recurring_rules.update(rule.id, { createdAt: stamp, clientUpdatedAt: stamp });
    await s.recurring.update(rule.id, { note: 'Аренда', autoPost: 1 }); // правка сегодня
    const data = await load(s);
    expect(data.rules.find((r) => r.id === rule.id)?.overdueFrom).toBe('2026-10-10');
  });

  it('комиссия регулярного перевода между своими обычными кошельками — обычная трата: входит в «сегодня» и в «обычно»', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_400, occurredOn: '2026-10-01' });
    const move = await s.recurring.create({ kind: 'transfer', walletId: cash, toWalletId: card.id, amountMinor: 11_700, toAmountMinor: 10_000, frequency: 'monthly', startOn: '2026-10-05' });
    await s.transactions.createFromRule(move.id, '2026-10-05');
    const today = await s.recurring.create({ kind: 'transfer', walletId: cash, toWalletId: card.id, amountMinor: 10_500, toAmountMinor: 10_000, frequency: 'monthly', startOn: TODAY });
    await s.transactions.createFromRule(today.id, TODAY);
    const data = await load(s);
    expect(data.spentTodayMinor).toBe(500);
    expect(data.usualPerDayMinor).toBe(221); // (1 400 + 1 700) ÷ 14
  });
});
