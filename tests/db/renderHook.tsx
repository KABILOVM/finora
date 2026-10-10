import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

/**
 * Минимальные renderHook/waitFor на React act.
 * Почему не @testing-library/react: ему нужен peer-пакет @testing-library/dom, а его нет в package.json
 * (при legacy-peer-deps=true он не ставится сам) — см. contract_issues отчёта. Интерфейс совместим:
 * после установки пакета достаточно заменить импорт на '@testing-library/react'.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  while (roots.length) {
    const r = roots.pop();
    act(() => r?.unmount());
  }
});

export interface RenderHookOptions<P> {
  wrapper?: ComponentType<{ children: ReactNode }>;
  initialProps?: P;
}

export function renderHook<R, P = undefined>(hook: (props: P) => R, options: RenderHookOptions<P> = {}) {
  const result = { current: undefined as R };
  let props = options.initialProps as P;
  const root = createRoot(document.createElement('div'));
  roots.push(root);

  function Probe({ p }: { p: P }) {
    result.current = hook(p);
    return null;
  }
  const render = () => {
    const probe = createElement(Probe, { p: props });
    root.render(options.wrapper ? createElement(options.wrapper, null, probe) : probe);
  };
  act(render);

  return {
    result,
    rerender(next?: P) {
      if (next !== undefined) props = next;
      act(render);
    },
    unmount() {
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}

/** Повторяет проверку, пока она не пройдёт или не выйдет время; между попытками даёт React и Dexie обработать события. */
export async function waitFor(assertion: () => void, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
  }
}
