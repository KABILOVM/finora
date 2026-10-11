import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle';
import { render, screen, user } from '@/components/testUtils';
import { applyTheme, readThemePref, resolveTheme, saveThemePref } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('тема оформления', () => {
  it('по умолчанию светлая, даже если ничего не сохранено или значение испорчено', () => {
    expect(readThemePref()).toBe('light');
    localStorage.setItem('finora-theme', 'розовая');
    expect(readThemePref()).toBe('light');
  });

  it('выбор сохраняется и ставит атрибут на <html>; «как в системе» атрибут убирает', () => {
    saveThemePref('dark');
    expect(readThemePref()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    saveThemePref('system');
    expect(readThemePref()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    saveThemePref('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('цвет строки состояния браузера следует выбору темы', () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#eceefb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#080a18" media="(prefers-color-scheme: dark)">';
    applyTheme('dark');
    const colors = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));
    expect(colors).toEqual(['#080a18', '#080a18']);
    applyTheme('system');
    const system = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));
    expect(system).toEqual(['#eceefb', '#080a18']);
    document.head.innerHTML = '';
  });

  it('resolveTheme: явный выбор возвращается как есть', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('кнопка в шапке переключает светлую и тёмную темы туда и обратно', async () => {
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Включить светлую тему' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
