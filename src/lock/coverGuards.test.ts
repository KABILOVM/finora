import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { blockUserHistoryTraversal, coverFocusables, installCoverGuards, nextFocusTarget } from './coverGuards';

function button(label: string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
}

describe('nextFocusTarget: Tab по кругу внутри заслонки', () => {
  const a = button('a');
  const b = button('b');
  const c = button('c');
  const items = [a, b, c];

  it('вперёд по порядку, с последней — на первую', () => {
    expect(nextFocusTarget(items, a, false)).toBe(b);
    expect(nextFocusTarget(items, b, false)).toBe(c);
    expect(nextFocusTarget(items, c, false)).toBe(a);
  });

  it('назад по порядку, с первой — на последнюю', () => {
    expect(nextFocusTarget(items, c, true)).toBe(b);
    expect(nextFocusTarget(items, b, true)).toBe(a);
    expect(nextFocusTarget(items, a, true)).toBe(c);
  });

  it('фокус не на кнопках заслонки (на странице, потерян, на самой заслонке): вперёд — первая, назад — последняя', () => {
    const outside = button('снаружи');
    expect(nextFocusTarget(items, null, false)).toBe(a);
    expect(nextFocusTarget(items, null, true)).toBe(c);
    expect(nextFocusTarget(items, outside, false)).toBe(a);
    expect(nextFocusTarget(items, document.body, true)).toBe(c);
  });

  it('одна кнопка — остаётся на ней; пусто — null', () => {
    expect(nextFocusTarget([a], a, false)).toBe(a);
    expect(nextFocusTarget([a], a, true)).toBe(a);
    expect(nextFocusTarget([], a, false)).toBeNull();
  });
});

describe('coverFocusables', () => {
  it('берёт доступные кнопки и ссылки, пропускает отключённые, скрытые и tabindex=-1', () => {
    const root = document.createElement('div');
    const link = document.createElement('a');
    link.href = '#x';
    root.append(button('ok'), button('off', { disabled: '' }), button('скрыта', { hidden: '' }), button('не табом', { tabindex: '-1' }), link);
    expect(coverFocusables(root).map((el) => el.textContent || el.tagName)).toEqual(['ok', 'A']);
  });
});

describe('blockUserHistoryTraversal: «назад» от человека не меняет окно под заслонкой', () => {
  type Listener = (e: Event) => void;
  let listeners: Set<Listener>;

  beforeEach(() => {
    listeners = new Set();
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: {
        addEventListener: (_t: string, l: Listener) => listeners.add(l),
        removeEventListener: (_t: string, l: Listener) => listeners.delete(l),
      },
    });
  });
  afterEach(() => {
    delete (window as unknown as { navigation?: unknown }).navigation;
  });

  /** Событие navigate такого вида, как его отдаёт Chromium; возвращает, отменили ли его. */
  function navigate(fields: { navigationType?: string; userInitiated?: boolean; cancelable?: boolean; sameDocument?: boolean }): boolean {
    const e = new Event('navigate', { cancelable: fields.cancelable ?? true });
    Object.assign(e, {
      navigationType: fields.navigationType ?? 'traverse',
      userInitiated: fields.userInitiated ?? true,
      destination: { sameDocument: fields.sameDocument ?? true },
    });
    for (const l of [...listeners]) l(e);
    return e.defaultPrevented;
  }

  it('жест «назад»/«вперёд» (traverse от человека в этом же документе) отменяется, пока защита включена; после снятия — нет', () => {
    const off = blockUserHistoryTraversal();
    expect(listeners.size).toBe(1);
    expect(navigate({})).toBe(true);
    off();
    expect(listeners.size).toBe(0);
    expect(navigate({})).toBe(false);
  });

  it('переходы самого приложения (history.go из кода, userInitiated=false) и ссылки/перезагрузка не трогаем', () => {
    const off = blockUserHistoryTraversal();
    expect(navigate({ userInitiated: false })).toBe(false); // закрытие окна после сохранения идёт так
    expect(navigate({ navigationType: 'push' })).toBe(false);
    expect(navigate({ navigationType: 'replace' })).toBe(false);
    expect(navigate({ navigationType: 'reload' })).toBe(false);
    off();
  });

  it('уход на другой документ (назад на другой сайт) не держим; то, что браузер не разрешает отменить, не отменяем', () => {
    const off = blockUserHistoryTraversal();
    expect(navigate({ sameDocument: false })).toBe(false);
    expect(navigate({ cancelable: false })).toBe(false);
    off();
  });

  it('браузер без Navigation API: ничего не ломается', () => {
    delete (window as unknown as { navigation?: unknown }).navigation;
    const off = blockUserHistoryTraversal();
    expect(() => off()).not.toThrow();
  });
});

describe('installCoverGuards: клавиатура и фокус', () => {
  let root: HTMLElement;
  let open: HTMLButtonElement;
  let leave: HTMLButtonElement;
  let app: HTMLButtonElement;
  let underlay: Mock<(key: string) => void>;
  let onEscape: Mock<() => void>;
  let focusPrimary: Mock<() => void>;
  let release: () => void;
  let underlayListener: (e: KeyboardEvent) => void;

  beforeEach(() => {
    app = button('приложение');
    root = document.createElement('div');
    root.tabIndex = -1;
    open = button('Открыть');
    leave = button('Не получается?');
    root.append(open, leave);
    document.body.append(app, root);
    underlay = vi.fn<(key: string) => void>();
    onEscape = vi.fn<() => void>();
    focusPrimary = vi.fn<() => void>(() => open.focus());
    // окно под заслонкой слушает весь document в фазе перехвата, как общий обработчик окон
    underlayListener = (e) => underlay(e.key);
    document.addEventListener('keydown', underlayListener, true);
    release = installCoverGuards(root, { onEscape, focusPrimary });
    open.focus();
  });
  afterEach(() => {
    release();
    document.removeEventListener('keydown', underlayListener, true);
    document.body.replaceChildren();
  });

  function press(key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? document.body): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  }

  it('Esc: окно под заслонкой его не получает, заслонка получает и гасит действие по умолчанию', () => {
    const e = press('Escape');
    expect(underlay).not.toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Esc с фокусом «ни на чём» (body) — то же самое', () => {
    (document.activeElement as HTMLElement).blur();
    press('Escape', {}, document.body);
    expect(underlay).not.toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('Tab и Shift+Tab: окно под заслонкой их не получает, фокус ходит по кругу между кнопками заслонки', () => {
    expect(document.activeElement).toBe(open);
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(leave);
    press('Tab');
    expect(document.activeElement).toBe(open);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(leave);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(open);
    expect(underlay).not.toHaveBeenCalled();
  });

  it('Tab, когда фокус потерян (body), возвращает его на кнопки заслонки: вперёд — на первую, назад — на последнюю', () => {
    leave.focus();
    (document.activeElement as HTMLElement).blur();
    press('Tab', {}, document.body);
    expect(document.activeElement).toBe(open);
    (document.activeElement as HTMLElement).blur();
    press('Tab', { shiftKey: true }, document.body);
    expect(document.activeElement).toBe(leave);
  });

  it('Ctrl+Tab и Alt+Tab (переключение вкладок и окон) не перехватываем, но окну под заслонкой тоже не отдаём', () => {
    const e = press('Tab', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(open);
    expect(underlay).not.toHaveBeenCalled();
  });

  it('остальные клавиши идут как обычно (Enter на кнопке нажимает её)', () => {
    press('Enter');
    press('a');
    expect(underlay).toHaveBeenCalledWith('Enter');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('фокус, ушедший на окно под заслонкой, возвращается', () => {
    app.focus();
    expect(focusPrimary).toHaveBeenCalled();
    expect(document.activeElement).toBe(open);
  });

  it('фокус внутри заслонки возврата не требует', () => {
    leave.focus();
    expect(focusPrimary).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(leave);
  });

  it('фокус потерян «ни на чём» (окно под заслонкой стало недоступным вместе с фокусом): заслонка забирает его обратно', async () => {
    vi.useFakeTimers();
    try {
      leave.focus();
      focusPrimary.mockClear();
      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);
      await vi.runAllTimersAsync();
      expect(focusPrimary).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('после снятия защиты клавиатура снова идёт окнам', () => {
    release();
    press('Escape');
    expect(underlay).toHaveBeenCalledWith('Escape');
    expect(onEscape).not.toHaveBeenCalled();
    release = installCoverGuards(root, { onEscape, focusPrimary }); // для afterEach
  });
});
