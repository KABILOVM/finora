import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { defaultId, type Store } from '@/db';
import { formatMinor } from '@/domain/money';
import BudgetsPage from '@/features/budgets/BudgetsPage';
import CategoriesPage from '@/features/categories/CategoriesPage';
import HomePage from '@/features/home/HomePage';
import {
  currentPath,
  currentSearch,
  LocationProbe,
  opsDeps,
  pinToday,
  showApp,
  storeOf,
  table,
  tapAmount,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';

/** «Сегодня» = четверг 15 октября 2026 (pinToday): с начала месяца 15 дней, основная валюта TJS. */
beforeEach(() => {
  localStorage.clear();
  pinToday();
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => norm(tid(id)?.textContent);

interface Ids {
  cash: string;
  food: string;
  transport: string;
}

async function ids(s: Store): Promise<Ids> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = (await s.db.categories.toArray()).filter((c) => c.kind === 'expense');
  return { cash, food: cats.find((c) => c.name === 'Еда')?.id ?? '', transport: cats.find((c) => c.name === 'Транспорт')?.id ?? '' };
}

/**
 * Еда: лимит 40 в день. Вчера 25, сегодня 32. Транспорт: лимит 100 в день, сегодня 120. Доход 1 октября даёт начало истории.
 *   Еда: план за 15 дней 600, потрачено 57, запас 543 — в норме.
 *   Транспорт: план 1 500, потрачено 120, запас 1 380; сегодня выше лимита — «Сегодня выше плана».
 *   Все ежедневные: лимит 140, план 2 100, потрачено 177, запас 1 923; сегодня 152 из 140.
 */
async function seed(s: Store, extra: (i: Ids) => Promise<unknown> = async () => undefined): Promise<Ids> {
  const i = await ids(s);
  const income = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата');
  await s.transactions.create({ kind: 'income', walletId: i.cash, amountMinor: 300_000, categoryId: income?.id ?? null, occurredOn: '2026-10-01' });
  await s.categories.setDailyLimit(i.food, 4_000);
  await s.categories.setDailyLimit(i.transport, 10_000);
  await add(s, i, 2_500, i.food, '2026-10-14');
  await add(s, i, 3_200, i.food, '2026-10-15');
  await add(s, i, 12_000, i.transport, '2026-10-15');
  await extra(i);
  return i;
}
const add = (s: Store, i: Ids, amountMinor: number, categoryId: string, occurredOn: string, note = '') =>
  s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor, categoryId, occurredOn, note });

type Setup = (s: Store) => Promise<unknown>;
const quiet = (setup?: Setup) => (setup ? async (s: Store) => void (await setup(s)) : undefined);

async function openBudgets(setup?: Setup) {
  const td = opsDeps([table()], { setup: quiet(setup) });
  await showApp(
    <>
      <BudgetsPage />
      <LocationProbe />
    </>,
    td,
    '/budgets',
  );
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(tid('daily-section')).not.toBeNull());
  return td;
}

describe('экран «Бюджеты»: траты в день', () => {
  it('без ежедневных категорий — подсказка, как их включить', async () => {
    await openBudgets();
    await waitFor(() => expect(tid('daily-intro')).not.toBeNull());
    expect(text('daily-intro')).toContain('Отметьте категории');
    expect(screen.getByRole('link', { name: 'Выбрать категории' }).getAttribute('href')).toBe('/categories');
  });

  it('план / факт: сегодня «потрачено из», запас месяца и слова состояния по категориям и в целом', async () => {
    const td = await openBudgets(seed);
    const { food, transport } = await ids(storeOf(td));
    await waitFor(() => expect(tid(`daily-line-${food}`)).not.toBeNull());

    // Еда: сегодня 32 из 40, запас 543, в норме
    expect(text(`daily-${food}-today-fact`)).toBe(`${fmt(3_200)} из ${fmt(4_000)}`);
    expect(text(`daily-${food}-reserve`)).toContain(`Запас: ${fmt(54_300)}`);
    expect(text(`daily-line-${food}`)).toContain('В норме');
    // Транспорт: сегодня 120 из 100 — выше плана, но запас держит
    expect(text(`daily-${transport}-today-fact`)).toBe(`${fmt(12_000)} из ${fmt(10_000)}`);
    expect(text(`daily-${transport}-reserve`)).toContain(`Запас: ${fmt(138_000)}`);
    expect(text(`daily-line-${transport}`)).toContain('Сегодня выше плана');
    // Все ежедневные: лимит — сумма лимитов
    expect(text('daily-line-total')).toContain(`Лимит ${fmt(14_000)} в день`);
    expect(text('daily-total-today-fact')).toBe(`${fmt(15_200)} из ${fmt(14_000)}`);
    expect(text('daily-total-reserve')).toContain(`Запас: ${fmt(192_300)}`);
    // среднее по периодам: Еда за месяц (15 дней) 5 700 ÷ 15 = 380
    expect(text(`daily-${food}-month`)).toBe(`${fmt(380)} в день`);
    expect(text(`daily-${food}-today`)).toBe(`${fmt(3_200)} в день`);
  });

  it('накопленный минус — «Перерасход», даже если сегодня ничего не потрачено', async () => {
    const td = await openBudgets((s) => seed(s, (i) => add(s, i, 70_000, i.food, '2026-10-05', 'банкет')));
    const { food } = await ids(storeOf(td));
    await waitFor(() => expect(tid(`daily-line-${food}`)).not.toBeNull());
    // потрачено 25 + 32 + 700 = 757 при плане 600 → перерасход 157
    expect(text(`daily-line-${food}`)).toContain('Перерасход');
    expect(text(`daily-${food}-reserve`)).toContain(`Перерасход за месяц: ${fmt(15_700)}`);
  });

  it('крупная покупка в категории без отметки в ежедневные не попадает, но видна в «все расходы вместе»', async () => {
    const td = await openBudgets((s) =>
      seed(s, async (i) => {
        const tech = (await s.db.categories.toArray()).find((c) => c.kind === 'expense' && c.name === 'Здоровье');
        await add(s, i, 900_000, tech?.id ?? '', '2026-10-08', 'зубы');
      }),
    );
    const { food } = await ids(storeOf(td));
    await waitFor(() => expect(tid(`daily-line-${food}`)).not.toBeNull());
    expect(text('daily-total-reserve')).toContain(fmt(192_300)); // как без покупки
    // все расходы за месяц: 9 000 + 177 = 9 177 ÷ 15 = 611,8 → 611,80 с. в день (вниз до дирама)
    expect(text('daily-everything')).toContain(fmt(61_180));
  });

  it('если лимит есть не у каждой ежедневной категории, общего лимита нет и сказано почему', async () => {
    const td = await openBudgets((s) =>
      seed(s, async () => {
        const groceries = (await s.db.categories.toArray()).find((c) => c.kind === 'expense' && c.name === 'Продукты');
        await s.categories.setDaily(groceries?.id ?? '', true);
      }),
    );
    const { food } = await ids(storeOf(td));
    await waitFor(() => expect(tid(`daily-line-${food}`)).not.toBeNull());
    expect(text('daily-line-total')).toContain('Лимит не задан');
    expect(text('daily-total-hint')).toContain('Пока без лимита: 1');
  });

  it('нажатие на строку открывает правку этой категории', async () => {
    const td = await openBudgets(seed);
    const { food } = await ids(storeOf(td));
    await waitFor(() => expect(tid(`daily-line-${food}`)).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Изменить: Еда' }));
    expect(currentPath()).toBe('/categories');
    expect(currentSearch()).toBe(`?edit=${food}`);
  });

  it('в поездке сегодня: плана нет, объяснено', async () => {
    await openBudgets((s) => seed(s, (i) => add(s, i, 1_000, i.food, '2026-10-15', 'такси #Самарканд')));
    await waitFor(() => expect(tid('daily-line-total')).not.toBeNull());
    expect(text('daily-line-total')).toContain('Сегодня вы в поездке');
  });
});

describe('«Главная»: карточка «Траты в день»', () => {
  async function openHome(setup?: Setup) {
    const td = opsDeps([table()], { setup: quiet(setup) });
    await showApp(<HomePage />, td, '/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    return td;
  }

  it('без ежедневных категорий карточки нет', async () => {
    await openHome();
    await new Promise((r) => setTimeout(r, 50));
    expect(tid('daily-home-card')).toBeNull();
  });

  it('сегодня потрачено из лимита, запас месяца и самые «горячие» категории', async () => {
    const td = await openHome(seed);
    const { food, transport } = await ids(storeOf(td));
    await waitFor(() => expect(tid('daily-home-card')).not.toBeNull());
    expect(text('daily-home-today')).toBe(`${fmt(15_200)} из ${fmt(14_000)}`);
    expect(text('daily-home-reserve')).toBe(`Запас месяца: ${fmt(192_300)}`);
    expect(text(`daily-home-${food}`)).toContain('Еда');
    expect(text(`daily-home-${food}`)).toContain(`${fmt(3_200)} / ${fmt(4_000)}`);
    // «горячая» строка (выше плана сегодня) идёт раньше спокойной
    const rows = Array.from(document.querySelectorAll('li[data-testid^="daily-home-"]')).map((e) => e.getAttribute('data-testid'));
    expect(rows.indexOf(`daily-home-${transport}`)).toBeLessThan(rows.indexOf(`daily-home-${food}`));
  });

  it('без лимитов: в среднем в день за месяц', async () => {
    await openHome(async (s) => {
      const i = await ids(s);
      const income = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата');
      await s.transactions.create({ kind: 'income', walletId: i.cash, amountMinor: 300_000, categoryId: income?.id ?? null, occurredOn: '2026-10-01' });
      await s.categories.setDaily(i.food, true);
      await add(s, i, 15_000, i.food, '2026-10-10');
    });
    await waitFor(() => expect(tid('daily-home-card')).not.toBeNull());
    expect(text('daily-home-average')).toBe(`В среднем за месяц ${fmt(1_000)} в день`); // 15 000 ÷ 15 дней
  });
});

describe('карточка категории: «Ежедневная категория» и лимит в день', () => {
  async function openCategories(path = '/categories') {
    const td = opsDeps([table()]);
    await showApp(
      <>
        <CategoriesPage />
        <LocationProbe />
      </>,
      td,
      path,
    );
    await findByRole('heading', { name: 'Категории', level: 1 });
    await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
    return td;
  }

  it('включить отметку, поставить лимит и сохранить', async () => {
    const td = await openCategories();
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    const toggle = screen.getByRole('switch', { name: 'Ежедневная категория' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await findByRole('textbox', { name: /^Лимит в день/ });
    await tapAmount('40');
    expect(document.body.textContent).toMatch(/≈ .* в этом месяце/);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const food = (await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Еда');
    expect(food).toMatchObject({ daily: 1, dailyLimitMinor: 4_000 });
  });

  it('выключить отметку снимает и лимит', async () => {
    const td = opsDeps([table()], {
      setup: async (s) => {
        const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда');
        await s.categories.setDailyLimit(food?.id ?? '', 4_000);
      },
    });
    await showApp(<CategoriesPage />, td, '/categories');
    await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    const toggle = screen.getByRole('switch', { name: 'Ежедневная категория' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const food = (await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Еда');
    expect(food).toMatchObject({ daily: 0, dailyLimitMinor: null });
  });

  it('по названию подсказывает включить отметку, но сама её не ставит; у доходов отметки нет', async () => {
    await openCategories();
    await user.click(screen.getAllByRole('button', { name: /Добавить/ })[0]!);
    await findByRole('dialog', { name: 'Новая категория расходов' });
    const name = screen.getByRole('textbox', { name: 'Название' });
    await user.type(name, 'Такси');
    expect(document.body.textContent).toContain('Похоже на ежедневные траты');
    expect(screen.getByRole('switch', { name: 'Ежедневная категория' }).getAttribute('aria-checked')).toBe('false');
  });

  it('ссылка ?edit=<id> сразу открывает правку категории и убирает параметр из адреса', async () => {
    const foodId = await defaultId(LOCAL_USER_ID, 'category:food');
    await openCategories(`/categories?edit=${foodId}`);
    await findByRole('dialog', { name: 'Правка категории' });
    expect((screen.getByRole('textbox', { name: 'Название' }) as HTMLInputElement).value).toBe('Еда');
    await waitFor(() => expect(currentSearch()).toBe(''));
  });
});
