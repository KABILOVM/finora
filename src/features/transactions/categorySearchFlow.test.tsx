import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import { allTxs, amountField, categoryByName, openAddSheet, opsDeps, pinToday, tapAmount, unpinToday } from './__fixtures__/opsKit';

beforeEach(pinToday); // сегодня — 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const openCategories = () => user.click(screen.getByRole('button', { name: /^Категория:/ }));
const searchBox = () => screen.getByRole('textbox', { name: 'Поиск категории' }) as HTMLInputElement;
const grid = () => screen.getByRole('group', { name: 'Категория' });
const names = () => Array.from(grid().querySelectorAll('button[aria-pressed]')).map((b) => (b.querySelector('span[lang]')?.textContent ?? '').trim());

describe('поиск категории в окне «Новая операция»', () => {
  it('расход: поле в панели категорий, курсор в нём; набор сужает список', async () => {
    await openAddSheet();
    await openCategories();
    expect(document.activeElement).toBe(searchBox());
    expect(names()).toContain('Транспорт');
    await user.keyboard('здор');
    expect(names()).toEqual(['Здоровье']);
  });

  it('Enter выбирает найденное: панель закрывается, категория на плитке, курсор вернулся в сумму, операция не сохранена', async () => {
    const td = opsDeps();
    await openAddSheet(td);
    await openCategories();
    await user.keyboard('транс{Enter}');
    expect(screen.getByRole('button', { name: 'Категория: Транспорт' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Категория' })).toBeNull();
    expect(document.activeElement).toBe(amountField());
    expect(await allTxs(td)).toHaveLength(0); // Enter в поиске не отправил форму
  });

  it('выбранное из поиска сохраняется с операцией', async () => {
    const td = opsDeps();
    await openAddSheet(td);
    await tapAmount('50');
    await openCategories();
    await user.type(searchBox(), 'подпис');
    await user.click(screen.getByRole('button', { name: /Подписки/ }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [tx] = await waitFor(async () => {
      const all = await allTxs(td);
      if (all.length === 0) throw new Error('операции ещё нет');
      return all;
    });
    expect(tx?.categoryId).toBe((await categoryByName(td, 'Подписки')).id);
  });

  it('не нашлось: подсказка, «Новая» подставляет набранное, категория создаётся и выбирается', async () => {
    await openAddSheet();
    await openCategories();
    await user.keyboard('Кофейня');
    expect(screen.getByRole('status')).toHaveTextContent('Такой категории нет');
    await user.click(screen.getByRole('button', { name: 'Новая категория' }));
    const name = await waitFor(() => screen.getByRole('textbox', { name: 'Название новой категории' }) as HTMLInputElement);
    expect(name.value).toBe('Кофейня');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => screen.getByRole('button', { name: 'Категория: Кофейня' }));
  });

  it('доход: категорий мало (5) — поля поиска нет', async () => {
    await openAddSheet(opsDeps(), '/add?kind=income');
    await openCategories();
    await waitFor(() => grid());
    expect(screen.queryByRole('textbox', { name: 'Поиск категории' })).toBeNull();
  });
});
