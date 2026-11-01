import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import ProductsPage from './ProductsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

/** Чек из магазина: одним расходом, позиции становятся купленными и дают цены. */
async function receipt(s: Store, lines: { name: string; qtyMilli: number; unit: 'pcs' | 'kg' | 'l'; priceMinor: number }[]) {
  const cash = (await s.db.wallets.toArray())[0]!;
  await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines });
}

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup?.(s)) });
  await showApp(<ProductsPage />, td, '/products');
  await findByRole('heading', { name: 'Продукты', level: 1 });
  return td;
}
const row = (name: string) => norm(screen.getByText(name).closest('button')?.textContent);

describe('экран «Продукты»', () => {
  it('каталог по разделам; у продуктов без покупок «Цены пока нет»', async () => {
    await open();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Овощи', level: 2 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Молочное и яйца', level: 2 })).toBeInTheDocument();
    expect(row('Картофель')).toContain('Цены пока нет · за кг');
  });

  it('цены из покупок: «Картошка» и «Картофель» — один продукт; последняя и средняя за единицу', async () => {
    await open(async (s) => {
      await receipt(s, [{ name: 'Картошка', qtyMilli: 3000, unit: 'kg', priceMinor: 1800 }]); // 6,00 за кг
      await receipt(s, [{ name: 'Картофель', qtyMilli: 1000, unit: 'kg', priceMinor: 1000 }]); // 10,00 за кг
    });
    await waitFor(() => expect(row('Картофель')).toMatch(/Последняя 10,00 с\. · средняя 7,00 с\. за кг/));
    // молоко не покупали
    expect(row('Молоко')).toContain('Цены пока нет');
  });

  it('свои продукты: название не из каталога попадает в «Мои», с ценой', async () => {
    await open(async (s) => receipt(s, [{ name: 'Особый товар соседа', qtyMilli: 2000, unit: 'pcs', priceMinor: 500 }]));
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Мои продукты/, level: 2 })).toBeInTheDocument());
    expect(row('Особый товар соседа')).toMatch(/Последняя 2,50 с\./);
    expect(screen.getByRole('button', { name: /^Мои · 1$/ })).toBeInTheDocument();
  });

  it('фильтр «Покупал» — только то, что покупали (свежие первыми); раздел показывает только свои продукты каталога', async () => {
    await open(async (s) => {
      await receipt(s, [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }]);
      await receipt(s, [{ name: 'Картошка', qtyMilli: 1000, unit: 'kg', priceMinor: 700 }]);
    });
    await waitFor(() => expect(row('Молоко')).toContain('Последняя'));
    await user.click(screen.getByRole('button', { name: 'Покупал' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Овощи', level: 2 })).toBeNull());
    const names = screen.getAllByRole('listitem').map((li) => norm(li.textContent));
    expect(names).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Овощи' }));
    await waitFor(() => expect(row('Картофель')).toContain('Последняя'));
    expect(screen.queryByText('Молоко')).toBeNull();
  });

  it('поиск понимает синонимы и падежи; пусто — подсказка, как появится свой продукт', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('Картофель')).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: 'Поиск продукта' }), 'картошки');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Овощи', level: 2 })).toBeNull());
    expect(screen.getByText('Картофель')).toBeInTheDocument();
    // при поиске чипов разделов нет
    expect(screen.queryByRole('button', { name: 'Покупал' })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Поиск продукта' }));
    await user.type(screen.getByRole('textbox', { name: 'Поиск продукта' }), 'фывапролдж');
    expect(await waitFor(() => screen.getByText('Ничего не найдено'))).toBeInTheDocument();
  });

  it('карточка продукта: последняя и средняя цена, число покупок и последние покупки; закрывается', async () => {
    await open(async (s) => {
      await receipt(s, [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }]);
      await receipt(s, [{ name: 'Молоко', qtyMilli: 1000, unit: 'l', priceMinor: 1500 }]);
    });
    await waitFor(() => expect(row('Молоко')).toContain('Последняя'));
    await user.click(screen.getByText('Молоко'));
    const dlg = await findByRole('dialog', { name: 'Молоко' });
    const text = norm(dlg.textContent);
    expect(text).toContain('Последняя');
    expect(text).toMatch(/Средняя/);
    expect(text).toContain('Покупок с ценой всего: 2');
    expect(text).toContain('по покупкам за последние 90 дней (2)');
    expect(screen.getByRole('heading', { name: 'Последние покупки', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => dlg.contains(li))).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('удалили расход (или нажали «Отмена» после сохранения) — цены из его чека в историю не идут', async () => {
    const td = await open(async (s) => {
      await receipt(s, [{ name: 'Молоко', qtyMilli: 2000, unit: 'l', priceMinor: 2600 }]); // 13,00 за л
    });
    await waitFor(() => expect(row('Молоко')).toMatch(/Последняя 13,00 с\./));
    const tx = (await td.stores[0]!.db.transactions.toArray()).find((t) => t.deletedAt === null)!;
    await td.stores[0]!.transactions.softDelete(tx.id);
    await waitFor(() => expect(row('Молоко')).toContain('Цены пока нет'));
  });

  it('«В список покупок» в карточке: продукт попадает в «Покупки» (1 в его единице), карточка закрывается', async () => {
    const td = await open();
    await waitFor(() => expect(screen.getByText('Молоко')).toBeInTheDocument());
    await user.click(screen.getByText('Молоко'));
    await findByRole('dialog', { name: 'Молоко' });
    await user.click(screen.getByRole('button', { name: 'В список покупок' }));
    await waitFor(async () => {
      const items = (await td.stores[0]!.db.shopping_items.toArray()).filter((i) => i.deletedAt === null);
      expect(items.map((i) => [i.name, i.qtyMilli, i.unit])).toEqual([['Молоко', 1000, 'l']]);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('карточка продукта без покупок объясняет, откуда возьмётся цена', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('Картофель')).toBeInTheDocument());
    await user.click(screen.getByText('Картофель'));
    const dlg = await findByRole('dialog', { name: 'Картофель' });
    expect(norm(dlg.textContent)).toContain('Цены пока нет');
  });
});
