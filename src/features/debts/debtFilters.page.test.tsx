import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { choose, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtsPage from './DebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

type Create = Parameters<Store['debts']['create']>[0];
type Setup = (s: Store) => Promise<unknown>;

async function openPage(setup: Setup, path = '/debts') {
  const td = opsDeps([table()], { setup: async (s: Store) => void (await setup(s)) });
  await showApp(<DebtsPage />, td, path);
  await findByRole('heading', { name: 'Долги', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const lend = (s: Store, over: Partial<Create> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });

/** Три долга «мне должны»: друг, родственник и кредит с процентами, у одного из них срок уже прошёл. */
async function seed(s: Store) {
  await lend(s, { counterparty: 'Алишер', category: 'Друзья', principalMinor: 50_000, dueOn: '2026-10-05' });
  await lend(s, { counterparty: 'Бобо', category: 'Семья', principalMinor: 20_000 });
  await lend(s, { counterparty: 'Вали', principalMinor: 10_000 });
}

const links = () => screen.queryAllByRole('link').map((a) => a.textContent ?? '');
const has = (name: string) => links().some((t) => t.startsWith(name));

const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();

/** Открывает «Фильтры», выставляет значения (fn) и жмёт «Применить». */
async function applyFilter(fn: () => void | Promise<void>) {
  await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
  await findByRole('dialog');
  await fn();
  await user.click(screen.getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('«Долги»: фильтры', () => {
  it('кнопки «Фильтры» нет, пока долгов нет', async () => {
    await openPage(async () => undefined);
    expect(screen.queryByRole('button', { name: /^Фильтры/ })).toBeNull();
  });

  it('по категории: остаётся только она; итог и пометка «С учётом фильтров» считаются по подошедшим', async () => {
    await openPage(seed);
    expect(has('Алишер') && has('Бобо') && has('Вали')).toBe(true);
    expect(byId('debts-filtered-note')).toBeNull();

    await applyFilter(() => choose('Категория', 'Друзья'));
    expect(has('Алишер')).toBe(true);
    expect(has('Бобо')).toBe(false);
    expect(has('Вали')).toBe(false);
    expect(screen.getByRole('button', { name: 'Фильтры, включено: 1' })).toBeTruthy();
    expect(textOf(byId('active-filters'))).toContain('Друзья');
    expect(textOf(byId('debts-filtered-note'))).toContain('С учётом фильтров');
    // итог — только 500, а не 800
    const total = textOf(byId('debts-totals'));
    expect(total.replace(/\s/g, '')).toContain('500');
    expect(total.replace(/\s/g, '')).not.toContain('800');
  });

  it('«Без категории» и «Сбросить» возвращает всё', async () => {
    await openPage(seed);
    await applyFilter(() => choose('Категория', 'Без категории'));
    expect(has('Вали')).toBe(true);
    expect(has('Алишер')).toBe(false);

    await user.click(byId('active-filters')!.querySelector('button')!);
    expect(has('Алишер') && has('Бобо') && has('Вали')).toBe(true);
    expect(byId('debts-filtered-note')).toBeNull();
  });

  it('по сроку: «Просроченные» — только долг с прошедшим сроком, у него есть значок категории', async () => {
    await openPage(seed);
    await applyFilter(() => user.click(screen.getByRole('button', { name: 'Просроченные' })));
    expect(has('Алишер')).toBe(true);
    expect(has('Бобо')).toBe(false);
    expect(textOf(screen.getByRole('link', { name: /^Алишер/ }).querySelector('[data-testid="debt-category"]'))).toContain('Друзья');
  });

  it('ничего не подошло: понятное сообщение и «Сбросить фильтры»', async () => {
    await openPage(seed);
    // «Семья» и «просроченные» вместе: у Бобо срока нет, у Алишера другая категория
    await applyFilter(async () => {
      choose('Категория', 'Семья');
      await user.click(screen.getByRole('button', { name: 'Просроченные' }));
    });
    expect(await findByRole('heading', { name: 'По этим фильтрам долгов нет' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(has('Алишер') && has('Бобо') && has('Вали')).toBe(true);
  });

  it('фильтры общие для вкладок, а на вкладке «Люди» действуют на итоги по людям', async () => {
    await openPage(seed);
    await applyFilter(() => choose('Категория', 'Семья'));
    await user.click(screen.getByRole('radio', { name: 'Люди' }));
    const people = textOf(screen.getByRole('list', { name: 'Люди' }));
    expect(people).toContain('Бобо');
    expect(people).not.toContain('Алишер');
    expect(byId('debts-filtered-note')).toBeTruthy();
  });

  it('выбранная категория, которой больше нет ни у одного долга, перестаёт фильтровать', async () => {
    const td = await openPage(seed);
    await applyFilter(() => choose('Категория', 'Семья'));
    expect(has('Бобо') && !has('Алишер')).toBe(true);
    // у «Бобо» убрали категорию: «Семьи» в списке больше нет, фильтр сам стал «любым» и список снова полный
    const store = storeOf(td);
    const bobo = (await store.db.debts.toArray()).find((d) => d.counterparty === 'Бобо')!;
    await store.debts.update(bobo.id, { category: '' });
    await waitFor(() => expect(has('Алишер') && has('Вали')).toBe(true));
    expect(screen.queryByRole('button', { name: /^Фильтры, включено/ })).toBeNull();
  });
});
