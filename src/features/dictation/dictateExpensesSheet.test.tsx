import { describe, expect, it, vi } from 'vitest';
import { findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import type { DraftExpense } from '@/domain/expensesAi';
import type { LocalRow, Wallet } from '@/domain/types';
import { DictateExpensesSheet } from './DictateExpensesSheet';

const wallets = [
  { id: 'w1', name: 'Наличные', currency: 'TJS' },
  { id: 'w2', name: 'Доллары', currency: 'USD' },
  { id: 'w3', name: 'Карта', currency: 'TJS' },
] as unknown as LocalRow<Wallet>[];
const categories = [{ id: 'c1', name: 'Продукты' }];

const row = (rid: number, over: Partial<DraftExpense> = {}): DraftExpense => ({
  rid,
  kind: 'expense',
  toWalletId: '',
  title: 'Такси',
  amountText: '25',
  feeText: '',
  walletId: 'w1',
  categoryId: '',
  newCategory: '',
  date: '2026-10-12',
  note: '',
  walletGuessed: true,
  ...over,
});

function setup(drafts: DraftExpense[], save = vi.fn(async (d: readonly DraftExpense[]) => ({ saved: d.map((x) => x.rid) }))) {
  const onClose = vi.fn();
  const parse = vi.fn(async () => ({ drafts, transcript: '' }));
  render(
    <DictateExpensesSheet
      wallets={wallets}
      categories={categories}
      defaultWalletId="w1"
      today="2026-10-12"
      parse={parse}
      listen={vi.fn()}
      validate={() => new Map()}
      save={save}
      canRecord={false}
      onClose={onClose}
    />,
  );
  return { onClose, save, parse };
}
const run = async () => {
  await user.type(screen.getByRole('textbox', { name: 'Что произошло' }), 'такси двадцать пять');
  await user.click(screen.getByRole('button', { name: 'Разобрать' }));
};

describe('«Продиктовать операции»', () => {
  it('разбор → правка суммы и категории → сохранить все', async () => {
    const { save, onClose } = setup([row(1), row(2, { title: 'Продукты', amountText: '300', feeText: '5' })]);
    await run();
    await waitFor(() => screen.getByRole('button', { name: 'Сохранить 2 операции' }));
    expect(screen.getByText(/с комиссией/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Изменить: Такси' }));
    const amount = screen.getByRole('textbox', { name: /Сумма/ });
    await user.clear(amount);
    await user.type(amount, '30');
    // категория выбирается из списка со значками
    await user.click(screen.getByRole('button', { name: /^Категория:/ }));
    await user.click(screen.getByRole('option', { name: /Продукты/ }));
    await user.click(screen.getByRole('button', { name: 'Сохранить 2 операции' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
    expect(save.mock.calls[0]![0]![0]).toMatchObject({ rid: 1, amountText: '30', categoryId: 'c1' });
  });

  it('лишнюю операцию можно убрать; пустой результат объясняется', async () => {
    const { save } = setup([row(1), row(2, { title: 'Кофе' })]);
    await run();
    await user.click(await findByRole('button', { name: 'Убрать: Кофе' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 операцию' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toHaveLength(1);
  });

  it('при сбое остаются только несохранённые строки, ошибка видна', async () => {
    const save = vi.fn(async () => ({ saved: [1], failed: { rid: 2, message: 'Нет курса' } }));
    const { onClose } = setup([row(1), row(2, { title: 'Кофе' })], save);
    await run();
    await user.click(await findByRole('button', { name: 'Сохранить 2 операции' }));
    await waitFor(() => screen.getByRole('button', { name: 'Сохранить 1 операцию' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Сохранено 1/);
    expect(screen.queryByText('Такси')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('новая категория создаётся прямо в списке: название запоминается и уходит в сохранение; такая же по имени просто выбирается', async () => {
    const { save } = setup([row(1)]);
    await run();
    await user.click(await findByRole('button', { name: 'Изменить: Такси' }));
    await user.click(screen.getByRole('button', { name: /^Категория:/ }));
    await user.click(screen.getByRole('button', { name: 'Новая категория' }));
    await user.type(screen.getByRole('textbox', { name: 'Название новой категории' }), 'Кофе{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Категория: Новая: Кофе' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Категория: Новая: Кофе' }));
    await user.click(screen.getByRole('button', { name: 'Новая категория' }));
    await user.type(screen.getByRole('textbox', { name: 'Название новой категории' }), 'продукты{Enter}');
    expect(screen.getByRole('button', { name: 'Категория: Продукты' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Категория: Продукты' }));
    await user.click(screen.getByRole('button', { name: 'Новая категория' }));
    await user.type(screen.getByRole('textbox', { name: 'Название новой категории' }), 'Кофе{Enter}');
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 операцию' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]![0]).toMatchObject({ categoryId: '', newCategory: 'Кофе' });
  });
});

describe('вид операции в списке', () => {
  it('«Перевод»: категории нет, выбирается «Куда» (счёт той же валюты), в сохранение уходит вид и счёт назначения', async () => {
    const { save } = setup([row(1, { title: 'Снял наличные', amountText: '1000' })]);
    await run();
    await user.click(await findByRole('button', { name: 'Изменить: Снял наличные' }));
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.queryByRole('button', { name: /^Категория:/ })).toBeNull();
    // счёт назначения подставился сам: единственный другой счёт в той же валюте
    expect(screen.getByRole('button', { name: /^Куда:/ }).getAttribute('aria-label')).toMatch(/Карта/);
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 операцию' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]![0]).toMatchObject({ kind: 'transfer', walletId: 'w1', toWalletId: 'w3', categoryId: '' });
  });

  it('«Доход»: поле комиссии пропадает, сумма показывается со знаком плюс', async () => {
    setup([row(1, { title: 'Зарплата', amountText: '5000', feeText: '5' })]);
    await run();
    await user.click(await findByRole('button', { name: 'Изменить: Зарплата' }));
    expect(screen.getByRole('textbox', { name: 'Комиссия' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.queryByRole('textbox', { name: 'Комиссия' })).toBeNull();
    expect(document.querySelector('[data-testid="draft-expense"]')?.textContent).toMatch(/\+/);
  });

  it('смена вида сбрасывает категорию прежнего вида', async () => {
    const { save } = setup([row(1, { categoryId: 'c1' })]);
    await run();
    await user.click(await findByRole('button', { name: 'Изменить: Такси' }));
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 операцию' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]![0]).toMatchObject({ kind: 'income', categoryId: '' });
  });
});
