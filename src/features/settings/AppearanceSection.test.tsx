import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { AppearanceSection } from './AppearanceSection';

const reset = () => {
  localStorage.clear();
  for (const a of ['data-theme', 'data-accent', 'data-skin', 'data-look', 'data-fx', 'style']) document.documentElement.removeAttribute(a);
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const open = () =>
  render(
    <MemoryRouter>
      <AppearanceSection />
    </MemoryRouter>,
  );
const note = () => document.querySelector('[data-testid="skin-colors-note"]');
const current = () => document.querySelector('[data-testid="skin-current"]') as HTMLAnchorElement;

describe('«Оформление»: образ и цвет акцента', () => {
  it('по умолчанию «Классика»: строка образа ведёт на витрину, цвет акцента виден, пояснения про образ нет', () => {
    open();
    expect(current().getAttribute('href')).toBe('/settings/skins');
    expect(screen.getByRole('link', { name: 'Образ: Классика. Выбрать другой' })).toBe(current());
    expect(screen.getByText('Цвет акцента')).toBeInTheDocument();
    expect(note()).toBeNull();
  });

  it('«Классика (прежняя)» тоже берёт цвет у акцента: выбор цвета на месте', () => {
    localStorage.setItem('finora-skin', 'legacy');
    open();
    expect(current().textContent).toContain('Классика (прежняя)');
    expect(screen.getByText('Цвет акцента')).toBeInTheDocument();
    expect(note()).toBeNull();
  });

  it('у образа со своей палитрой выбор цвета спрятан, и объяснено почему; выбранный раньше акцент не теряется', () => {
    localStorage.setItem('finora-accent', 'teal');
    localStorage.setItem('finora-skin', 'real');
    open();
    expect(current().textContent).toContain('Реал Мадрид');
    expect(screen.queryByText('Цвет акцента')).toBeNull();
    expect(note()?.textContent).toContain('Цвета задаёт образ «Реал Мадрид»');
    expect(localStorage.getItem('finora-accent')).toBe('teal');
  });

  it('свой образ: в строке его название, а если его больше нет в хранилище — «Свой образ»', () => {
    localStorage.setItem('finora-skin', 'custom');
    open();
    expect(current().textContent).toContain('Свой образ');
    expect(screen.queryByText('Цвет акцента')).toBeNull();
  });

  it('«Живой фон и эффекты»: включены по умолчанию; выключение ставит data-fx="off" и запоминается на устройстве', async () => {
    open();
    const fx = screen.getByRole('switch', { name: 'Живой фон и эффекты' });
    expect(fx.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.hasAttribute('data-fx')).toBe(false);
    await user.click(fx);
    expect(fx.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.getAttribute('data-fx')).toBe('off');
    expect(localStorage.getItem('finora-fx')).toBe('off');
    await user.click(fx);
    expect(document.documentElement.hasAttribute('data-fx')).toBe(false);
    expect(localStorage.getItem('finora-fx')).toBeNull();
  });
});
