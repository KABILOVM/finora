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
  it('единственный h1 «Ещё» и шесть пунктов в нужном порядке', () => {
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/budgets',
      '/recurring',
      '/debts',
      '/settings/categories',
      '/import',
      '/settings',
    ]);
  });

  it('имя ссылки — название раздела, пояснение читается отдельно (aria-describedby)', () => {
    show();
    for (const item of MORE_ITEMS) {
      const a = screen.getByRole('link', { name: item.title });
      const hint = document.getElementById(a.getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent).toBe(item.hint);
    }
  });

  it('пояснения короткие: помещаются в одну строку на телефоне', () => {
    for (const item of MORE_ITEMS) expect(item.hint.length, item.title).toBeLessThanOrEqual(34);
  });

  it('названия и пояснения без повторов', () => {
    expect(new Set(MORE_ITEMS.map((i) => i.title)).size).toBe(MORE_ITEMS.length);
    expect(new Set(MORE_ITEMS.map((i) => i.to)).size).toBe(MORE_ITEMS.length);
  });
});
