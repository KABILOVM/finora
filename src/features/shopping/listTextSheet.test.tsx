import { describe, expect, it, vi } from 'vitest';
import type { ParsedItem } from '@/domain/shoppingAi';
import { render, screen, user, waitFor } from '@/components/testUtils';
import { ListTextSheet } from './ListTextSheet';

const MILK: ParsedItem = { name: 'Молоко', qtyMilli: 2000, unit: 'l' };
const BREAD: ParsedItem = { name: 'Хлеб', qtyMilli: 3000, unit: 'pcs' };
const FLOUR: ParsedItem = { name: 'Мука', qtyMilli: 1000, unit: 'pcs' };

function setup(parse: (t: string, k: readonly string[]) => Promise<ParsedItem[]>, onAdd = vi.fn(async () => {})) {
  const onClose = vi.fn();
  render(<ListTextSheet known={['Хлеб']} parse={parse} onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose };
}
const field = () => screen.getByRole('textbox', { name: 'Что купить' });
const btn = (name: string | RegExp) => screen.getByRole('button', { name });

describe('«Добавить списком» с ИИ', () => {
  it('пока текста нет, «Разобрать» недоступна; обычного разбора по буквам больше нет', async () => {
    const parse = vi.fn(async () => [MILK]);
    setup(parse);
    expect((btn('Разобрать') as HTMLButtonElement).disabled).toBe(true);
    await user.type(field(), 'молоко два литра');
    expect(parse).not.toHaveBeenCalled();
    expect(screen.queryByText('Будет добавлено · проверьте')).toBeNull();
  });

  it('разобрать → показать → добавить; известные названия уходят на разбор', async () => {
    const parse = vi.fn(async () => [MILK, BREAD]);
    const { onAdd, onClose } = setup(parse);
    await user.type(field(), 'молоко два литра хлеб три штуки');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByText('Будет добавлено · проверьте')).toBeTruthy());
    expect(parse).toHaveBeenCalledWith('молоко два литра хлеб три штуки', ['Хлеб']);
    expect(screen.getByText('Молоко')).toBeTruthy();
    expect(screen.getByText('2 л')).toBeTruthy();
    expect(screen.getByText('× 3')).toBeTruthy();
    await user.click(btn('Добавить 2 позиции'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith([MILK, BREAD]);
  });

  it('лишнюю позицию можно убрать до добавления', async () => {
    const { onAdd } = setup(async () => [MILK, BREAD, FLOUR]);
    await user.type(field(), 'что-то');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 3 позиции'));
    await user.click(btn('Убрать: Хлеб'));
    await user.click(btn('Добавить 2 позиции'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([MILK, FLOUR]));
  });

  it('правка текста сбрасывает результат: добавить старое нельзя, нужно разобрать заново', async () => {
    setup(async () => [MILK]);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 1 позицию'));
    await user.type(field(), ' и сыр');
    expect(screen.queryByRole('button', { name: /^Добавить \d/ })).toBeNull();
    expect(btn('Разобрать')).toBeTruthy();
  });

  it('ошибка разбора показывается, текст остаётся, можно повторить', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const parse = vi.fn().mockRejectedValueOnce(new Error('Нет связи с сервером.')).mockResolvedValueOnce([MILK]);
    setup(parse);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет связи'));
    expect((field() as HTMLTextAreaElement).value).toBe('молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 1 позицию'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ИИ не нашёл товаров — подсказка, добавить нечего', async () => {
    setup(async () => []);
    await user.type(field(), 'привет');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Не нашёл товаров'));
    expect(screen.queryByRole('button', { name: /^Добавить \d/ })).toBeNull();
  });

  it('двойной тап по «Разобрать» шлёт один запрос', async () => {
    let release: (v: ParsedItem[]) => void = () => {};
    const parse = vi.fn(() => new Promise<ParsedItem[]>((r) => (release = r)));
    setup(parse);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await user.click(screen.getByRole('button', { name: 'Разбираю…' }));
    expect(parse).toHaveBeenCalledTimes(1);
    release([MILK]);
    await waitFor(() => btn('Добавить 1 позицию'));
  });

  it('ошибка добавления остаётся в окне', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAdd = vi.fn().mockRejectedValue(new Error('Не вышло сохранить'));
    const { onClose } = setup(async () => [MILK], onAdd);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await user.click(await waitFor(() => btn('Добавить 1 позицию')));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Не вышло сохранить'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
