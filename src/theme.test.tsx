import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle';
import { render, screen, user } from '@/components/testUtils';
import { ACCENTS, applyAccent, applyTheme, readAccentPref, readThemePref, resolveTheme, saveAccentPref, saveThemePref, useAccentPref, type AccentId } from './theme';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
  reset();
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

const accent = (id: AccentId) => {
  const found = ACCENTS.find((a) => a.id === id);
  if (!found) throw new Error(`нет акцента ${id}`);
  return found;
};
const statusBar = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));
const addBarMetas = () => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#eceefb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#080a18" media="(prefers-color-scheme: dark)">';
};

describe('цвет акцента', () => {
  it('по умолчанию фиолетовый, даже если ничего не сохранено или значение испорчено', () => {
    expect(readAccentPref()).toBe('violet');
    localStorage.setItem('finora-accent', 'бирюза');
    expect(readAccentPref()).toBe('violet');
    localStorage.setItem('finora-accent', 'toString'); // имя из прототипа объекта — не акцент
    expect(readAccentPref()).toBe('violet');
  });

  it('выбор сохраняется на устройстве и ставит атрибут на <html>; фиолетовый атрибут убирает (прежняя палитра)', () => {
    saveAccentPref('blue');
    expect(readAccentPref()).toBe('blue');
    expect(localStorage.getItem('finora-accent')).toBe('blue');
    expect(document.documentElement.getAttribute('data-accent')).toBe('blue');
    saveAccentPref('violet');
    expect(readAccentPref()).toBe('violet');
    expect(localStorage.getItem('finora-accent')).toBe('violet');
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  it('при запуске применяется сохранённый акцент, как и сохранённая тема', () => {
    localStorage.setItem('finora-accent', 'green');
    localStorage.setItem('finora-theme', 'dark');
    applyTheme(readThemePref());
    applyAccent(readAccentPref());
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('акцент и тема независимы: смена одного не трогает другое', () => {
    saveThemePref('dark');
    saveAccentPref('pink');
    saveThemePref('light');
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink');
    expect(readAccentPref()).toBe('pink');
    saveAccentPref('teal');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(readThemePref()).toBe('light');
  });

  it('цвет строки состояния браузера следует и теме, и акценту — в любом порядке вызовов', () => {
    addBarMetas();
    const green = accent('green').bar;
    applyAccent('green');
    applyTheme('dark');
    expect(statusBar()).toEqual([green.dark, green.dark]);
    applyTheme('light');
    expect(statusBar()).toEqual([green.light, green.light]);
    applyTheme('system'); // явного выбора нет: каждая метка — для своей системной темы
    expect(statusBar()).toEqual([green.light, green.dark]);
    const orange = accent('orange').bar;
    applyAccent('orange'); // акцент сменился при теме «как в системе»
    expect(statusBar()).toEqual([orange.light, orange.dark]);
    applyAccent('violet');
    expect(statusBar()).toEqual(['#eceefb', '#080a18']);
  });

  it('не сохранилось в хранилище (закрытый режим, переполнение) — акцент всё равно применяется', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('нет места', 'QuotaExceededError');
    });
    expect(() => saveAccentPref('teal')).not.toThrow();
    expect(document.documentElement.getAttribute('data-accent')).toBe('teal');
  });

  it('хранилище недоступно при чтении — берётся фиолетовый, ошибки наружу не идут', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('доступ закрыт', 'SecurityError');
    });
    expect(readAccentPref()).toBe('violet');
  });

  it('useAccentPref: компонент сразу показывает новый выбор и ставит атрибут', async () => {
    function Probe() {
      const [id, setId] = useAccentPref();
      return (
        <button type="button" onClick={() => setId('teal')}>
          {id}
        </button>
      );
    }
    render(<Probe />);
    expect(screen.getByRole('button', { name: 'violet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'violet' }));
    expect(screen.getByRole('button', { name: 'teal' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-accent')).toBe('teal');
  });
});
