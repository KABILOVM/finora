import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fire, render, screen, user } from './testUtils';
import { IconSelect } from './IconSelect';

const OPTIONS = [
  { value: 'a', label: 'Наличные', icon: '👛' },
  { value: 'b', label: 'Алиф', icon: '💳' },
];

function Demo({ start = 'a', footer = false }: { start?: string | null; footer?: boolean }) {
  const [v, setV] = useState<string | null>(start);
  return (
    <>
      <IconSelect
        label="Счёт"
        options={OPTIONS}
        value={v}
        onChange={setV}
        footer={footer ? (close) => <button onClick={close}>Закрыть список</button> : undefined}
      />
      <span data-testid="v">{v}</span>
      <button>Снаружи</button>
    </>
  );
}
const value = () => document.querySelector('[data-testid="v"]')?.textContent;

describe('IconSelect', () => {
  it('кнопка показывает выбранное; список открывается, выбор закрывает его и меняет значение', async () => {
    render(<Demo />);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Счёт: Наличные' }));
    expect(screen.getByRole('listbox', { name: 'Счёт' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Наличные/ }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('option', { name: /Алиф/ }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(value()).toBe('b');
    expect(screen.getByRole('button', { name: 'Счёт: Алиф' })).toBeTruthy();
  });

  it('тап мимо и Esc закрывают список', async () => {
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Счёт: Наличные' }));
    fire(screen.getByRole('button', { name: 'Снаружи' }), new Event('pointerdown', { bubbles: true }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Счёт: Наличные' }));
    fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ничего не выбрано — подсказка; нижняя часть списка получает функцию закрытия', async () => {
    render(<Demo start={null} footer />);
    await user.click(screen.getByRole('button', { name: 'Счёт: Выбрать' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть список' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
