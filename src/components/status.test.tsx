import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_HINT_KEY, InstallHint } from './InstallHint';
import { OnlineBadge, useOnline } from './OnlineBadge';
import { SyncBadge, syncBadgeText } from './SyncBadge';
import { UpdatePrompt } from './UpdatePrompt';
import { act, render, screen, user } from './testUtils';

const sw = vi.hoisted(() => ({ needRefresh: false, setNeedRefresh: vi.fn(), updateServiceWorker: vi.fn(async () => {}) }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, sw.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.updateServiceWorker,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncBadge', () => {
  it('тексты по фазам', () => {
    expect(syncBadgeText('idle', 0)).toBe('Синхронизировано');
    expect(syncBadgeText('idle', 1)).toBe('1 запись ждёт отправки');
    expect(syncBadgeText('idle', 3)).toBe('3 записи ждут отправки');
    expect(syncBadgeText('idle', 5)).toBe('5 записей ждут отправки');
    expect(syncBadgeText('syncing', 2)).toBe('Синхронизация…');
    expect(syncBadgeText('offline', 0)).toBe('Без сети');
    expect(syncBadgeText('offline', 21)).toBe('Без сети · 21 запись в очереди');
    expect(syncBadgeText('error', 2)).toBe('Ошибка синхронизации · 2 записи в очереди');
    expect(syncBadgeText('auth-required', 0)).toBe('Нужен вход');
    expect(syncBadgeText('auth-required', 12)).toBe('Нужен вход · 12 записей в очереди');
  });

  it('записи, отвергнутые сервером, видны в любой фазе и не дают написать «Синхронизировано»', () => {
    expect(syncBadgeText('idle', 0, 3)).toBe('Не принято сервером: 3');
    expect(syncBadgeText('idle', 2, 1)).toBe('2 записи ждут отправки · не принято сервером: 1');
    expect(syncBadgeText('syncing', 0, 4)).toBe('Синхронизация… · не принято сервером: 4');
    expect(syncBadgeText('offline', 0, 2)).toBe('Без сети · не принято сервером: 2');
    expect(syncBadgeText('error', 5, 1)).toBe('Ошибка синхронизации · 5 записей в очереди · не принято сервером: 1');
    expect(syncBadgeText('auth-required', 0, 7)).toBe('Нужен вход · не принято сервером: 7');
    expect(syncBadgeText('idle', 0, 0)).toBe('Синхронизировано');
    expect(syncBadgeText('idle', 0, Number.NaN)).toBe('Синхронизировано');
    expect(syncBadgeText('idle', 0, -2)).toBe('Синхронизировано');
  });

  it('бейдж с отвергнутыми записями красный (danger), с иконкой тревоги', () => {
    const v = render(<SyncBadge phase="idle" pending={0} quarantined={2} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Не принято сервером: 2');
    expect(el.className).toContain('text-danger');
    v.rerender(<SyncBadge phase="idle" pending={0} quarantined={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Синхронизировано');
    expect(screen.getByRole('status').className).not.toContain('text-danger');
  });

  it('мусорное число в очереди не ломает текст', () => {
    expect(syncBadgeText('offline', -3)).toBe('Без сети');
    expect(syncBadgeText('offline', Number.NaN)).toBe('Без сети');
  });

  it('рисуется как status с нужной фазой для каждого состояния', () => {
    for (const phase of ['idle', 'syncing', 'offline', 'error', 'auth-required'] as const) {
      const v = render(<SyncBadge phase={phase} pending={2} />);
      const el = screen.getByRole('status');
      expect(el).toHaveAttribute('data-phase', phase);
      expect(el.textContent).toBe(syncBadgeText(phase, 2));
      v.unmount();
    }
  });

  it('обновляется по пропсам', () => {
    const v = render(<SyncBadge phase="offline" pending={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Без сети · 1 запись в очереди');
    v.rerender(<SyncBadge phase="idle" pending={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Синхронизировано');
  });
});

describe('OnlineBadge / useOnline', () => {
  function setOnline(value: boolean) {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
    act(() => {
      window.dispatchEvent(new Event(value ? 'online' : 'offline'));
    });
  }

  it('реагирует на события online/offline', () => {
    function Probe() {
      return <p>{useOnline() ? 'есть сеть' : 'нет сети'}</p>;
    }
    render(
      <>
        <Probe />
        <OnlineBadge />
      </>,
    );
    expect(screen.getByText('есть сеть')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Онлайн');
    setOnline(false);
    expect(screen.getByText('нет сети')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Офлайн');
    setOnline(true);
    expect(screen.getByRole('status')).toHaveTextContent('Онлайн');
  });

  it('hideWhenOnline: виден только без сети', () => {
    render(<OnlineBadge hideWhenOnline />);
    expect(screen.queryByRole('status')).toBeNull();
    setOnline(false);
    expect(screen.getByRole('status')).toHaveTextContent('Офлайн');
  });
});

describe('InstallHint', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
  const DESKTOP_CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

  function env(ua: string, touchPoints = 0) {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
    // в jsdom свойства maxTouchPoints нет вовсе — задаём его сами (и убираем в afterEach)
    Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
  }

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    delete (navigator as { standalone?: boolean }).standalone;
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  });

  it('iPhone Safari вне приложения: показывает подсказку про «Поделиться» → «На экран Домой»', () => {
    env(IPHONE_SAFARI);
    render(<InstallHint />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Нажмите «Поделиться» → «На экран Домой»');
  });

  it('не показывает: Chrome на iPhone, ПК, настоящий Mac', () => {
    for (const [ua, touch] of [[IPHONE_CHROME, 5], [DESKTOP_CHROME, 0], [MAC_SAFARI, 0]] as const) {
      env(ua, touch);
      const v = render(<InstallHint />);
      expect(screen.queryByRole('note')).toBeNull();
      v.unmount();
    }
  });

  it('iPad с «десктопным» Safari (Macintosh + сенсорный экран) — показывает', () => {
    env(MAC_SAFARI, 5);
    render(<InstallHint />);
    expect(screen.queryByRole('note')).not.toBeNull();
  });

  it('не показывает, если уже запущено как приложение (standalone)', () => {
    env(IPHONE_SAFARI);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    render(<InstallHint />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('не показывает при display-mode: standalone', () => {
    env(IPHONE_SAFARI);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<InstallHint />);
    expect(screen.queryByRole('note')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('закрывается и запоминает выбор в localStorage; при следующем запуске не показывается', async () => {
    env(IPHONE_SAFARI);
    const v = render(<InstallHint />);
    await user.click(screen.getByRole('button', { name: 'Закрыть подсказку' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');
    v.unmount();
    render(<InstallHint />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('localStorage недоступен (приватный режим): не падает, закрывается на время сессии', async () => {
    env(IPHONE_SAFARI);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<InstallHint />);
    expect(screen.queryByRole('note')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Закрыть подсказку' }));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('UpdatePrompt', () => {
  beforeEach(() => {
    sw.needRefresh = false;
    sw.setNeedRefresh.mockClear();
    sw.updateServiceWorker.mockClear();
    sw.updateServiceWorker.mockImplementation(async () => {});
  });

  it('новой версии нет — ничего не показывает', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('есть новая версия: предлагает обновиться, но молча НЕ применяет', () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent('Доступна новая версия');
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('«Обновить» применяет обновление один раз', async () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('«Позже» скрывает предложение и ничего не применяет', async () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    await user.click(screen.getByRole('button', { name: 'Позже' }));
    expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('ошибка обновления не оставляет кнопку заблокированной', async () => {
    sw.needRefresh = true;
    sw.updateServiceWorker.mockImplementation(async () => {
      throw new Error('сеть пропала');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<UpdatePrompt />);
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Обновить' })).not.toBeDisabled();
    expect(spy).toHaveBeenCalled();
  });
});
