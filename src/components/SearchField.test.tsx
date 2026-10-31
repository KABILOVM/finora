import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, user } from './testUtils';
import { SearchField, SEARCH_MAX_LENGTH } from './SearchField';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SearchField label="Поиск по чему-то" placeholder="Найти" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}
const field = () => screen.getByRole('textbox', { name: 'Поиск по чему-то' }) as HTMLInputElement;
const shown = () => document.querySelector('[data-testid="value"]')?.textContent;

describe('SearchField', () => {
  it('у поля есть имя и подсказка; набранное доходит до onChange', async () => {
    render(<Harness />);
    expect(field()).toHaveAttribute('placeholder', 'Найти');
    await user.type(field(), 'молоко');
    expect(shown()).toBe('молоко');
  });

  it('кнопка «Очистить поиск» есть, только пока что-то набрано; очищает и оставляет поле', async () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).toBeNull();
    await user.type(field(), 'а');
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(shown()).toBe('');
    expect(field().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).toBeNull();
  });

  it('поле начинается с готового значения', () => {
    render(<Harness initial="чай" />);
    expect(field().value).toBe('чай');
    expect(screen.getByRole('button', { name: 'Очистить поиск' })).toBeInTheDocument();
  });

  it('длина ограничена', () => {
    render(<Harness />);
    expect(field()).toHaveAttribute('maxlength', String(SEARCH_MAX_LENGTH));
  });
});
