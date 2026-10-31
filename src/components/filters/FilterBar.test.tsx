import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fire, render, screen, user, waitFor } from '@/components/testUtils';
import { ActiveFilters, FilterBar, FiltersButton } from './FilterBar';
import { emptyFilters, type FilterField, type FilterValues } from './filterState';

const fields: FilterField[] = [
  { key: 'kind', label: 'Вид', type: 'chips', anyLabel: 'Все виды', options: [{ value: 'a', label: 'Альфа' }, { value: 'b', label: 'Бета' }] },
  { key: 'cat', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: [{ value: 'x', label: 'Икс' }, { value: 'y', label: 'Игрек' }] },
];

function Harness({ onChange }: { onChange?: (v: FilterValues) => void }) {
  const [values, setValues] = useState<FilterValues>(emptyFilters(fields));
  return (
    <FilterBar
      fields={fields}
      values={values}
      onChange={(v) => {
        setValues(v);
        onChange?.(v);
      }}
    />
  );
}

function pick(selectName: string, optionText: string) {
  const select = screen.getByRole('combobox', { name: selectName }) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent === optionText);
  if (!option) throw new Error(`Нет пункта «${optionText}»`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, option.value);
  act(() => void fire(select, new Event('change', { bubbles: true })));
}

describe('FiltersButton', () => {
  it('без включённых — «Фильтры»; с включёнными — число в имени и значке', () => {
    const { unmount } = render(<FiltersButton count={0} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Фильтры' })).toBeTruthy();
    unmount();
    render(<FiltersButton count={2} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Фильтры, включено: 2' })).toBeTruthy();
  });

  it('высота не меньше 44px по классу', () => {
    render(<FiltersButton count={0} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Фильтры' }).className).toContain('min-h-[44px]');
  });
});

describe('ActiveFilters', () => {
  it('нет названий — ничего не рисует; есть — строка и «Сбросить»', async () => {
    const reset = vi.fn();
    const { unmount } = render(<ActiveFilters labels={[]} onReset={reset} />);
    expect(document.querySelector('[data-testid="active-filters"]')).toBeNull();
    unmount();
    render(<ActiveFilters labels={['Альфа', 'Икс']} onReset={reset} />);
    expect(document.querySelector('[data-testid="active-filters"]')?.textContent).toContain('Альфа · Икс');
    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('FilterBar', () => {
  it('шит: выбор копится и попадает наружу только по «Применить»; закрытие без него ничего не меняет', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    await user.click(screen.getByRole('button', { name: 'Бета' }));
    pick('Категория', 'Игрек');
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    await user.click(screen.getByRole('button', { name: 'Бета' }));
    pick('Категория', 'Игрек');
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'b', cat: 'y' }));
    expect(screen.getByRole('button', { name: 'Фильтры, включено: 2' })).toBeTruthy();
    expect(document.querySelector('[data-testid="active-filters"]')?.textContent).toContain('Бета · Игрек');
  });

  it('«Сбросить» в шите неактивна, пока нечего сбрасывать; в строке под кнопкой возвращает всё', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Альфа' }));
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ kind: 'a', cat: '' }));

    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ kind: '', cat: '' }));
    expect(document.querySelector('[data-testid="active-filters"]')).toBeNull();
  });
});
