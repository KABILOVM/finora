import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeStore } from '../../../tests/db/helpers';
import {
  daysBetween,
  lastLoggedOn,
  MISSED_MANY_DAYS,
  MISSED_MIN_DAYS,
  missedDays,
  missedText,
  readQuietThrough,
  writeQuietThrough,
} from './missedDays';

const TODAY = '2026-10-15';

describe('daysBetween', () => {
  it('считает сутки по календарю, в том числе через границу месяца, года и 29 февраля', () => {
    expect(daysBetween('2026-10-12', '2026-10-14')).toBe(2);
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
    expect(daysBetween('2026-09-29', '2026-10-02')).toBe(3);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-15', '2026-10-14')).toBe(-1);
  });
});

describe('missedDays', () => {
  const q = (lastLoggedOn: string | null, quietThrough: string | null = null, today = TODAY) =>
    missedDays({ lastLoggedOn, quietThrough, today });

  it('порог: один пропущенный день — плашки нет, два — есть', () => {
    expect(MISSED_MIN_DAYS).toBe(2);
    expect(q('2026-10-15')).toBeNull(); // запись сегодня
    expect(q('2026-10-14')).toBeNull(); // запись вчера
    expect(q('2026-10-13')).toBeNull(); // не было только вчера
    expect(q('2026-10-12')).toEqual({ days: 2, yesterday: '2026-10-14' }); // 13 и 14
    expect(q('2026-10-10')).toEqual({ days: 4, yesterday: '2026-10-14' });
  });

  it('сегодняшний день не считается пропущенным: он ещё не закончился', () => {
    expect(q('2026-10-13')).toBeNull();
  });

  it('новому человеку (записей нет совсем) плашка не нужна', () => {
    expect(q(null)).toBeNull();
    expect(q(null, '2026-10-14')).toBeNull();
  });

  it('«Ничего не тратил(а)» закрывает дни по указанную дату; позже снова считается', () => {
    expect(q('2026-10-10', '2026-10-14')).toBeNull();
    expect(q('2026-10-10', '2026-10-12')).toEqual({ days: 2, yesterday: '2026-10-14' }); // 13 и 14 снова без записей
    // ответ, данный раньше последней записи, ничего не меняет
    expect(q('2026-10-12', '2026-10-05')).toEqual({ days: 2, yesterday: '2026-10-14' });
    // ответ «на будущее» (часы сбились) не прячет плашку навсегда: после сегодняшней даты дней нет
    expect(q('2026-10-10', '2026-10-20')).toBeNull();
  });

  it('запись «из будущего» не может считаться последней: её отсеивает lastLoggedOn, а сюда дата не позже сегодня', () => {
    expect(q('2026-10-16')).toBeNull();
  });

  it('смена суток: те же данные завтра дают на день больше', () => {
    expect(q('2026-10-12', null, '2026-10-15')).toMatchObject({ days: 2 });
    expect(q('2026-10-12', null, '2026-10-16')).toMatchObject({ days: 3, yesterday: '2026-10-15' });
  });
});

describe('missedText', () => {
  it('склоняет: 2 дня, 5 дней, 21 день, 11 дней; месяц и больше — словами', () => {
    expect(missedText(2)).toBe('2 дня без записей — всё в порядке?');
    expect(missedText(3)).toBe('3 дня без записей — всё в порядке?');
    expect(missedText(5)).toBe('5 дней без записей — всё в порядке?');
    expect(missedText(11)).toBe('11 дней без записей — всё в порядке?');
    expect(missedText(21)).toBe('21 день без записей — всё в порядке?');
    expect(MISSED_MANY_DAYS).toBe(30);
    expect(missedText(29)).toBe('29 дней без записей — всё в порядке?');
    expect(missedText(30)).toBe('Больше месяца без записей — всё в порядке?');
    expect(missedText(400)).toBe('Больше месяца без записей — всё в порядке?');
  });
});

describe('отметка «Ничего не тратил(а)»', () => {
  const USER = 'u-missed-test';
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('пишется и читается для своего человека; null снимает', () => {
    expect(readQuietThrough(USER)).toBeNull();
    writeQuietThrough(USER, '2026-10-14');
    expect(readQuietThrough(USER)).toBe('2026-10-14');
    expect(readQuietThrough('другой')).toBeNull();
    writeQuietThrough(USER, null);
    expect(readQuietThrough(USER)).toBeNull();
  });

  it('мусор в хранилище читается как «не отвечал»', () => {
    localStorage.setItem(`finora:quiet-through:${USER}`, 'вчера');
    expect(readQuietThrough(USER)).toBeNull();
    localStorage.setItem(`finora:quiet-through:${USER}`, '2026-13-45');
    expect(readQuietThrough(USER)).toBeNull();
  });
});

describe('lastLoggedOn', () => {
  async function setup() {
    const store = await makeStore();
    await store.settings.ensure({ baseCurrency: 'TJS' }); // без настроек операции не вносятся
    const wallet = await store.wallets.create({ name: 'Кошелёк', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💵' });
    const add = (occurredOn: string, over: Record<string, unknown> = {}) =>
      store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100, occurredOn, ...over });
    return { store, wallet, add };
  }

  it('пустая база — null', async () => {
    const { store } = await setup();
    expect(await lastLoggedOn(store, TODAY)).toBeNull();
  });

  it('берётся самая поздняя дата записи не позже сегодняшней', async () => {
    const { store, add } = await setup();
    await add('2026-10-03');
    await add('2026-10-12');
    await add('2026-10-08');
    expect(await lastLoggedOn(store, TODAY)).toBe('2026-10-12');
  });

  it('не считаются: запись «из будущего», удалённая, операция по расписанию', async () => {
    const { store, wallet, add } = await setup();
    await add('2026-10-05');
    await add('2026-10-20'); // из будущего
    const gone = await add('2026-10-13');
    await store.transactions.softDelete(gone.id);
    const rule = await store.recurring.create({ kind: 'expense', walletId: wallet.id, amountMinor: 300, frequency: 'monthly', startOn: '2026-10-14', note: 'интернет' });
    await store.transactions.createFromRule(rule.id, '2026-10-14');
    expect(await lastLoggedOn(store, TODAY)).toBe('2026-10-05');
  });

  it('перевод и доход — тоже записи человека', async () => {
    const { store, wallet, add } = await setup();
    const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    await add('2026-10-05');
    await store.transactions.create({ kind: 'transfer', walletId: wallet.id, toWalletId: card.id, amountMinor: 100, toAmountMinor: 100, occurredOn: '2026-10-13' });
    expect(await lastLoggedOn(store, TODAY)).toBe('2026-10-13');
  });
});
