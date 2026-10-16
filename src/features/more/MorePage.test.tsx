import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@/components/testUtils';
import MorePage, { MORE_ITEMS } from './MorePage';

const show = () =>
  render(
    <MemoryRouter>
      <MorePage />
    </MemoryRouter>,
  );

describe('MorePage', () => {
  it('единственный h1 «Ещё» и восемь пунктов в нужном порядке (категории и импорт лежат в «Настройках»)', () => {
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/budgets',
      '/analytics',
      '/recurring',
      '/shopping',
      '/debts',
      '/rates',
      '/weather',
      '/settings',
    ]);
  });

  it('имя ссылки — название раздела, без поясняющих строк', () => {
    show();
    for (const item of MORE_ITEMS) {
      const a = screen.getByRole('link', { name: item.title });
      expect(a.getAttribute('aria-describedby')).toBeNull();
    }
  });

  it('названия и адреса без повторов', () => {
    expect(new Set(MORE_ITEMS.map((i) => i.title)).size).toBe(MORE_ITEMS.length);
    expect(new Set(MORE_ITEMS.map((i) => i.to)).size).toBe(MORE_ITEMS.length);
  });
});
