import { act, createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

/**
 * Минимальные renderHook / mount / waitFor на React act.
 * Почему не @testing-library/react: ему нужен peer-пакет @testing-library/dom, а в package.json его нет
 * (см. contract_issues отчёта). После добавления пакета этот файл можно заменить импортом из '@testing-library/react'.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  while (roots.length) {
    const r = roots.pop();
    act(() => r?.unmount());
  }
});

export { act };

export function mount(element: ReactElement): { container: HTMLElement; unmount: () => void; render: (next: ReactElement) => void } {
  const container = document.createElement('div');
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return {
    container,
    render: (next) => act(() => root.render(next)),
    unmount() {
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}

export function renderHook<R>(hook: () => R, options: { wrapper?: ComponentType<{ children?: ReactNode }> } = {}) {
  const result = { current: undefined as R };
  function Probe() {
    result.current = hook();
    return null;
  }
  const make = () => (options.wrapper ? createElement(options.wrapper, null, createElement(Probe)) : createElement(Probe));
  const { unmount, render } = mount(make());
  return { result, unmount, rerender: () => render(make()) };
}

/** Повторяет проверку, пока она не пройдёт или не выйдет время; между попытками даёт React обработать события. */
export async function waitFor(assertion: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }
}
