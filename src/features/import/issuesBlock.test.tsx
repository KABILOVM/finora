import { describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import type { RowIssue, SkippedRow } from '@/import/types';
import { NotesBlock, REVIEW_FLAT_MAX, REVIEW_GROUP_SHOWN, ReviewBlock, SkippedBlock } from './IssuesBlock';

const issue = (line: number, code: RowIssue['code'] = 'amount-ambiguous'): RowIssue => ({ line, code, message: `причина строки ${line}`, summary: `2026-09-01 · −${line}` });

describe('«Нужно проверить»', () => {
  it('строк немного — один список по порядку файла, без групп', () => {
    const review = [issue(3), issue(5, 'date'), issue(9, 'currency')];
    render(<ReviewBlock review={review} />);
    expect(screen.getByRole('heading', { name: 'Нужно проверить (3)', level: 2 })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Строки, которые нужно проверить' });
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it(`больше ${REVIEW_FLAT_MAX} строк — группы по причине, самая частая первой; в группе ${REVIEW_GROUP_SHOWN} строк и «Показать все N»`, async () => {
    const review = [...Array.from({ length: 40 }, (_, i) => issue(10 + i, 'amount-ambiguous')), issue(100, 'date'), issue(101, 'date')];
    render(<ReviewBlock review={review} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Неоднозначная сумма · 40', 'Непонятная дата · 2']);
    const big = screen.getByRole('list', { name: 'Строки: Неоднозначная сумма' });
    expect(big.querySelectorAll('li')).toHaveLength(REVIEW_GROUP_SHOWN);
    expect(screen.getByRole('list', { name: 'Строки: Непонятная дата' }).querySelectorAll('li')).toHaveLength(2);
    // «Показать все 40» раскрывает всё (прежний предел в 30 строк убран), «Свернуть» возвращает пять
    const all = screen.getByRole('button', { name: 'Показать все 40' });
    expect(all.getAttribute('aria-expanded')).toBe('false');
    await user.click(all);
    expect(screen.getByRole('list', { name: 'Строки: Неоднозначная сумма' }).querySelectorAll('li')).toHaveLength(40);
    expect(screen.getByRole('button', { name: 'Свернуть' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(screen.getByRole('list', { name: 'Строки: Неоднозначная сумма' }).querySelectorAll('li')).toHaveLength(REVIEW_GROUP_SHOWN);
    // в группе из двух строк кнопки нет
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('пусто — блока нет', () => {
    const { container } = render(<ReviewBlock review={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('«Пропущено» и «Обратите внимание»', () => {
  it('пропущенное — по группам с номерами строк; много строк — первые 12 и «и ещё N»', () => {
    const skipped: SkippedRow[] = [
      ...Array.from({ length: 15 }, (_, i) => ({ line: 2 + i, code: 'zero' as const, message: 'нулевая сумма' })),
      { line: 40, code: 'no-date', message: 'нет даты' },
    ];
    render(<SkippedBlock skipped={skipped} />);
    expect(screen.getByRole('heading', { name: 'Пропущено (16)', level: 2 })).toBeTruthy();
    expect(screen.getByText('Нулевая сумма:').parentElement?.textContent).toContain('15 строк');
    expect(screen.getByText(/Строки файла: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 и ещё 3/)).toBeTruthy();
    expect(screen.getByText('Нет даты:').parentElement?.textContent).toContain('1 строка');
  });

  it('предупреждения плана — списком в плашке', () => {
    render(<NotesBlock notes={['Первое', 'Второе']} />);
    expect(screen.getByRole('heading', { name: 'Обратите внимание', level: 2 })).toBeTruthy();
    expect(screen.getByRole('note').querySelectorAll('li')).toHaveLength(2);
  });
});
