import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { render, screen, user } from './testUtils';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Сломалась отрисовка суммы');
  return <p>Всё хорошо</p>;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
// React в dev-режиме пробрасывает ошибку рендера в window 'error'; jsdom печатает её в консоль, если событие не отменено.
const muteWindowError = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', muteWindowError);
});
afterEach(() => {
  window.removeEventListener('error', muteWindowError);
  errorSpy.mockRestore();
  localStorage.clear();
});

describe('ErrorBoundary', () => {
  it('без ошибок показывает содержимое', () => {
    render(
      <ErrorBoundary>
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Всё хорошо')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('при ошибке показывает понятное сообщение по-русски и кнопку «Перезагрузить»', () => {
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText(/записи сохранены на устройстве/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument();
    // техническая причина — только в сворачиваемых «Подробностях»
    expect(screen.getByText('Сломалась отрисовка суммы')).toBeInTheDocument();
  });

  it('«Перезагрузить» вызывает onReload', async () => {
    const onReload = vi.fn();
    render(
      <ErrorBoundary onReload={onReload}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('сообщает об ошибке через onError и пишет в консоль', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError} onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('Сломалась отрисовка суммы');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('локальные данные не затрагиваются', () => {
    localStorage.setItem('finora.test', 'важно');
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(localStorage.getItem('finora.test')).toBe('важно');
  });

  it('ловит и не-Error (throw "строка")', () => {
    function Throws(): never {
      throw 'просто строка';
    }
    render(
      <ErrorBoundary onReload={() => {}}>
        <Throws />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText('просто строка')).toBeInTheDocument();
  });
});
