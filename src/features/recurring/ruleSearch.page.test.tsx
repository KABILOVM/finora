import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { RecurringInput, Store } from '@/db';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
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

/** Шесть платежей: поле поиска видно. Аренда (Наличные, Жильё), Интернет (Карта, Связь), Зарплата (доход, Карта), Копилка (перевод), Спортзал (Карта, Здоровье), без заметки (Наличные, Подписки). */
async function setup(s: Store, count = 6) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? null;
  const make = (over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId' | 'startOn'>) => s.recurring.create({ kind: 'expense', amountMinor: 10_000, frequency: 'monthly', ...over });
  await make({ walletId: cash, startOn: day(3), note: 'Аренда', categoryId: cat('Жильё', 'expense') });
  await make({ walletId: card, startOn: day(5), note: 'Интернет', categoryId: cat('Связь', 'expense') });
  await make({ walletId: card, startOn: day(7), note: 'Зарплата', kind: 'income', amountMinor: 500_000, categoryId: cat('Зарплата', 'income') });
  await make({ walletId: cash, startOn: day(9), note: 'Копилка', kind: 'transfer', toWalletId: card });
  if (count > 4) await make({ walletId: card, startOn: day(11), note: 'Спортзал', categoryId: cat('Здоровье', 'expense') });
  if (count > 5) await make({ walletId: cash, startOn: day(13), note: '', categoryId: cat('Подписки', 'expense') });
}

async function openPage(count = 6) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s, count)) });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Провести: / })).toHaveLength(count));
}

const field = () => screen.getByRole('textbox', { name: 'Поиск по платежам' }) as HTMLInputElement;
const soon = () => screen.queryAllByRole('button', { name: /^Провести: / }).map((b) => /^Провести: ([^,]+)/.exec(b.getAttribute('aria-label') ?? '')?.[1] ?? '');
const allRules = () => document.querySelector('section[aria-labelledby="rec-all"]')?.textContent ?? '';
const monthlyText = () => document.querySelector('[data-testid="recurring-monthly"]')?.textContent ?? '';

describe('экран «Регулярные платежи»: поиск', () => {
  it('по названию (заметке): во всех списках экрана, итог «В месяц» — по найденному', async () => {
    await openPage();
    expect(monthlyText()).toContain('В месяц, примерно');
    await user.type(field(), 'АРЕНД');
    await waitFor(() => expect(soon()).toEqual(['Аренда']));
    expect(allRules()).toContain('Аренда');
    expect(allRules()).not.toContain('Интернет');
    expect(monthlyText()).toContain('В месяц по фильтрам, примерно');
  });

  it('по тому, что видно в строке: категории и кошельку', async () => {
    await openPage();
    await user.type(field(), 'связь'); // категория «Интернета»
    await waitFor(() => expect(soon()).toEqual(['Интернет']));
    await user.clear(field());
    await user.type(field(), 'карта'); // платежи с кошелька «Карта» и перевод на неё
    await waitFor(() => expect(soon().sort()).toEqual(['Зарплата', 'Интернет', 'Копилка', 'Спортзал']));
  });

  it('платёж без заметки находится по категории (она и есть его название)', async () => {
    await openPage();
    await user.type(field(), 'подписки');
    await waitFor(() => expect(soon()).toHaveLength(1));
    expect(allRules()).toContain('Подписки');
  });

  it('несколько слов: все должны найтись', async () => {
    await openPage();
    await user.type(field(), 'спортзал карта');
    await waitFor(() => expect(soon()).toEqual(['Спортзал']));
    await user.clear(field());
    await user.type(field(), 'спортзал наличные');
    await waitFor(() => expect(soon()).toEqual([]));
  });

  it('вместе с фильтром: «Доходы» + «зар» — зарплата; «Доходы» + «аренд» — пусто', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'Доходы' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(soon()).toEqual(['Зарплата']));
    await user.type(field(), 'зар');
    await waitFor(() => expect(soon()).toEqual(['Зарплата']));
    await user.clear(field());
    await user.type(field(), 'аренд');
    await waitFor(() => expect(soon()).toEqual([]));
  });

  it('ничего не нашлось: сказано про поиск, «Сбросить поиск и фильтры» возвращает всё', async () => {
    await openPage();
    await user.type(field(), 'космос');
    await waitFor(() => expect(soon()).toEqual([]));
    expect(document.querySelector('[data-testid="recurring-filter-empty"]')?.textContent).toContain('Нет платежей, подходящих под поиск и фильтры.');
    expect(screen.getByText(/По поиску и фильтрам на ближайшие \d+ дней платежей нет\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сбросить поиск и фильтры' }));
    await waitFor(() => expect(soon()).toHaveLength(6));
    expect(field().value).toBe('');
  });

  it('в коротком списке (меньше шести платежей) поля поиска нет', async () => {
    await openPage(4);
    expect(screen.queryByRole('textbox', { name: 'Поиск по платежам' })).toBeNull();
  });
});
