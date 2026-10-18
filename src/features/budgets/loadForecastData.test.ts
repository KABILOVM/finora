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

  it('комиссия регулярного перевода между своими кошельками вычтена заранее: после проведения в «сегодня» и «обычно» не входит', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_400, occurredOn: '2026-10-01' });
    const move = await s.recurring.create({ kind: 'transfer', walletId: cash, toWalletId: card.id, amountMinor: 11_700, toAmountMinor: 10_000, frequency: 'monthly', startOn: '2026-10-05' });
    await s.transactions.createFromRule(move.id, '2026-10-05');
    const today = await s.recurring.create({ kind: 'transfer', walletId: cash, toWalletId: card.id, amountMinor: 10_500, toAmountMinor: 10_000, frequency: 'monthly', startOn: TODAY });
    await s.transactions.createFromRule(today.id, TODAY);
    await s.budgets.create({ categoryId: null, amountMinor: 1_000_000 });
    const data = await load(s);
    expect(data.spentTodayMinor).toBe(0);
    expect(data.usualPerDayMinor).toBe(100); // 1 400 ÷ 14
    expect(data.totalBudget?.spentTodayMinor).toBe(0);
    expect(data.totalBudget?.spentMonthMinor).toBe(3_600); // в лимит комиссии легли: 1 400 + 1 700 + 500
    expect(data.rules.find((r) => r.id === today.id)?.toAmountMinor).toBe(10_000); // прогноз видит комиссию заранее
  });

  it('зарплату сегодня внесли обычной операцией, а не «Провести»: второй раз её не ждём', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const salary = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, frequency: 'monthly', startOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(salary.id, TODAY))).toBe(false);
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, occurredOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(salary.id, TODAY))).toBe(true);
  });

  it('мелкий доход сегодня зарплату не «закрывает»', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const salary = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, frequency: 'monthly', startOn: TODAY });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 5_000, occurredOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(salary.id, TODAY))).toBe(false);
  });
});

describe('loadForecastData: доход, внесённый через «+», закрывает своё правило', () => {
  const setup = async (order: 'side-first' | 'salary-first') => {
    const s = await freshStore();
    const cash = await cashId(s);
    const ids = order === 'side-first' ? ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] : ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'];
    const side = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 50_000, frequency: 'monthly', startOn: TODAY }, { id: ids[0] });
    const salary = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, frequency: 'monthly', startOn: TODAY }, { id: ids[1] });
    return { s, cash, side, salary };
  };

  it('самое крупное правило — первым, и ему самая близкая по сумме операция: порядок правил в базе не важен', async () => {
    for (const order of ['side-first', 'salary-first'] as const) {
      const { s, cash, side, salary } = await setup(order);
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, occurredOn: TODAY });
      const data = await load(s);
      expect(data.doneOccurrences.has(occurrenceKey(salary.id, TODAY)), order).toBe(true);
      expect(data.doneOccurrences.has(occurrenceKey(side.id, TODAY)), order).toBe(false);
    }
  });

  it('чуть меньше плана — тоже зарплата; копейки — нет', async () => {
    const { s, cash, salary } = await setup('side-first');
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 990_000, occurredOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(salary.id, TODAY))).toBe(true);
  });

  it('зарплату внесли на день раньше — завтрашнюю дату второй раз не ждём', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const salary = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, frequency: 'monthly', startOn: '2026-10-16' });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, occurredOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(salary.id, '2026-10-16'))).toBe(true);
  });

  it('возврат по долгу по расписанию обычной операцией не закрывается — даже когда других правил нет', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const debt = await s.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 300_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: null });
    const back = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 100_000, frequency: 'monthly', startOn: TODAY, debtId: debt.id });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: TODAY });
    expect((await load(s)).doneOccurrences.has(occurrenceKey(back.id, TODAY))).toBe(false);
  });

  it('возврат по долгу по расписанию обычной операцией не закрывается (и зарплату не «съедает»)', async () => {
    const s = await freshStore();
    const cash = await cashId(s);
    const debt = await s.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 300_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: null });
    const back = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 100_000, frequency: 'monthly', startOn: TODAY, debtId: debt.id }, { id: '00000000-0000-4000-8000-000000000001' });
    const salary = await s.recurring.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, frequency: 'monthly', startOn: TODAY }, { id: '00000000-0000-4000-8000-000000000002' });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000, occurredOn: TODAY });
    const data = await load(s);
    expect(data.doneOccurrences.has(occurrenceKey(salary.id, TODAY))).toBe(true);
    expect(data.doneOccurrences.has(occurrenceKey(back.id, TODAY))).toBe(false);
  });
});
