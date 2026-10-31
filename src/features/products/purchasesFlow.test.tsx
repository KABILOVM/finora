import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import {
  amountField,
  catBtn,
  cashWallet,
  liveTxs,
  openAddSheet,
  opsDeps,
  pinToday,
  storeOf,
  unpinToday,
  type OpsDeps,
} from '@/features/transactions/__fixtures__/opsKit';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const openPurchases = () => user.click(screen.getByRole('button', { name: /^Что куплено/ }));
const purchasesDialog = () => screen.getByRole('dialog', { name: 'Что куплено' });
const pick = async (query: string, title: RegExp | string) => {
  await user.type(screen.getByRole('textbox', { name: 'Найти продукт' }), query);
  await user.click(await findByRole('button', { name: title }));
};
const field = (name: string | RegExp) => screen.getByRole('textbox', { name });

async function startGroceries(td: OpsDeps = opsDeps()) {
  const res = await openAddSheet(td);
  await user.click(catBtn('Продукты'));
  return res;
}

describe('«Что куплено» в «Новой операции»', () => {
  it('блок есть у «Продуктов» и нет у других категорий', async () => {
    await openAddSheet();
    expect(screen.queryByRole('button', { name: /^Что куплено/ })).toBeNull();
    await user.click(catBtn('Еда'));
    expect(screen.queryByRole('button', { name: /^Что куплено/ })).toBeNull();
    await user.click(catBtn('Продукты'));
    expect(screen.getByRole('button', { name: 'Что куплено: добавить продукты' })).toBeInTheDocument();
  });

  it('продукты → сумма операции = сумма строк; расход и позиции пишутся одним чеком, цены видны в книге цен', async () => {
    const td = opsDeps();
    const { onClose } = await startGroceries(td);
    await openPurchases();

    // картошка по падежу находит «Картофель»; 2 кг за 24 с. → 12 с. за кг
    await pick('картошки', /^Картофель/);
    await user.clear(field('Количество'));
    await user.type(field('Количество'), '2');
    await user.type(field('Сумма за всё'), '24');
    expect(purchasesDialog()).toHaveTextContent('Цена: 12,00 с. за кг');

    // второй продукт: молоко, 1 л за 13,50
    await pick('молок', /^Молоко\s*Цены/);
    await user.type(field('Сумма за всё'), '13,50');
    expect(norm(purchasesDialog().textContent)).toMatch(/Итого · 2 продукта.*37,50 с\./);
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Что куплено' })).toBeNull());

    // сумма операции посчитана и заблокирована
    expect(amountField()).toHaveValue('37,5');
    expect(amountField()).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /^Что куплено: 2 продукта/ })).toHaveTextContent('37,50 с.');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(() => expect(onClose).toHaveBeenCalled());

    const txs = await liveTxs(td);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: 'expense', amountMinor: 3750 });
    const cat = (await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Продукты');
    expect(txs[0]?.categoryId).toBe(cat?.id);
    // позиции — купленные, привязаны к расходу, названия каталожные
    const items = (await storeOf(td).db.shopping_items.toArray()).sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(items.map((i) => [i.name, i.qtyMilli, i.unit, i.priceMinor, i.transactionId])).toEqual([
      ['Картофель', 2000, 'kg', 2400, txs[0]?.id],
      ['Молоко', 1000, 'l', 1350, txs[0]?.id],
    ]);
  });

  it('строка без суммы: «Сохранить» открывает окно и показывает, что не так; ничего не записано', async () => {
    const td = opsDeps();
    await startGroceries(td);
    await openPurchases();
    await pick('хлеб', /^Хлеб\s*Цены/);
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    // «Готово» с недописанной строкой не закрывает окно
    expect(purchasesDialog()).toHaveTextContent('Введите сумму за этот продукт');
    await user.click(screen.getAllByRole('button', { name: 'Закрыть' }).at(-1)!); // верхнее окно — «Что куплено»
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Что куплено' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(purchasesDialog()).toHaveTextContent('Введите сумму за этот продукт'));
    expect(await liveTxs(td)).toHaveLength(0);
    expect(await storeOf(td).db.shopping_items.count()).toBe(0);
  });

  it('свой продукт: название, которого нет в каталоге, добавляется как есть и попадает в историю', async () => {
    const td = opsDeps();
    const { onClose } = await startGroceries(td);
    await openPurchases();
    await user.type(screen.getByRole('textbox', { name: 'Найти продукт' }), 'Курт сушёный');
    await user.click(await findByRole('button', { name: /Добавить «Курт сушёный»/ }));
    await user.clear(field('Количество'));
    await user.type(field('Количество'), '3');
    await user.type(field('Сумма за всё'), '45');
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(() => expect(onClose).toHaveBeenCalled());
    const items = await storeOf(td).db.shopping_items.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Курт сушёный', qtyMilli: 3000, unit: 'pcs', priceMinor: 4500 });
  });

  it('убрали все продукты — сумма снова вводится руками, расход обычный, без позиций', async () => {
    const td = opsDeps();
    const { onClose } = await startGroceries(td);
    await openPurchases();
    await pick('сахар', /^Сахар\s*Цены/);
    await user.type(field('Сумма за всё'), '10');
    await user.click(screen.getByRole('button', { name: 'Убрать: Сахар' }));
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(amountField()).not.toHaveAttribute('readonly'));
    await user.clear(amountField());
    await user.type(amountField(), '99');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 9900 });
    expect(await storeOf(td).db.shopping_items.count()).toBe(0);
  });

  it('подсказка по прошлой цене: из истории виден прошлый раз и «Подставить» заполняет сумму', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray())[0]!;
        await s.shopping.recordReceipt({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', lines: [{ name: 'Яблоки', qtyMilli: 2000, unit: 'kg', priceMinor: 3000 }] });
      },
    });
    await startGroceries(td);
    await openPurchases();
    // без набора — «Недавно покупали»: яблоки уже в подсказках
    await user.click(await findByRole('button', { name: /^Яблоки/ }));
    expect(purchasesDialog()).toHaveTextContent('Прошлый раз 15,00 с., в среднем 15,00 с. за кг');
    await user.clear(field('Количество'));
    await user.type(field('Количество'), '2');
    await user.click(screen.getByRole('button', { name: /Подставить 30,00 с\./ }));
    expect(field('Сумма за всё')).toHaveValue('30');
  });

  it('кошелёк не в основной валюте: вместо блока пояснение, сумма вводится как обычно', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#16a34a', icon: '💵' });
      },
    });
    await openAddSheet(td);
    await user.click(catBtn('Продукты'));
    expect(screen.getByRole('button', { name: 'Что куплено: добавить продукты' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Кошелёк/ }));
    await user.click(await findByRole('button', { name: /Доллары/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Что куплено/ })).toBeNull());
    expect(screen.getByText(/вносятся в основной валюте \(TJS\)/)).toBeInTheDocument();
    expect(amountField()).not.toHaveAttribute('readonly');
    expect((await cashWallet(td)).currency).toBe('TJS');
  });
});
