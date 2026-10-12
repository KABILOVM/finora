import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, user } from '@/components/testUtils';
import { ACCENTS, type AccentId } from '@/theme';
import { AccentPicker } from './AccentPicker';
import { AppearanceSection } from './AppearanceSection';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
};
beforeEach(reset);
afterEach(reset);

const radios = () => screen.getAllByRole('radio', { name: new RegExp(`^(${ACCENTS.map((a) => a.label).join('|')})$`) });
const checkedName = () => screen.getAllByRole('radio', { checked: true }).map((r) => r.textContent?.trim());

/** Управляемая обёртка: выбор хранится в состоянии, как в настройках. */
function Harness({ initial = 'violet', onChange }: { initial?: AccentId; onChange?: (id: AccentId) => void }) {
  const [id, setId] = useState<AccentId>(initial);
  return (
    <AccentPicker
      value={id}
      onChange={(next) => {
        setId(next);
        onChange?.(next);
      }}
    />
  );
}

describe('AccentPicker', () => {
  it('группа «Цвет акцента»: все акценты по порядку, отмечен выбранный', () => {
    render(<Harness initial="green" />);
    expect(screen.getByRole('radiogroup', { name: 'Цвет акцента' })).toBeInTheDocument();
    expect(radios().map((r) => r.textContent?.trim())).toEqual(ACCENTS.map((a) => a.label));
    expect(checkedName()).toEqual(['Зелёный']);
  });

  it('клик выбирает акцент и сообщает о выборе', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Синий' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('blue');
    expect(checkedName()).toEqual(['Синий']);
  });

  it('выбранный отмечен не только цветом: на образце галочка, у остальных её нет', () => {
    render(<Harness initial="orange" />);
    for (const r of radios()) {
      const hasCheck = r.querySelector('svg') !== null;
      expect(hasCheck, r.textContent ?? '').toBe(r.getAttribute('aria-checked') === 'true');
    }
  });

  it('образец каждого акцента помечен своим data-accent (стили образца берутся из index.css)', () => {
    render(<Harness />);
    const marks = radios().map((r) => r.querySelector('[data-accent]')?.getAttribute('data-accent'));
    expect(marks).toEqual(ACCENTS.map((a) => a.id));
  });

  it('в группу заходят одним Tab: доступен только выбранный', () => {
    render(<Harness initial="teal" />);
    const tabbable = radios().filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable.map((r) => r.textContent?.trim())).toEqual(['Бирюзовый']);
  });

  it('стрелки переключают по кругу и переносят фокус на выбранный', async () => {
    render(<Harness />);
    const first = screen.getByRole('radio', { name: 'Фиолетовый' });
    act(() => first.focus());
    await user.keyboard('{ArrowRight}');
    expect(checkedName()).toEqual(['Синий']);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Синий' }));
    await user.keyboard('{ArrowLeft}{ArrowLeft}'); // назад через начало списка — на последний
    expect(checkedName()).toEqual(['Розовый']);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Розовый' }));
    await user.keyboard('{ArrowDown}'); // вниз — как «дальше»: снова с начала
    expect(checkedName()).toEqual(['Фиолетовый']);
  });
});

describe('Оформление: цвет акцента', () => {
  it('выбор применяется сразу, хранится на устройстве и не мешает выбору темы', async () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Фиолетовый' })).toBeChecked();
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);

    await user.click(screen.getByRole('radio', { name: 'Розовый' }));
    expect(screen.getByRole('radio', { name: 'Розовый' })).toBeChecked();
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink');
    expect(localStorage.getItem('finora-accent')).toBe('pink');

    await user.click(screen.getByRole('radio', { name: 'Тёмная' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink'); // тема акцент не сбросила
    expect(screen.getByRole('radio', { name: 'Розовый' })).toBeChecked();
  });

  it('при открытии показывает сохранённый акцент', () => {
    localStorage.setItem('finora-accent', 'teal');
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Бирюзовый' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Фиолетовый' })).not.toBeChecked();
  });

  it('возврат к фиолетовому убирает атрибут (прежняя палитра)', async () => {
    localStorage.setItem('finora-accent', 'green');
    document.documentElement.setAttribute('data-accent', 'green');
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: 'Фиолетовый' }));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
  });
});
