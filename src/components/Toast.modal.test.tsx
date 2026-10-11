import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';
import { ToastProvider, useToast } from './Toast';
import { act, render, screen, user, waitFor } from './testUtils';

/**
 * Тост «Кошелёк добавлен» оставался внизу поверх открытого шита «Новая операция» и закрывал цифры и кнопку «Сохранить».
 * Пока открыто окно, тосты уезжают наверх (и там виден только самый новый); окно закрылось — возвращаются на место.
 * Координат в jsdom нет, поэтому проверяем признак и классы; настоящую геометрию проверяет e2e/flows/14-toast-over-sheet.
 */

afterEach(() => vi.useRealTimers());

const container = (): HTMLElement => {
  const status = document.querySelector('[role="status"], [role="alert"]');
  const box = status?.parentElement;
  if (!box) throw new Error('Тостов нет');
  return box;
};

function Harness() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => toast.success('Кошелёк добавлен')}>тост</button>
      <button onClick={() => toast.success('Сохранено', { durationMs: 0 })}>второй</button>
      <button onClick={() => toast.error('Не удалось', { durationMs: 0 })}>ошибка</button>
      <button onClick={() => setOpen(true)}>открыть</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Новая операция">
        <input aria-label="Сумма" />
      </Sheet>
    </>
  );
}

const mount = () =>
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );

describe('тосты и открытое окно', () => {
  it('окна нет: тост внизу, как раньше', async () => {
    mount();
    await user.click(screen.getByRole('button', { name: 'тост' }));
    expect(container().getAttribute('data-over-modal')).toBeNull();
    expect(container().className).toContain('bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]');
    expect(container().className).not.toContain('top-[');
  });

  it('тост был до открытия окна: окно открылось — тост переехал наверх и не закрывает низ окна', async () => {
    mount();
    await user.click(screen.getByRole('button', { name: 'тост' }));
    await user.click(screen.getByRole('button', { name: 'открыть' }));
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBe('true'));
    expect(container().className).toContain('top-[calc(env(safe-area-inset-top)+0.5rem)]');
    expect(container().className).not.toContain('bottom-[');
    // справа оставлено место под «×» окна
    expect(container().className).toContain('pr-[4.5rem]');
    expect(screen.getByRole('status')).toHaveTextContent('Кошелёк добавлен');
  });

  it('окно закрыли — тост возвращается вниз', async () => {
    mount();
    await user.click(screen.getByRole('button', { name: 'тост' }));
    await user.click(screen.getByRole('button', { name: 'открыть' }));
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBeNull());
    expect(container().className).toContain('bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]');
  });

  it('тост, появившийся при открытом окне («Сохранить и добавить ещё»), виден — наверху', async () => {
    mount();
    await user.click(screen.getByRole('button', { name: 'открыть' }));
    // кнопки страницы под окном недоступны человеку, но тосты приходят и из самого окна: имитируем вызовом из окна
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.click();
    });
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBe('true'));
    expect(screen.getByRole('status')).toHaveTextContent('Кошелёк добавлен');
  });

  it('при открытом окне виден только самый новый тост; остальные не потеряны и возвращаются после закрытия', async () => {
    mount();
    await user.click(screen.getByRole('button', { name: 'второй' }));
    await user.click(screen.getByRole('button', { name: 'ошибка' }));
    expect(screen.getAllByRole('status').length + screen.getAllByRole('alert').length).toBe(2);
    await user.click(screen.getByRole('button', { name: 'открыть' }));
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBe('true'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось'); // ошибка — самая новая, она не прячется
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сохранено'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('таймеры идут как обычно: тост под окном не «зависает» навечно', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await user.click(screen.getByRole('button', { name: 'тост' }));
    await user.click(screen.getByRole('button', { name: 'открыть' }));
    await waitFor(() => expect(container().getAttribute('data-over-modal')).toBe('true'));
    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
