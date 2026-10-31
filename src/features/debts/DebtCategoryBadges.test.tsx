import { describe, expect, it } from 'vitest';
import { render } from '@/components/testUtils';
import { DebtCategoryBadges } from './DebtCategoryBadges';

const ids = (id: string) => Array.from(document.querySelectorAll(`[data-testid="${id}"]`));

describe('DebtCategoryBadges', () => {
  it('нет категорий — ничего не рисуется', () => {
    render(<DebtCategoryBadges categories={[]} />);
    expect(ids('debt-category')).toHaveLength(0);
    expect(ids('debt-category-more')).toHaveLength(0);
  });
  it('одна и две категории показываются значками; для скринридера первая подписана «Категория:»', () => {
    render(<DebtCategoryBadges categories={['Друзья', 'Кредит']} />);
    expect(ids('debt-category').map((e) => e.textContent)).toEqual(['Категория: Друзья', 'Кредит']);
    expect(ids('debt-category-more')).toHaveLength(0);
  });
  it('больше двух: остальные числом, полный список — в подсказке', () => {
    render(<DebtCategoryBadges categories={['А', 'Б', 'В', 'Г']} />);
    expect(ids('debt-category')).toHaveLength(2);
    const more = ids('debt-category-more')[0]!;
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('title')).toBe('В, Г');
  });
});
