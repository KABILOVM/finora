import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
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

  it('«Картошка» в списке получает цену «Картофеля» из прошлых покупок (один продукт каталога под разными названиями)', async () => {
    await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Картофель', qtyMilli: 2000, unit: 'kg', priceMinor: 2400 }] });
      await s.shopping.add({ name: 'Картошка', qtyMilli: 3000, unit: 'kg' });
    });
    await waitFor(() => expect(planText()).toContain('≈ 36,00 с.'));
    const row = screen.getAllByRole('listitem').map((li) => norm(li.textContent)).find((r) => r.includes('Картошка 3 кг'));
    expect(row).toMatch(/обычно 12,00 с\.\/кг.*≈ 36,00 с\./);
  });

  it('план по средним ценам: рядом с планом по последним, когда они различаются', async () => {
    await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-09', lines: [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }] }); // 13,00 за л
      await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Молоко', qtyMilli: 1000, unit: 'l', priceMinor: 900 }] }); // 9,00 за л — последняя
      await s.shopping.add({ name: 'Молоко', qtyMilli: 3000, unit: 'l' });
    });
    // по последней: 3 л × 9,00 = 27,00; по средней: (26,00 + 9,00) / 3 л = 11,67 за л → 35,01
    await waitFor(() => expect(planText()).toContain('≈ 27,00 с.'));
    expect(planText()).toContain('по средним ценам ≈ 35,01 с.');
  });

  it('когда последняя и средняя совпадают, второго плана нет', async () => {
    await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }] });
      await s.shopping.add({ name: 'Молоко', qtyMilli: 1000, unit: 'l' });
    });
    await waitFor(() => expect(planText()).toContain('≈ 13,00 с.'));
    expect(planText()).not.toContain('по средним');
  });

  it('удалили расход — цены из его чека в список не попадают («обычно» пропадает)', async () => {
    const td = await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }] });
      await s.shopping.add({ name: 'Молоко', qtyMilli: 1000, unit: 'l' });
    });
    await waitFor(() => expect(planText()).toContain('≈ 13,00 с.'));
    const s = td.stores[0]!;
    const tx = (await s.db.transactions.toArray()).find((t) => t.deletedAt === null)!;
    await s.transactions.softDelete(tx.id);
    await waitFor(() => expect(screen.getAllByRole('listitem').map((li) => norm(li.textContent)).find((r) => r.includes('Молоко'))).toContain('цены ещё нет'));
  });

  describe('новая позиция: подсказки каталога', () => {
    const openNew = async (setup?: (s: Store) => Promise<unknown>) => {
      const td = await open(async (s) => {
        await s.shopping.add({ name: 'Рис', qtyMilli: 1000, unit: 'kg' }); // список не пуст: кнопка «Добавить позицию» одна
        await setup?.(s);
      });
      await user.click(await findByRole('button', { name: 'Добавить позицию' }));
      await findByRole('dialog', { name: 'Новая позиция' });
      return td;
    };
    const nameField = () => screen.getByRole('textbox', { name: 'Название' });

    it('набрали «картошки» — предлагается «Картофель» с ценой «Цены пока нет · за кг»; выбор подставляет название и единицу', async () => {
      await openNew();
      await user.type(nameField(), 'картошки');
      const hint = await findByRole('button', { name: /^Картофель/ });
      expect(norm(hint.textContent)).toContain('Цены пока нет · за кг');
      await user.click(hint);
      expect(nameField()).toHaveValue('Картофель');
      expect(screen.getByRole('radio', { name: 'кг', checked: true })).toBeInTheDocument();
      // выбрали — подсказки убраны
      expect(screen.queryByRole('button', { name: /^Картофель/ })).toBeNull();
    });

    it('у продукта с историей: в подсказке последняя и средняя цена, под полями «Прошлый раз …»; единица — та, в которой покупали', async () => {
      await openNew(async (s) => {
        const cash = (await s.db.wallets.toArray())[0]!;
        await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }] });
      });
      await user.type(nameField(), 'молок');
      const hint = await findByRole('button', { name: /^Молоко\s*Последняя/ });
      expect(norm(hint.textContent)).toContain('Последняя 13,00 с. · средняя 13,00 с. за л');
      await user.click(hint);
      expect(screen.getByRole('radio', { name: 'л', checked: true })).toBeInTheDocument();
      expect(norm(document.querySelector('[data-testid="item-past-price"]')?.textContent)).toBe('Прошлый раз 13,00 с., в среднем 13,00 с. за л');
    });

    it('своё название без подсказок сохраняется как есть', async () => {
      const td = await openNew();
      await user.type(nameField(), 'Курт сушёный');
      expect(screen.queryByRole('list', { name: 'Продукты из каталога' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Добавить' }));
      await waitFor(async () => expect((await td.stores[0]!.db.shopping_items.toArray()).map((i) => i.name)).toContain('Курт сушёный'));
    });
  });
});
