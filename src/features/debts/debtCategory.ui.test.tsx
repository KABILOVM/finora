import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { opsDeps, pinToday, showApp, storeOf, table, tapAmount, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

type Setup = (s: Store) => Promise<unknown>;

async function openList(setup?: Setup) {
  const td = opsDeps([table()], { setup: setup ? async (s: Store) => void (await setup(s)) : undefined });
  await showApp(
    <Routes>
      <Route path="/debts" element={<DebtsPage />} />
      <Route path="/debts/:id" element={<DebtDetailPage />} />
    </Routes>,
    td,
    '/debts',
  );
  await findByRole('heading', { name: 'Долги', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
const chip = (name: string) => screen.getByRole('button', { name });
const chipPressed = (name: string) => chip(name).getAttribute('aria-pressed') === 'true';

async function openNew() {
  await user.click(screen.getByRole('button', { name: 'Новый долг' }));
  await findByRole('dialog', { name: 'Новый долг' });
}
const fillBasics = async () => {
  await user.type(screen.getByRole('textbox', { name: /^(Кому я дал|У кого я взял)$/ }), 'Алишер');
  await tapAmount('500');
};
const save = async () => {
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
};

describe('поле «Категория» в форме «Новый долг»', () => {
  it('по умолчанию «Без категории»; рядом готовые названия и «Другая…»; долг сохраняется без категории', async () => {
    const td = await openNew0();
    expect(chipPressed('Без категории')).toBe(true);
    for (const name of ['Друзья', 'Семья', 'Работа', 'Кредит', 'Рассрочка', 'Другая…']) expect(chip(name)).toBeTruthy();
    await fillBasics();
    await save();
    expect((await storeOf(td).db.debts.toArray())[0]!.category).toBe('');
  });

  it('готовое название: выбирается чипом, записывается, в списке у долга значок', async () => {
    const td = await openNew0();
    await user.click(chip('Друзья'));
    expect(chipPressed('Друзья')).toBe(true);
    expect(chipPressed('Без категории')).toBe(false);
    await fillBasics();
    await save();
    expect((await storeOf(td).db.debts.toArray())[0]!.category).toBe('Друзья');
    const row = await findByRole('link', { name: /^Алишер/ });
    expect(textOf(row.querySelector('[data-testid="debt-category"]'))).toContain('Друзья');
  });

  it('«Другая…»: своё слово чистится от лишних пробелов и попадает в список выбора следующего долга', async () => {
    const td = await openNew0();
    await user.click(chip('Другая…'));
    await user.type(screen.getByRole('textbox', { name: 'Своя категория' }), '  Соседи   по даче ');
    await fillBasics();
    await save();
    expect((await storeOf(td).db.debts.toArray())[0]!.category).toBe('Соседи по даче');
    // следующий долг: своё слово уже среди чипов, причём первым (оно есть у долга, а готовые — позже)
    await openNew();
    expect(chip('Соседи по даче')).toBeTruthy();
  });

  it('поле своей категории само не даёт набрать больше 40 символов', async () => {
    await openNew0();
    await user.click(chip('Другая…'));
    expect((screen.getByRole('textbox', { name: 'Своя категория' }) as HTMLInputElement).maxLength).toBe(40);
  });

  async function openNew0() {
    const td = await openList();
    await openNew();
    return td;
  }
});

describe('категория при правке долга и на странице долга', () => {
  const seed = (s: Store) =>
    s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', category: 'Друзья' });

  it('на списке правка идёт через страницу долга: категория показана в карточке', async () => {
    const td = await openList(async (s) => void (await seed(s)));
    const row = await findByRole('link', { name: /^Алишер/ });
    await user.click(row);
    await findByRole('heading', { name: 'Алишер', level: 1 });
    expect(textOf(document.querySelector('[data-testid="debt-category-line"]'))).toBe('Друзья');

    // правка: чип «Друзья» выбран, меняем на «Семья»
    await user.click(screen.getByRole('button', { name: 'Править' }));
    await findByRole('dialog', { name: 'Правка долга' });
    expect(chipPressed('Друзья')).toBe(true);
    await user.click(chip('Семья'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Правка долга' })).toBeNull());
    expect((await storeOf(td).db.debts.toArray())[0]!.category).toBe('Семья');
    await waitFor(() => expect(textOf(document.querySelector('[data-testid="debt-category-line"]'))).toBe('Семья'));
  });

  it('правка без изменения категории не трогает её; «Без категории» стирает', async () => {
    const td = await openList(async (s) => void (await seed(s)));
    await user.click(await findByRole('link', { name: /^Алишер/ }));
    await findByRole('heading', { name: 'Алишер', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Править' }));
    await findByRole('dialog', { name: 'Правка долга' });
    await user.click(chip('Без категории'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Правка долга' })).toBeNull());
    expect((await storeOf(td).db.debts.toArray())[0]!.category).toBe('');
    await waitFor(() => expect(document.querySelector('[data-testid="debt-category-line"]')).toBeNull());
  });
});
