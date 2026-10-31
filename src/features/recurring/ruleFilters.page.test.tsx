import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { RecurringInput, Store } from '@/db';
import { choose, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { addDays } from '@/lib/dates';
import { resetAutoPostState } from '@/recurring/autoPostState';
import RecurringPage from './RecurringPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  resetAutoPostState();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const TODAY = '2026-10-15';
const day = (n: number) => addDays(TODAY, n);

/** Четыре платежа в ближайшие 30 дней: «Аренда» (расход, Наличные, Жильё), «Интернет» (расход, Карта, Связь), «Зарплата» (доход, Карта), «Копилка» (перевод). */
async function setup(s: Store) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? null;
  const make = (over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId' | 'startOn'>) => s.recurring.create({ kind: 'expense', amountMinor: 10_000, frequency: 'monthly', ...over });
  await make({ walletId: cash, startOn: day(3), note: 'Аренда', categoryId: cat('Жильё', 'expense') });
  await make({ walletId: card, startOn: day(5), note: 'Интернет', categoryId: cat('Связь', 'expense') });
  await make({ walletId: card, startOn: day(7), note: 'Зарплата', kind: 'income', amountMinor: 500_000, categoryId: cat('Зарплата', 'income') });
  await make({ walletId: cash, startOn: day(9), note: 'Копилка', kind: 'transfer', toWalletId: card });
}

async function openPage() {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Провести: / })).toHaveLength(4));
}

/** Какие платежи видны в «Скоро» (кнопка «Провести») и в «Все правила» (строки правил). */
const soon = () => screen.queryAllByRole('button', { name: /^Провести: / }).map((b) => /^Провести: ([^,]+)/.exec(b.getAttribute('aria-label') ?? '')?.[1] ?? '');
const allRules = () => document.querySelector('section[aria-labelledby="rec-all"]')?.textContent ?? '';
const monthlyText = () => document.querySelector('[data-testid="recurring-monthly"]')?.textContent ?? '';
const apply = () => user.click(screen.getByRole('button', { name: 'Применить' }));

describe('экран «Регулярные платежи»: фильтры', () => {
  it('по виду: «Доходы» оставляют зарплату во всех списках, итог «В месяц» — по фильтру', async () => {
    await openPage();
    expect(soon().sort()).toEqual(['Аренда', 'Зарплата', 'Интернет', 'Копилка']);
    expect(monthlyText()).toContain('В месяц, примерно');

    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'Доходы' }));
    await apply();

    await waitFor(() => expect(soon()).toEqual(['Зарплата']));
    expect(allRules()).toContain('Зарплата');
    expect(allRules()).not.toContain('Аренда');
    // итог пересчитан по видимым платежам: расходов в нём нет
    expect(monthlyText()).toContain('В месяц по фильтрам, примерно');
    expect(monthlyText()).not.toMatch(/Платежи[\s\u00a0]*\d/);
    expect(monthlyText()).toContain('Поступления');
  });

  it('по категории и по кошельку (перевод проходит по принимающему кошельку)', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    choose('Категория', 'Жильё');
    await apply();
    await waitFor(() => expect(soon()).toEqual(['Аренда']));

    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    choose('Категория', 'Все категории');
    choose('Кошелёк', 'Карта');
    await apply();
    await waitFor(() => expect(soon().sort()).toEqual(['Зарплата', 'Интернет', 'Копилка']));
  });

  it('ничего не подошло: сообщение и «Сбросить фильтры» возвращает всё', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'Переводы' }));
    choose('Категория', 'Жильё'); // у перевода категории нет
    await apply();
    await waitFor(() => expect(document.querySelector('[data-testid="recurring-filter-empty"]')).not.toBeNull());
    expect(soon()).toEqual([]);
    expect(document.body.textContent).toContain('По выбранным фильтрам на ближайшие 30 дней платежей нет.');

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    await waitFor(() => expect(soon()).toHaveLength(4));
    expect(monthlyText()).toContain('В месяц, примерно');
  });
});
