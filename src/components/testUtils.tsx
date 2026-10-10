import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

/**
 * Мини-замена @testing-library/react + user-event ТОЛЬКО для тестов этого каталога.
 * Почему так: @testing-library/react требует peer-пакет @testing-library/dom, а его нет в package.json
 * (при legacy-peer-deps=true он не ставится сам) — см. contract_issues отчёта.
 * Когда пакет появится, этот файл можно заменить на импорты из '@testing-library/react' и user-event.
 *
 * Что умеет: render/rerender, запросы по роли и имени, по тексту, ввод с клавиатуры (печать, Backspace, Tab,
 * Escape, стрелки), клик с фокусом, вставка. Запросы ищут по всему document.body (как screen), порталы тоже видны.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export { act };

// ---------- render ----------

interface Mounted {
  root: Root;
  container: HTMLElement;
}
const mounted: Mounted[] = [];

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.container.remove();
  }
});

export function render(ui: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry: Mounted = { root, container };
  mounted.push(entry);
  act(() => root.render(ui));
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      const i = mounted.indexOf(entry);
      if (i >= 0) mounted.splice(i, 1);
    },
  };
}

// ---------- доступные имена и роли ----------

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'HEADER', 'FOOTER', 'BR']);

function isInaccessible(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return true;
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return true;
  }
  return false;
}

function textOf(node: Node, includeHidden = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (!includeHidden && (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden'))) return '';
  if (node.getAttribute('role') === 'img' && node.getAttribute('aria-label')) return node.getAttribute('aria-label') ?? '';
  const inner = Array.from(node.childNodes).map((c) => textOf(c, includeHidden)).join('');
  return BLOCK.has(node.tagName) ? ` ${inner} ` : inner;
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'dialog':
      return 'dialog';
    case 'details':
      return 'group';
    case 'img':
      return 'img';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'number') return 'spinbutton';
      if (['text', 'search', 'email', 'url', 'tel', ''].includes(type)) return 'textbox';
      return null;
    }
    default:
      return null;
  }
}

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  return explicit || implicitRole(el);
}

const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'checkbox', 'radio', 'tab', 'option', 'menuitem', 'listitem']);

function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map((x) => textOf(x, true));
    if (parts.length) return norm(parts.join(' '));
  }
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return norm(aria);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = Array.from(el.labels ?? []).map((l) => textOf(l));
    if (labels.length) return norm(labels.join(' '));
    return norm(el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '');
  }
  if (el instanceof HTMLImageElement) return norm(el.alt);
  const role = roleOf(el);
  if (role && NAME_FROM_CONTENT.has(role)) {
    const text = norm(textOf(el));
    if (text) return text;
  }
  return norm(el.getAttribute('title') ?? '');
}

type Matcher = string | RegExp;
const matches = (text: string, m: Matcher) => (typeof m === 'string' ? norm(m) === text : m.test(text));

export interface RoleOptions {
  name?: Matcher;
  /** Искать и среди скрытых (aria-hidden, display:none). */
  hidden?: boolean;
  pressed?: boolean;
  checked?: boolean;
  level?: number;
}

function debugHint(): string {
  const html = document.body.innerHTML;
  return html.length > 1500 ? `${html.slice(0, 1500)}…` : html;
}

export const screen = {
  queryAllByRole(role: string, opts: RoleOptions = {}): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) => {
      if (roleOf(el) !== role) return false;
      if (!opts.hidden && isInaccessible(el)) return false;
      if (opts.name !== undefined && !matches(accessibleName(el), opts.name)) return false;
      if (opts.pressed !== undefined && el.getAttribute('aria-pressed') !== String(opts.pressed)) return false;
      if (opts.checked !== undefined) {
        const c = el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true';
        if (c !== opts.checked) return false;
      }
      if (opts.level !== undefined && el.tagName !== `H${opts.level}` && el.getAttribute('aria-level') !== String(opts.level)) return false;
      return true;
    });
  },
  getAllByRole(role: string, opts: RoleOptions = {}): HTMLElement[] {
    const found = screen.queryAllByRole(role, opts);
    if (found.length === 0) throw new Error(`Не найден элемент role=${role} name=${String(opts.name)}\n${debugHint()}`);
    return found;
  },
  queryByRole(role: string, opts: RoleOptions = {}): HTMLElement | null {
    const found = screen.queryAllByRole(role, opts);
    if (found.length > 1) throw new Error(`Найдено ${found.length} элементов role=${role} name=${String(opts.name)}`);
    return found[0] ?? null;
  },
  getByRole(role: string, opts: RoleOptions = {}): HTMLElement {
    const found = screen.getAllByRole(role, opts);
    if (found.length > 1) throw new Error(`Найдено ${found.length} элементов role=${role} name=${String(opts.name)}`);
    return found[0] as HTMLElement;
  },
  queryAllByText(text: Matcher): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) => {
      if (['SCRIPT', 'STYLE'].includes(el.tagName)) return false;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('');
      return own.trim() !== '' && matches(norm(own), text);
    });
  },
  getAllByText(text: Matcher): HTMLElement[] {
    const found = screen.queryAllByText(text);
    if (found.length === 0) throw new Error(`Не найден текст ${String(text)}\n${debugHint()}`);
    return found;
  },
  getByText(text: Matcher): HTMLElement {
    const found = screen.getAllByText(text);
    if (found.length > 1) throw new Error(`Найдено ${found.length} элементов с текстом ${String(text)}`);
    return found[0] as HTMLElement;
  },
  queryByText(text: Matcher): HTMLElement | null {
    const found = screen.queryAllByText(text);
    if (found.length > 1) throw new Error(`Найдено ${found.length} элементов с текстом ${String(text)}`);
    return found[0] ?? null;
  },
};

// ---------- ожидание ----------

/** Повторяет проверку, пока она не пройдёт или не выйдет время; между попытками даёт React и промисам отработать. */
export async function waitFor<T>(check: () => T, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return check();
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }
}

export const findByRole = (role: string, opts?: RoleOptions) => waitFor(() => screen.getByRole(role, opts));

// ---------- ввод пользователя ----------

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || !!el.closest('fieldset[disabled]');
}

function isTabbable(el: HTMLElement): boolean {
  if (isDisabled(el) || isInaccessible(el)) return false;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
  const ti = el.getAttribute('tabindex');
  return ti === null || Number(ti) >= 0;
}

export function fire<E extends Event>(target: EventTarget, event: E): E {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function focusEl(el: HTMLElement | null) {
  act(() => {
    if (el) el.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

function moveFocus(backwards: boolean) {
  const items = Array.from(document.body.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isTabbable);
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = backwards ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
  focusEl(items[next] ?? null);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
}

/** Заменяет выделенное (или вставляет в позицию курсора) и сообщает React событием input. */
function editText(el: HTMLInputElement | HTMLTextAreaElement, insert: string, deleteBack = false) {
  const value = el.value;
  let start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  if (deleteBack && start === end) start = Math.max(0, start - 1);
  const next = value.slice(0, start) + insert + value.slice(end);
  setNativeValue(el, next);
  const pos = start + insert.length;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* у некоторых типов полей выделения нет */
  }
  fire(el, new InputEvent('input', { bubbles: true, data: insert, inputType: deleteBack ? 'deleteContentBackward' : 'insertText' }));
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'number', 'password', ''].includes(el.type);
}

function pressKey(key: string, shift: boolean) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const down = fire(target, new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }));
  if (!down.defaultPrevented) {
    const now = document.activeElement as HTMLElement | null;
    if (key === 'Tab') moveFocus(shift);
    else if (isTextField(now)) {
      if (key === 'Backspace') editText(now, '', true);
      else if (key.length === 1) editText(now, key);
    } else if (now && (key === 'Enter' || key === ' ') && now.tagName === 'BUTTON' && !isDisabled(now)) {
      fire(now, new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }
  fire(target, new KeyboardEvent('keyup', { key, shiftKey: shift, bubbles: true, cancelable: true }));
}

async function click(el: Element) {
  if (isDisabled(el)) return;
  const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const down = fire(el, new MouseEvent('mousedown', init));
  if (!down.defaultPrevented) focusEl(isTabbableOrFocusable(el));
  fire(el, new MouseEvent('mouseup', init));
  fire(el, new MouseEvent('click', init));
}

function isTabbableOrFocusable(el: Element): HTMLElement | null {
  const target = el.closest<HTMLElement>(FOCUSABLE);
  return target && !isDisabled(target) ? target : null;
}

/**
 * Клавиатура: обычные символы печатаются, особые клавиши — в фигурных скобках:
 * '{Escape}', '{Tab}', '{Backspace}', '{Enter}', '{ArrowLeft}', '{Shift>}{Tab}{/Shift}' (Shift зажат/отпущен).
 */
async function keyboard(spec: string) {
  let shift = false;
  const re = /\{([^}]+)\}|([\s\S])/g;
  for (const m of spec.matchAll(re)) {
    const special = m[1];
    if (special) {
      if (special === 'Shift>') shift = true;
      else if (special === '/Shift') shift = false;
      else pressKey(special, shift);
    } else if (m[2]) {
      pressKey(m[2], shift);
    }
  }
}

export const user = {
  click,
  /** Клик по полю и печать. */
  async type(el: Element, text: string) {
    await click(el);
    await keyboard(text);
  },
  keyboard,
  async clear(el: Element) {
    focusEl(el as HTMLElement);
    if (isTextField(el)) {
      el.setSelectionRange?.(0, el.value.length);
      editText(el, '', true);
    }
  },
  /** Вставка текста в активное поле. */
  async paste(text: string) {
    const el = document.activeElement;
    if (isTextField(el)) editText(el, text);
  },
};
