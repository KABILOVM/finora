import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import { defaultId, type Store } from '@/db';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import ShoppingPage from './ShoppingPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

/** Прошлая покупка (молоко, яблоки) и список: «Рис» в корзине, «Соль», «Чай», «Мёд», «Хлеб» не отмечены — всего 7, поле поиска видно. */
async function setup(s: Store, short = false) {
  const cash = (await s.db.wallets.toArray())[0]!;
  if (!short) {
    const milk = await s.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
    const apples = await s.shopping.add({ name: 'Яблоки', qtyMilli: 1000, unit: 'kg' });
    await s.shopping.check(milk.id, 2600);
    await s.shopping.check(apples.id, 900);
    await s.shopping.purchase({ walletId: cash.id, categoryId: await defaultId(s.userId, 'category:groceries'), occurredOn: '2026-10-10' });
  }
  const rice = await s.shopping.add({ name: 'Рис', qtyMilli: 1000, unit: 'kg' });
  await s.shopping.add({ name: 'Соль', qtyMilli: 1000, unit: 'pcs' });
  await s.shopping.add({ name: 'Чай', qtyMilli: 1000, unit: 'pcs' });
  if (!short) {
    await s.shopping.add({ name: 'Мёд', qtyMilli: 500, unit: 'kg' });
    await s.shopping.add({ name: 'Хлеб', qtyMilli: 2000, unit: 'pcs' });
  }
  await s.shopping.check(rice.id, 1250);
}

async function open(short = false) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s, short)) });
  await showApp(<ShoppingPage />, td, '/shopping');
  await waitFor(() => expect(document.querySelectorAll('[data-testid="shopping-item"]')).toHaveLength(short ? 3 : 5));
  return td;
}

const field = () => screen.getByRole('textbox', { name: 'Поиск по покупкам' }) as HTMLInputElement;
const names = () => Array.from(document.querySelectorAll('[data-testid="shopping-item"]')).map((li) => norm(li.querySelector('button + button span span')?.textContent));
const boughtRows = () => Array.from(document.querySelectorAll('[data-testid="shopping-bought-item"]')).map((li) => norm(li.textContent));
const cartTotal = () => norm(document.querySelector('[data-testid="shopping-cart"]')?.textContent);

describe('экран «Покупки»: поиск', () => {
  it('поле есть, когда в списке и покупках от шести позиций; находит по части названия', async () => {
    await open();
    expect(names()).toEqual(['Рис 1 кг', 'Соль', 'Чай', 'Мёд 0,5 кг', 'Хлеб × 2']);
    await user.type(field(), 'ри');
    await waitFor(() => expect(names()).toEqual(['Рис 1 кг']));
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    await waitFor(() => expect(names()).toHaveLength(5));
  });

  it('без учёта регистра и «ё»: «МЕД» находит «Мёд»', async () => {
    await open();
    await user.type(field(), 'МЕД');
    await waitFor(() => expect(names()).toEqual(['Мёд 0,5 кг']));
  });

  it('«Итого в корзине» считается по всему списку, пояснение показано', async () => {
    await open();
    const total = cartTotal();
    await user.type(field(), 'хлеб');
    await waitFor(() => expect(names()).toEqual(['Хлеб × 2']));
    expect(cartTotal()).toBe(total); // «Рис» в корзине, хотя в поиск не вошёл
    expect(document.querySelector('[data-testid="shopping-filter-note"]')?.textContent).toContain('считаются по всему списку');
  });

  it('ничего не нашлось: сказано про поиск, «Сбросить поиск и фильтры» возвращает список', async () => {
    await open();
    await user.type(field(), 'ананас');
    await waitFor(() => expect(names()).toEqual([]));
    expect(document.querySelector('[data-testid="shopping-filter-empty"]')?.textContent).toContain('Нет позиций, подходящих под поиск и фильтры.');
    await user.click(screen.getByRole('button', { name: 'Сбросить поиск и фильтры' }));
    await waitFor(() => expect(names()).toHaveLength(5));
    expect(field().value).toBe('');
  });

  it('поиск сочетается с фильтром: «В корзине» + «рис», «В списке» + «рис» — пусто', async () => {
    await open();
    await user.type(field(), 'рис');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'В списке' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(names()).toEqual([]));
    expect(document.querySelector('[data-testid="shopping-filter-empty"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Сбросить поиск и фильтры' }));
    await waitFor(() => expect(names()).toHaveLength(5));
  });

  it('в «Куплено» поиск идёт по прошлым покупкам', async () => {
    await open();
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'Куплено' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(boughtRows()).toHaveLength(2));
    await user.type(field(), 'яблок');
    await waitFor(() => expect(boughtRows()).toHaveLength(1));
    expect(boughtRows()[0]).toContain('Яблоки');
  });

  it('в коротком списке поля поиска нет', async () => {
    await open(true);
    expect(screen.queryByRole('textbox', { name: 'Поиск по покупкам' })).toBeNull();
  });
});
