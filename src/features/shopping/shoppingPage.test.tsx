import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { screen, waitFor } from '@/components/testUtils';
import { defaultId, type Store } from '@/db';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import ShoppingPage from './ShoppingPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const plan = () => document.querySelector('[data-testid="shopping-plan"]');
const planText = () => norm(plan()?.textContent);

/** «Прошлая покупка»: молоко 2 л за 26 с. (13 с. за литр) и яблоки 1 кг за 9 с. */
async function history(s: Store) {
  const cash = (await s.db.wallets.toArray())[0]!;
  const milk = await s.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
  const apples = await s.shopping.add({ name: 'Яблоки', qtyMilli: 1000, unit: 'kg' });
  await s.shopping.check(milk.id, 2600);
  await s.shopping.check(apples.id, 900);
  const groceries = await defaultId(s.userId, 'category:groceries');
  await s.shopping.purchase({ walletId: cash.id, categoryId: groceries, occurredOn: '2026-10-10' });
  return { groceries };
}

async function open(setup: (s: Store) => Promise<unknown>) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(<ShoppingPage />, td, '/shopping');
  return td;
}

describe('экран «Покупки»', () => {
  it('план = ожидаемые цены ещё не купленных; ожидаемая = цена за единицу × количество; «обычно» под названием', async () => {
    await open(async (s) => {
      await history(s);
      await s.shopping.add({ name: 'Молоко', qtyMilli: 3000, unit: 'l' }); // 39,00
      await s.shopping.add({ name: 'Яблоки', qtyMilli: 1400, unit: 'kg' }); // 12,60
      await s.shopping.add({ name: 'Манго', qtyMilli: 1000, unit: 'pcs' }); // цены нет
    });
    await waitFor(() => expect(planText()).toContain('≈ 51,60 с.'));
    expect(planText()).toContain('без цены: 1');
    const rows = screen.getAllByRole('listitem').map((li) => norm(li.textContent));
    expect(rows.find((r) => r.includes('Молоко 3 л'))).toMatch(/обычно 13,00 с\.\/л.*≈ 39,00 с\./);
    expect(rows.find((r) => r.includes('Яблоки 1,4 кг'))).toMatch(/обычно 9,00 с\.\/кг.*≈ 12,60 с\./);
    expect(rows.find((r) => r.includes('Манго'))).toContain('цены ещё нет');
  });

  it('«Осталось на «Продукты»» = остаток бюджета категории этого месяца', async () => {
    await open(async (s) => {
      const { groceries } = await history(s); // потрачено 35 с. в октябре
      await s.budgets.create({ categoryId: groceries, amountMinor: 100_000 }); // лимит 1 000 с.
      await s.shopping.add({ name: 'Молоко', qtyMilli: 1000, unit: 'l' });
    });
    await waitFor(() => expect(planText()).toContain('Осталось на «Продукты» 965 с.'));
  });

  it('без бюджета на категорию строки «Осталось» нет; перерасход называется перерасходом', async () => {
    const td = await open(async (s) => {
      await history(s);
      await s.shopping.add({ name: 'Молоко', qtyMilli: 1000, unit: 'l' });
    });
    await waitFor(() => expect(planText()).toContain('План'));
    expect(planText()).not.toContain('Осталось');
    const s = td.stores[0]!;
    const groceries = await defaultId(s.userId, 'category:groceries');
    await s.budgets.create({ categoryId: groceries, amountMinor: 1_000 }); // лимит 10 с. при расходе 35 с.
    await eventually(async () => expect(planText()).toContain('Перерасход на «Продукты» 25 с.'));
  });

  it('корзина: «Итого в корзине» — сумма вписанных цен отмеченных', async () => {
    await open(async (s) => {
      const a = await s.shopping.add({ name: 'Рис', qtyMilli: 1000, unit: 'kg' });
      const b = await s.shopping.add({ name: 'Соль', qtyMilli: 1000, unit: 'pcs' });
      await s.shopping.add({ name: 'Чай', qtyMilli: 1000, unit: 'pcs' });
      await s.shopping.check(a.id, 1250);
      await s.shopping.check(b.id, 305);
    });
    await waitFor(() => expect(norm(document.querySelector('[data-testid="shopping-cart"]')?.textContent)).toContain('15,55 с.'));
    expect(screen.getByRole('button', { name: 'Подтвердить покупку' })).toBeEnabled();
  });
});
