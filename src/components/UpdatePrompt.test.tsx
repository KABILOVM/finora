import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionBoundary } from '@/layout/SectionBoundary';
import { ErrorBoundary } from './ErrorBoundary';
import { UpdatePrompt, UpdatePromptHost } from './UpdatePrompt';
import { act, render, screen, user } from './testUtils';

interface SwOptions {
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
}
const sw = vi.hoisted(() => ({
  needRefresh: false,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(async () => {}),
  options: undefined as undefined | { onNeedRefresh?: () => void; onNeedReload?: () => void },
  failRender: false,
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: SwOptions) => {
    if (sw.failRender) throw new Error('сломана подсказка');
    sw.options = options;
    return { needRefresh: [sw.needRefresh, sw.setNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: sw.updateServiceWorker };
  },
}));

const reload = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;
const muteWindowError = (e: ErrorEvent) => e.preventDefault();

beforeEach(() => {
  sw.needRefresh = false;
  sw.failRender = false;
  sw.options = undefined;
  sw.setNeedRefresh.mockClear();
  sw.updateServiceWorker.mockClear();
  sw.updateServiceWorker.mockImplementation(async () => {});
  reload.mockClear();
  vi.stubGlobal('location', { href: 'http://localhost/', reload });
  sessionStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', muteWindowError);
});
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount();
  window.removeEventListener('error', muteWindowError);
  errorSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  document.querySelectorAll('[role="dialog"], #probe-input').forEach((n) => n.remove());
});

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Сломалась отрисовка');
  return <p>Всё хорошо</p>;
}

const roots: Array<() => void> = [];

/** Корень с id="root" — как в index.html: по нему подсказка узнаёт, что приложение показывает экран ошибки. */
function mountInRoot(ui: React.ReactElement) {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(ui));
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  roots.push(unmount);
  return { container, rerender: (next: React.ReactElement) => act(() => root.render(next)), unmount };
}

function fakeServiceWorker(extra: Record<string, unknown> = {}) {
  const update = vi.fn(async () => {});
  const container = Object.assign(new EventTarget(), {
    controller: {},
    getRegistration: vi.fn(async () => ({ update })),
    ...extra,
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return { update, container };
}

describe('UpdatePromptHost: подсказка живёт вне приложения', () => {
  it('подсказка одна, даже если приложение рисует свою копию', () => {
    sw.needRefresh = true;
    render(
      <UpdatePromptHost>
        <UpdatePrompt />
        <p>Приложение</p>
      </UpdatePromptHost>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Доступна новая версия')).toBeInTheDocument();
  });

  it('без оболочки копия внутри приложения работает как раньше', () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent('Доступна новая версия');
  });

  it('когда приложение упало и показало экран ошибки, подсказка «Обновить» остаётся на месте', () => {
    sw.needRefresh = true;
    render(
      <UpdatePromptHost>
        <ErrorBoundary onReload={() => {}}>
          <UpdatePrompt />
          <Bomb explode />
        </ErrorBoundary>
      </UpdatePromptHost>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Доступна новая версия')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });

  it('сама подсказка сломалась — приложение продолжает работать', () => {
    sw.failRender = true;
    render(
      <UpdatePromptHost>
        <p>Приложение</p>
      </UpdatePromptHost>,
    );
    expect(screen.getByText('Приложение')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('исправление ставится само, когда приложение упало', () => {
  const app = (explode: boolean) => (
    <UpdatePromptHost>
      <ErrorBoundary onReload={() => {}}>
        <Bomb explode={explode} />
      </ErrorBoundary>
    </UpdatePromptHost>
  );

  it('экран ошибки + исправление уже скачано: «Обновить» нажимается без человека, ровно один раз', async () => {
    sw.needRefresh = true;
    mountInRoot(app(true));
    await act(async () => {});
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('экран ошибки, но исправления нет — ничего не применяется', async () => {
    mountInRoot(app(true));
    await act(async () => {});
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('приложение целое, исправление ждёт — молча НЕ применяется (человек может вводить операцию)', async () => {
    sw.needRefresh = true;
    mountInRoot(app(false));
    await act(async () => {});
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('«Позже» нажали раньше, потом приложение упало — исправление всё равно ставится', async () => {
    const view = mountInRoot(app(false));
    await act(async () => sw.options?.onNeedRefresh?.()); // воркер дождался, но подсказку человек отклонил/не видел
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    view.rerender(app(true));
    await act(async () => {});
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it('упал один раздел («Раздел не загрузился», меню на месте) — исправление тоже ставится само', async () => {
    const section = (explode: boolean) => (
      <UpdatePromptHost>
        <MemoryRouter>
          <div>
            <main>
              <SectionBoundary>
                <Bomb explode={explode} />
              </SectionBoundary>
            </main>
          </div>
        </MemoryRouter>
      </UpdatePromptHost>
    );
    const view = mountInRoot(section(false));
    await act(async () => sw.options?.onNeedRefresh?.());
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    // карточка раздела появляется глубоко внутри дерева, а не прямо в #root
    view.rerender(section(true));
    await act(async () => {});
    expect(document.querySelector('#root > [role="alert"]')).toBeNull();
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it('браузер «завис» на полпути и страница не перезагрузилась — через 5 секунд перезагружаем сами', async () => {
    vi.useFakeTimers();
    sw.needRefresh = true;
    mountInRoot(app(true));
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ошибка при обновлении: следов не остаётся, самоперезагрузки нет', async () => {
    vi.useFakeTimers();
    sw.needRefresh = true;
    sw.updateServiceWorker.mockImplementation(async () => {
      throw new Error('сеть пропала');
    });
    mountInRoot(app(true));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('новый воркер взял управление (onNeedReload)', () => {
  it('человек ничего не вводит — страница перезагружается', () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    act(() => sw.options?.onNeedReload?.());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('открыто окно ввода — НЕ перезагружается, показывает, что делать, и ждёт конца ввода', async () => {
    vi.useFakeTimers();
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    act(() => sw.options?.onNeedReload?.());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Приложение обновлено');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(reload).not.toHaveBeenCalled(); // ввод идёт
    dialog.remove();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(reload).toHaveBeenCalledTimes(1); // ввод закончился
  });

  it('курсор стоит в поле ввода — тоже «идёт ввод»', () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    const input = document.body.appendChild(document.createElement('input'));
    input.id = 'probe-input';
    input.focus();
    act(() => sw.options?.onNeedReload?.());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
    input.remove();
  });

  it('«Перезагрузить» в такой подсказке перезагружает сразу', async () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    act(() => sw.options?.onNeedReload?.());
    await user.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('«Обновить» нажали здесь — перезагрузка без оговорок, даже с открытым окном', async () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    act(() => sw.options?.onNeedReload?.());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('воркер сменился (событие браузера), человек ничего не вводит — перезагрузка', () => {
    const { container } = fakeServiceWorker();
    render(<UpdatePrompt />);
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('первая установка (воркера раньше не было) — смена управления не считается обновлением', () => {
    const { container } = fakeServiceWorker({ controller: null });
    render(<UpdatePrompt />);
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('поиск новой версии в долго открытом приложении', () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('вернулись в приложение — спрашиваем браузер о новой версии; свернули — нет', async () => {
    const { update } = fakeServiceWorker();
    render(<UpdatePrompt />);
    setVisibility('hidden');
    await act(async () => {});
    expect(update).not.toHaveBeenCalled();
    setVisibility('visible');
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('частые возвраты не заваливают сервер: не чаще раза в полминуты', async () => {
    vi.useFakeTimers();
    const { update } = fakeServiceWorker();
    render(<UpdatePrompt />);
    for (let i = 0; i < 4; i++) {
      setVisibility('visible');
      await act(async () => {});
    }
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    setVisibility('visible');
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('появилась сеть и вернулся фокус — тоже проверка', async () => {
    vi.useFakeTimers();
    const { update } = fakeServiceWorker();
    render(<UpdatePrompt />);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('и по таймеру раз в час, даже если человек не выходил из приложения', async () => {
    vi.useFakeTimers();
    const { update } = fakeServiceWorker();
    render(<UpdatePrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    });
    expect(update).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('без сети проверка не запускается; ошибка проверки не ломает приложение', async () => {
    const { update } = fakeServiceWorker();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<UpdatePrompt />);
    setVisibility('visible');
    await act(async () => {});
    expect(update).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    update.mockRejectedValueOnce(new Error('Failed to update a ServiceWorker'));
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    setVisibility('visible');
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
    online.mockRestore();
  });

  it('при выгрузке подсказки слушатели и таймер снимаются', async () => {
    vi.useFakeTimers();
    const { update } = fakeServiceWorker();
    const view = render(<UpdatePrompt />);
    view.unmount();
    setVisibility('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('страница одной версии, воркер другой', () => {
  const stubCaches = (found: boolean) => {
    const match = vi.fn(async () => (found ? ({} as Response) : undefined));
    vi.stubGlobal('caches', { match });
    return match;
  };

  it('кода страницы нет ни в одном кэше — перезагружаем (после смены воркера кэш старой версии удалён)', async () => {
    fakeServiceWorker();
    const match = stubCaches(false);
    render(<UpdatePrompt />);
    await act(async () => {});
    expect(match).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('код страницы на месте — ничего не делаем', async () => {
    vi.useFakeTimers();
    fakeServiceWorker();
    stubCaches(true);
    render(<UpdatePrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('воркер ещё не управляет страницей (первый запуск) — ничего не делаем', async () => {
    fakeServiceWorker({ controller: null });
    const match = stubCaches(false);
    render(<UpdatePrompt />);
    await act(async () => {});
    expect(match).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('кэш недоступен (приватный режим) — не гадаем', async () => {
    fakeServiceWorker();
    vi.stubGlobal('caches', {
      match: vi.fn(async () => {
        throw new Error('SecurityError');
      }),
    });
    render(<UpdatePrompt />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
  });

  it('не зацикливается: больше двух самоперезагрузок за минуту нет', async () => {
    fakeServiceWorker();
    stubCaches(false);
    for (let i = 0; i < 4; i++) {
      const view = render(<UpdatePrompt />);
      await act(async () => {});
      view.unmount();
    }
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('человек как раз вводит — страницу не трогаем, показываем подсказку', async () => {
    fakeServiceWorker();
    stubCaches(false);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    render(<UpdatePrompt />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Приложение обновлено');
  });
});
