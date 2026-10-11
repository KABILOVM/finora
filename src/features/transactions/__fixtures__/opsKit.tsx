/**
 * Помощники ТОЛЬКО для тестов модуля «ops»: приложение с настоящей локальной базой (fake-indexeddb),
 * курсами из памяти и без сети; ввод суммы кнопками экранной клавиатуры.
 */
import { makeTestDeps, renderAppRoot, type TestDeps } from '@/app/testkit';
import { findByRole, fire, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, type Store } from '@/db';
import type { RateTable } from '@/domain/types';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import type { RateService } from '@/rates/types';
import type { ReactNode } from 'react';
import AddTransactionSheet from '@/layout/AddTransactionSheet';
import { useLocation } from 'react-router-dom';
import { vi } from 'vitest';

/** «Сегодня» для курсов в тестах. */
export const RATES_NOW = new Date('2026-10-10T12:00:00.000Z');

/** Таблица курсов: TJS — опорная, 1 USD = 10,9 TJS, 1 EUR = 12 TJS. */
export const table = (over: Partial<RateTable> = {}): RateTable => ({
  asOf: '2026-10-10',
  pivot: 'TJS',
  perUnit: { TJS: 1, USD: 10.9, EUR: 12 },
  source: 'nbt',
  fetchedAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

export interface OpsDeps extends TestDeps {
  /** Сервис курсов, который получит приложение. */
  rates: RateService;
}

export interface OpsDepsOptions {
  /** Дата «сегодня» для сервиса курсов. */
  now?: Date;
  /** Подготовка данных: выполняется после затравки, ДО того как приложение получит базу (экран сразу видит всё готовое). */
  setup?: (store: Store) => Promise<void>;
}

/** Зависимости приложения с готовым сервисом курсов. tables = [] — курсов нет совсем. */
export function opsDeps(tables: RateTable[] = [], options: OpsDepsOptions = {}): OpsDeps {
  const { now = RATES_NOW, setup } = options;
  const td = makeTestDeps();
  if (setup) {
    const open = td.deps.openStore;
    td.deps.openStore = async (userId) => {
      const store = await open(userId);
      await ensureSeeded(store);
      await setup(store);
      return store;
    };
  }
  const rates = createRateService({
    providers: [],
    storage: createMemoryRateStorage(
      tables.length > 0 ? { v: 1, tables, manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null } : undefined,
    ),
    now: () => now,
  });
  td.deps.createRates = () => rates;
  return Object.assign(td, { rates });
}

export function storeOf(td: TestDeps): Store {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
}

export async function showApp(ui: ReactNode, td: TestDeps, path = '/') {
  renderAppRoot(ui, { deps: td.deps, path });
  await waitFor(() => {
    if (td.stores.length === 0) throw new Error('База ещё открывается');
  });
}

/** Нажимает кнопки экранной клавиатуры: '12,5' → 1, 2, «Запятая», 5. */
export async function tapAmount(text: string): Promise<void> {
  for (const ch of text) {
    const name = ch === ',' ? 'Запятая' : ch === '⌫' ? 'Стереть' : ch;
    await user.click(screen.getByRole('button', { name }));
  }
}

/** Ввод даты в поле type="date" так, как это сделал бы браузер. */
export function setDateInput(el: HTMLElement, value: string): void {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
  fire(input, new Event('change', { bubbles: true }));
}

/** Все живые операции, новые сверху. */
export async function liveTxs(td: TestDeps) {
  const rows = await storeOf(td).db.transactions.toArray();
  return rows.filter((t) => t.deletedAt === null).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function allTxs(td: TestDeps) {
  return storeOf(td).db.transactions.toArray();
}

/** Кошелёк «Наличные» из затравки. */
export async function cashWallet(td: TestDeps) {
  const w = (await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Наличные');
  if (!w) throw new Error('Нет кошелька «Наличные»');
  return w;
}

export async function categoryByName(td: TestDeps, name: string, kind: 'expense' | 'income' = 'expense') {
  const c = (await storeOf(td).db.categories.toArray()).find((x) => x.name === name && x.kind === kind);
  if (!c) throw new Error(`Нет категории «${name}»`);
  return c;
}

export async function addUsdWallet(td: TestDeps, openingBalanceMinor = 0) {
  return storeOf(td).wallets.create({
    name: 'Доллары',
    currency: 'USD',
    kind: 'cash',
    openingBalanceMinor,
    color: '#2563eb',
    icon: '💲',
  });
}

/** Показывает текущий адрес и страницу-фон (state.background) — чтобы проверять переходы. */
export function LocationProbe() {
  const location = useLocation();
  const background = (location.state as { background?: { pathname?: string } } | null)?.background?.pathname ?? '';
  return (
    <p data-testid="location" data-background={background}>
      {location.pathname}
    </p>
  );
}

export const backgroundPath = (): string => document.querySelector('[data-testid="location"]')?.getAttribute('data-background') ?? '';

export const currentPath = (): string => document.querySelector('[data-testid="location"]')?.textContent ?? '';

/** Названия чипов группы (например, всех категорий) в том порядке, как они на экране; значок не входит. */
export function chipLabels(groupName: string): string[] {
  const group = screen.getByRole('group', { name: groupName });
  return Array.from(group.querySelectorAll('button')).map((b) => (b.querySelector('span:not([aria-hidden])')?.textContent ?? '').trim());
}

/** Чип с названием label внутри группы (одни и те же кошельки есть и в «Откуда», и в «Куда»). */
export function chip(groupName: string, label: string): HTMLElement {
  const group = screen.getByRole('group', { name: groupName });
  const hit = Array.from(group.querySelectorAll('button')).find(
    (b) => (b.querySelector('span:not([aria-hidden])')?.textContent ?? '').trim() === label,
  );
  if (!hit) throw new Error(`В группе «${groupName}» нет чипа «${label}»`);
  return hit;
}

/** Поле-календарь (у него нет роли «textbox», поэтому ищем по типу). */
export function dateInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="date"]');
  if (!el) throw new Error('Поле даты не найдено');
  return el;
}

/** Остатки кошельков, посчитанные из живых операций (как это делает приложение). */
export async function balancesOf(td: TestDeps): Promise<Map<string, number>> {
  const { computeBalances } = await import('@/domain/balances');
  const s = storeOf(td);
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray());
}

/** Блок «Курс: 1 $ = …» под суммой. */
export function fxNotice(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="fx-notice"]');
  if (!el) throw new Error('Блок курса не показан');
  return el;
}

/** Выбор значения в выпадающем списке по тексту пункта: choose('Кошелёк', 'Карта'). */
export function choose(selectName: string, optionText: string): void {
  const select = screen.getByRole('combobox', { name: selectName }) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => (o.textContent ?? '').trim() === optionText);
  if (!option) throw new Error(`В списке «${selectName}» нет пункта «${optionText}»`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, option.value);
  fire(select, new Event('change', { bubbles: true }));
}

/** «Сегодня» в тестах списка и главной: четверг 15 октября 2026, полдень по местному времени. */
export const PINNED_NOW = new Date(2026, 9, 15, 12, 0, 0);

/**
 * Закрепляет «сегодня» на PINNED_NOW. Время при этом идёт (shouldAdvanceTime), иначе таймауты ожидания в тестах
 * (они меряются по Date.now) никогда бы не сработали и упавшая проверка висела бы до конца теста.
 */
export function pinToday(): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
}

export function unpinToday(): void {
  vi.useRealTimers();
}

export interface History {
  cash: string;
  card: string;
  usd: string;
  txs: Record<string, string>;
}

/**
 * Набор операций для проверки списка и главной (сегодня = 15.10.2026, база TJS, 1 $ = 10,9 с.):
 *  15.10  расход Наличные Еда 12,50 «обед»;  доход Наличные Зарплата 5 000 «аванс»
 *  14.10  расход Карта Транспорт 3 «такси»;  перевод Наличные → Карта 100;  расход в $ (10 $ → 109 с.) Еда «coffee»
 *  20.09  расход Наличные Продукты 45 «рынок»;  03.09 расход Карта без категории 2;  10.07 доход Карта Подработка 70 «Работа»
 */
export async function seedHistory(s: Store): Promise<History> {
  const wallets = await s.db.wallets.toArray();
  const cash = wallets.find((w) => w.name === 'Наличные')?.id ?? '';
  const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#7c3aed', icon: '💲' })).id;
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income' = 'expense') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? '';
  const txs: Record<string, string> = {};
  const add = async (key: string, input: Parameters<Store['transactions']['create']>[0]) => {
    txs[key] = (await s.transactions.create(input)).id;
  };
  await add('lunch', { kind: 'expense', walletId: cash, amountMinor: 1250, categoryId: cat('Еда'), occurredOn: '2026-10-15', note: 'обед' });
  await add('advance', { kind: 'income', walletId: cash, amountMinor: 500_000, categoryId: cat('Зарплата', 'income'), occurredOn: '2026-10-15', note: 'аванс' });
  await add('taxi', { kind: 'expense', walletId: card, amountMinor: 300, categoryId: cat('Транспорт'), occurredOn: '2026-10-14', note: 'такси' });
  await add('move', { kind: 'transfer', walletId: cash, toWalletId: card, amountMinor: 10_000, toAmountMinor: 10_000, occurredOn: '2026-10-14' });
  await add('coffee', {
    kind: 'expense',
    walletId: usd,
    amountMinor: 1000,
    categoryId: cat('Еда'),
    occurredOn: '2026-10-14',
    note: 'coffee',
    fx: { rate: 10.9, source: 'nbt' },
  });
  await add('market', { kind: 'expense', walletId: cash, amountMinor: 4500, categoryId: cat('Продукты'), occurredOn: '2026-09-20', note: 'рынок' });
  await add('nocat', { kind: 'expense', walletId: card, amountMinor: 200, occurredOn: '2026-09-03' });
  await add('side', { kind: 'income', walletId: card, amountMinor: 7000, categoryId: cat('Подработка', 'income'), occurredOn: '2026-07-10', note: 'Работа' });
  return { cash, card, usd, txs };
}

/** Тексты строк операций на экране (в порядке следования). */
export function rowTexts(): string[] {
  return Array.from(document.querySelectorAll('section[aria-label] button')).map((b) => (b.textContent ?? '').replace(/[ \t\r\n]+/g, ' ').trim());
}

type WalletRole = 'Кошелёк' | 'Откуда' | 'Куда';

/** Чип над клавиатурой («Кошелёк: Наличные», «Дата: Сегодня»): по началу его подписи. */
export function contextChip(prefix: string): HTMLElement {
  const hit = Array.from(document.querySelectorAll<HTMLElement>('button[aria-expanded]')).find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(`${prefix}:`),
  );
  if (!hit) throw new Error(`Нет чипа «${prefix}: …»`);
  return hit;
}

/** Меняет кошелёк так, как человек: касание по чипу кошелька → касание по нужному кошельку в списке. */
export async function pickWallet(label: string, role: WalletRole = 'Кошелёк'): Promise<void> {
  await user.click(contextChip(role));
  await user.click(chip(role, label));
}

/** Открывает выбор даты и выбирает «Сегодня» / «Вчера» / «Другая дата» (последнее оставляет календарь на экране). */
export async function pickDate(which: 'Сегодня' | 'Вчера' | 'Другая дата'): Promise<void> {
  await user.click(contextChip('Дата'));
  await user.click(screen.getByRole('button', { name: which }));
}

// ───────────── шит «Новая операция» ─────────────

/** Открывает шит «Новая операция» (и показывает текущий адрес). */
export async function openAddSheet(td: OpsDeps = opsDeps()) {
  const onClose = vi.fn();
  await showApp(
    <>
      <AddTransactionSheet onClose={onClose} />
      <LocationProbe />
    </>,
    td,
    '/add',
  );
  await findByRole('dialog', { name: 'Новая операция' });
  return { td, onClose };
}

export const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Сохранить' });
export const clickSave = () => user.click(saveButton());
export const amountField = (): HTMLInputElement => screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement;

/** Второй кошелёк в той же валюте (для переводов и проверки «последнего кошелька»). */
export const withCard = async (s: Store) => {
  await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 50_000, color: '#2563eb', icon: '💳' });
};
/** Кошелёк в долларах (на счету 1 000 $). */
export const withUsd = async (s: Store) => {
  await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' });
};
