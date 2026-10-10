import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Sheet } from './Sheet';
import { ToastProvider, useToast } from './Toast';
import { act, fire, render, screen, user } from './testUtils';

function Stack({ a, b }: { a: boolean; b: boolean }) {
  return (
    <>
      <Sheet open={a} onClose={() => {}} title="A">
        <Button>внутри A</Button>
      </Sheet>
      <ConfirmDialog open={b} title="B" onConfirm={() => {}} onCancel={() => {}} />
    </>
  );
}

describe('ПРОВЕРКА: блокировка прокрутки при наложении окон (ожидаются зелёными)', () => {
  it('overflow и paddingRight возвращаются при любом порядке закрытия, в том числе повторном открытии 50 раз', () => {
    document.body.style.overflow = 'scroll';
    document.body.style.paddingRight = '3px';
    const { rerender } = render(<Stack a={false} b={false} />);
    for (let i = 0; i < 50; i++) {
      rerender(<Stack a b={false} />);
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<Stack a b />);
      rerender(<Stack a={false} b />); // нижнее закрылось раньше верхнего
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<Stack a={false} b={false} />);
      expect(document.body.style.overflow).toBe('scroll');
      expect(document.body.style.paddingRight).toBe('3px');
    }
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });

  it('размонтирование всего дерева с открытым окном снимает блокировку и возвращает фокус на кнопку-открывашку', () => {
    function Host() {
      const [o, setO] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setO(true)}>
            Открыть
          </button>
          <Sheet open={o} onClose={() => setO(false)} title="X" />
        </>
      );
    }
    const { unmount } = render(<Host />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    act(() => opener.focus());
    fire(opener, new MouseEvent('click', { bubbles: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Esc закрывает только верхнее окно', async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(
      <>
        <Sheet open onClose={closeA} title="A" />
        <ConfirmDialog open title="B" onConfirm={() => {}} onCancel={closeB} />
      </>,
    );
    await user.keyboard('{Escape}');
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });
});

describe('ПРОВЕРКА: Toast', () => {
  function Emit({ n }: { n: number }) {
    const t = useToast();
    return (
      <button type="button" onClick={() => Array.from({ length: n }, (_, i) => t.show(`m${i}`, { durationMs: 10 }))}>
        go
      </button>
    );
  }
  it('шквал уведомлений: на экране не больше 3, таймеры выбывших не ломают остальные', async () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Emit n={10} />
        </ToastProvider>,
      );
      fire(screen.getByRole('button', { name: 'go' }), new MouseEvent('click', { bubbles: true }));
      expect(document.querySelectorAll('[role="status"]').length).toBeLessThanOrEqual(3);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(document.querySelectorAll('[role="status"]').length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
