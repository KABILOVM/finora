import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { defaultId, type Store } from '@/db';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import ShoppingPage from './ShoppingPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

/** Прошлая покупка (молоко 2 л, яблоки 1 кг) + список: «Рис» 1 кг в корзине, «Соль» и «Чай» (шт) не отмечены. */
async function setup(s: Store) {
  const cash = (await s.db.wallets.toArray())[0]!;
  const milk = await s.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
  const apples = await s.shopping.add({ name: 'Яблоки', qtyMilli: 1000, unit: 'kg' });
  await s.shopping.check(milk.id, 2600);
  await s.shopping.check(apples.id, 900);
  await s.shopping.purchase({ walletId: cash.id, categoryId: await defaultId(s.userId, 'category:groceries'), occurredOn: '2026-10-10' });
  const rice = await s.shopping.add({ name: 'Рис', qtyMilli: 1000, unit: 'kg' });
  await s.shopping.add({ name: 'Соль', qtyMilli: 1000, unit: 'pcs' });
  await s.shopping.add({ name: 'Чай', qtyMilli: 1000, unit: 'pcs' });
  await s.shopping.check(rice.id, 1250);
}

async function open() {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(<ShoppingPage />, td, '/shopping');
  await waitFor(() => expect(document.querySelectorAll('[data-testid="shopping-item"]')).toHaveLength(3));
  return td;
}

const names = () => Array.from(document.querySelectorAll('[data-testid="shopping-item"]')).map((li) => norm(li.querySelector('button + button span span')?.textContent));
const boughtRows = () => Array.from(document.querySelectorAll('[data-testid="shopping-bought-item"]')).map((li) => norm(li.textContent));
const cartTotal = () => norm(document.querySelector('[data-testid="shopping-cart"]')?.textContent);
const openFilters = () => user.click(screen.getByRole('button', { name: /^Фильтры/ }));
const apply = () => user.click(screen.getByRole('button', { name: 'Применить' }));

describe('экран «Покупки»: фильтры', () => {
  it('«В корзине» и «В списке»: список сужается, «Итого в корзине» считается по всему списку, пояснение есть', async () => {
    await open();
    expect(names()).toEqual(['Рис 1 кг', 'Соль', 'Чай']);
    const total = cartTotal();

    await openFilters();
    await user.click(screen.getByRole('button', { name: 'В корзине' }));
    await apply();
    await waitFor(() => expect(names()).toEqual(['Рис 1 кг']));
    expect(cartTotal()).toBe(total);
    expect(document.querySelector('[data-testid="shopping-filter-note"]')?.textContent).toContain('считаются по всему списку');

    await openFilters();
    await user.click(screen.getByRole('button', { name: 'В списке' }));
    await apply();
    await waitFor(() => expect(names()).toEqual(['Соль', 'Чай']));
  });

  it('по единице: «кг» оставляет рис', async () => {
    await open();
    await openFilters();
    await user.click(screen.getByRole('button', { name: 'кг' }));
    await apply();
    await waitFor(() => expect(names()).toEqual(['Рис 1 кг']));
  });

  it('«Куплено»: вместо списка — прошлые покупки с ценой и днём; план, корзина и кнопка покупки скрыты', async () => {
    await open();
    await openFilters();
    await user.click(screen.getByRole('button', { name: 'Куплено' }));
    await apply();
    await waitFor(() => expect(boughtRows()).toHaveLength(2));
    const rows = boughtRows();
    expect(rows.find((r) => r.includes('Молоко 2 л'))).toMatch(/26,00 с\./);
    expect(rows.find((r) => r.includes('Яблоки 1 кг'))).toMatch(/9,00 с\./);
    expect(rows.every((r) => r.includes('куплено'))).toBe(true);
    expect(document.querySelector('[data-testid="shopping-plan"]')).toBeNull();
    expect(document.querySelector('[data-testid="shopping-cart"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подтвердить покупку' })).toBeNull();

    // единица сужает и покупки
    await openFilters();
    await user.click(screen.getByRole('button', { name: 'л' }));
    await apply();
    await waitFor(() => expect(boughtRows()).toHaveLength(1));
    expect(boughtRows()[0]).toContain('Молоко');
  });

  it('ничего не подошло: сообщение и «Сбросить фильтры» возвращает список', async () => {
    await open();
    await openFilters();
    await user.click(screen.getByRole('button', { name: 'В корзине' }));
    await user.click(screen.getByRole('button', { name: 'шт' })); // в корзине только рис (кг)
    await apply();
    await waitFor(() => expect(document.querySelector('[data-testid="shopping-filter-empty"]')).not.toBeNull());
    expect(names()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(document.querySelector('[data-testid="shopping-filter-note"]')).toBeNull();
  });

  it('пустой список без покупок — панели фильтров нет', async () => {
    const td = opsDeps([table()]);
    await showApp(<ShoppingPage />, td, '/shopping');
    await findByRole('heading', { name: 'Покупки', level: 1 });
    await waitFor(() => expect(screen.queryByText('Список покупок пуст')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^Фильтры/ })).toBeNull();
  });
});
