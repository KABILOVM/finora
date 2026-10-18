import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { moreGroups, SECTIONS } from '@/app/sections';
import { render, screen } from '@/components/testUtils';
import type { AttentionItem } from '@/features/home/attention';
import MorePage from './MorePage';

let attention: AttentionItem[] | undefined;
vi.mock('@/features/home/useAttention', () => ({ useAttention: () => attention }));

const show = (items?: AttentionItem[]) => {
  attention = items;
  return render(
    <MemoryRouter>
      <MorePage />
    </MemoryRouter>,
  );
};

describe('MorePage', () => {
  it('единственный h1 «Ещё»; четыре группы со своими заголовками, пункты в порядке реестра', () => {
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Деньги', 'Планирование', 'Инструменты', 'Приложение']);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/wallets',
      '/debts',
      '/budgets',
      '/recurring',
      '/shopping',
      '/rates',
      '/weather',
      '/settings/categories',
      '/import',
      '/settings',
    ]);
  });

  it('в «Ещё» ровно то, чего нет в нижней панели', () => {
    show();
    const inMore = moreGroups().flatMap((g) => g.items.map((s) => s.path));
    expect(inMore).toEqual(SECTIONS.filter((s) => !s.bottomBar).map((s) => s.path));
    expect(inMore).not.toContain('/analytics');
    expect(screen.getAllByRole('link')).toHaveLength(inMore.length);
  });

  it('имя ссылки — название раздела, без поясняющих строк и статусов', () => {
    show([{ id: 'debts', kind: 'debt', text: 'Просрочено долгов: 3', to: '/debts', tone: 'danger' }]);
    for (const s of SECTIONS.filter((x) => !x.bottomBar)) {
      const a = screen.getByRole('link', { name: s.title });
      expect(a.getAttribute('aria-describedby')).toBeNull();
    }
  });

  it('статус «Требует внимания» стоит рядом со своей строкой и не мешает ссылке; без статуса строка чистая', () => {
    show([
      { id: 'debts', kind: 'debt', text: 'Просрочено долгов: 3', to: '/debts', tone: 'danger' },
      { id: 'payments', kind: 'payment', text: 'Просрочен платёж: Аренда', to: '/recurring', tone: 'danger' },
      { id: 'budgets', kind: 'budget', text: 'Лимит превышен: Еда', to: '/budgets', tone: 'danger' },
    ]);
    expect(screen.getByText('Просрочено долгов: 3')).toBeTruthy();
    expect(screen.getByText('Просрочен платёж: Аренда')).toBeTruthy();
    expect(screen.getByText('Лимит превышен: Еда')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Долги' }).textContent).toBe('Долги');
    expect(screen.queryByText(/Покупки.*\d/)).toBeNull();
  });

  it('данные ещё читаются — статусов нет, список на месте', () => {
    show(undefined);
    expect(screen.getAllByRole('link')).toHaveLength(10);
  });
});
