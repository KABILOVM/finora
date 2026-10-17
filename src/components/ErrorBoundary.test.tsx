import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../package.json';
import { ErrorBoundary } from './ErrorBoundary';
import { render, screen, user, waitFor } from './testUtils';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Сломалась отрисовка суммы');
  return <p>Всё хорошо</p>;
}

/** Текст отчёта в «Технических подробностях». */
const report = () => document.querySelector('[role="alert"] details pre')?.textContent ?? '';

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
    // техническая причина — только в сворачиваемых «Технических подробностях»
    expect(screen.getByText('Технические подробности')).toBeInTheDocument();
    expect(report()).toContain('Сломалась отрисовка суммы');
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
    expect(report()).toContain('просто строка');
  });

  it('экран сбоя — ровно один role="alert" (по нему подсказка об обновлении узнаёт, что приложение упало)', () => {
    render(
      <ErrorBoundary onReload={() => {}} onExport={async () => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('ErrorBoundary: «На главную»', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it('на «Главной» кнопки нет: она ничего бы не изменила', () => {
    window.history.replaceState(null, '', '/#/');
    render(
      <ErrorBoundary onReload={() => {}} onGoHome={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button', { name: 'На главную' })).toBeNull();
  });

  it('упала другая страница: «На главную» есть и вызывает onGoHome', async () => {
    window.history.replaceState(null, '', '/#/debts/abc');
    const onGoHome = vi.fn();
    render(
      <ErrorBoundary onReload={() => {}} onGoHome={onGoHome}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'На главную' }));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('по умолчанию меняет адрес на «#/» и перезагружает: «Перезагрузить» открыл бы ту же сломанную страницу', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { pathname: '/app/', search: '?v=1', hash: '#/debts/people/alice', reload });
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'На главную' }));
    expect(replace).toHaveBeenCalledWith(null, '', '/app/?v=1#/');
    expect(reload).toHaveBeenCalledTimes(1);
    replace.mockRestore();
  });
});

describe('ErrorBoundary: «Скопировать отчёт»', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('копирует версию, страницу без личных данных, ошибку, стек и цепочку компонентов', async () => {
    window.history.replaceState(null, '', '/#/debts/people/%D0%90%D0%BB%D0%B8%D1%81%D0%B0');
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Отчёт скопирован'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]?.[0] ?? '';
    expect(text).toContain(`Sumoima ${version}`);
    expect(text).toContain('Страница: /debts/people/:id');
    expect(text).not.toContain('%D0%90'); // имя человека из адреса в отчёт не попадает
    expect(text).toContain('Ошибка: Error: Сломалась отрисовка суммы');
    expect(text).toMatch(/Стек:\n.+/);
    expect(text).toMatch(/Компоненты:\n.*Bomb/);
  });

  it('буфер обмена недоступен: отчёт раскрывается и выделяется, чтобы скопировать вручную', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('нет разрешения');
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('скопируйте его вручную'));
    expect((document.querySelector('[role="alert"] details') as HTMLDetailsElement).open).toBe(true);
    expect(window.getSelection()?.toString()).toContain('Сломалась отрисовка суммы');
  });
});

describe('ErrorBoundary: «Сохранить копию данных»', () => {
  const button = () => screen.queryByRole('button', { name: 'Сохранить копию данных' });

  it('без onExport кнопки нет (облако: данные и так на сервере)', () => {
    render(
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(button()).toBeNull();
  });

  it('canExport говорит «нельзя» (например, включён замок) — кнопки нет', () => {
    render(
      <ErrorBoundary onReload={() => {}} onExport={async () => {}} canExport={() => false}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(button()).toBeNull();
  });

  it('сохраняет копию и сообщает об этом', async () => {
    const onExport = vi.fn(async () => {});
    render(
      <ErrorBoundary onReload={() => {}} onExport={onExport} canExport={() => true}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(button() as HTMLElement);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Копия данных сохранена в файл'));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('копия не сохранилась — понятный текст, экран не падает', async () => {
    render(
      <ErrorBoundary onReload={() => {}} onExport={async () => Promise.reject(new Error('диск полон'))}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    await user.click(button() as HTMLElement);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Не удалось сохранить копию'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
  });
});
