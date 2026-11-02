import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAutoFocusText, isCoarsePointer, opensKeyboard } from './pointer';

const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));

afterEach(() => vi.unstubAllGlobals());

describe('указатель: палец или мышь', () => {
  it('без matchMedia (старые среды, тесты) считается, что это компьютер', () => {
    expect(isCoarsePointer()).toBe(false);
    expect(canAutoFocusText()).toBe(true);
  });

  it('палец — курсор в поле сам не ставится; мышь — ставится', () => {
    stubPointer(true);
    expect(isCoarsePointer()).toBe(true);
    expect(canAutoFocusText()).toBe(false);
    stubPointer(false);
    expect(canAutoFocusText()).toBe(true);
  });
});

describe('opensKeyboard: откроет ли фокус экранную клавиатуру', () => {
  const el = (html: string): Element => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.firstElementChild!;
  };

  it('текстовые поля — да', () => {
    for (const html of ['<input>', '<input type="text">', '<input type="search">', '<input type="email">', '<input type="tel">', '<input type="number">', '<input type="password">', '<textarea></textarea>']) {
      expect(opensKeyboard(el(html)), html).toBe(true);
    }
  });

  it('кнопки, флажки, выбор даты, список, ссылка — нет', () => {
    for (const html of ['<button>ок</button>', '<input type="checkbox">', '<input type="radio">', '<input type="date">', '<input type="range">', '<select></select>', '<a href="#x">х</a>', '<div tabindex="-1"></div>']) {
      expect(opensKeyboard(el(html)), html).toBe(false);
    }
  });

  it('поле «только чтение» и поле со своей клавиатурой (inputmode="none", сумма) — нет', () => {
    expect(opensKeyboard(el('<input readonly>'))).toBe(false);
    expect(opensKeyboard(el('<textarea readonly></textarea>'))).toBe(false);
    expect(opensKeyboard(el('<input inputmode="none">'))).toBe(false);
  });

  it('inputmode="decimal" клавиатуру открывает, null — нет', () => {
    expect(opensKeyboard(el('<input inputmode="decimal">'))).toBe(true);
    expect(opensKeyboard(null)).toBe(false);
  });
});
