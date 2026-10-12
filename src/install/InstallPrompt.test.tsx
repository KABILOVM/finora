import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallHint } from '@/components/InstallHint';
import { act, render, screen } from '@/components/testUtils';
import { INSTALL_PROMPT_KEY } from './frequency';
import { InstallPrompt, __resetShownThisSession } from './InstallPrompt';
import { __resetInstallCapture, startInstallCapture } from './installEvent';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TITLE = 'Установить Sumoima на экран телефона';
const DELAY = 1500;

function env(ua: string, touch = 5) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
}
const dialog = () => screen.queryByRole('dialog', { name: TITLE });
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function fakeInstallEvent(outcome: 'accepted' | 'dismissed') {
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<unknown> };
  ev.prompt = vi.fn(async () => {});
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  __resetShownThisSession();
  __resetInstallCapture();
  startInstallCapture();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { standalone?: boolean }).standalone;
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  document.querySelectorAll('[data-lock-cover]').forEach((n) => n.remove());
});

describe('InstallPrompt', () => {
  it('Android: ловит событие, ждёт паузу, кнопка «Установить» вызывает prompt() и закрывает окно', async () => {
    env(ANDROID);
    const ev = fakeInstallEvent('accepted');
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    render(<InstallPrompt />);
    expect(dialog()).toBeNull(); // сразу не показываем
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
    expect(ev.prompt).not.toHaveBeenCalled(); // только из нажатия
    const btn = screen.getByRole('button', { name: 'Установить' });
    expect(btn.className).toMatch(/min-h-\[(44|52)px\]/);
    await act(async () => btn.click());
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('Android: событие пришло позже таймера — окно появляется тогда', async () => {
    env(ANDROID);
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
    act(() => void window.dispatchEvent(fakeInstallEvent('dismissed')));
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
  });

  it('Android: отказ в системном окне = «Не сейчас» (7 дней)', async () => {
    env(ANDROID);
    act(() => void window.dispatchEvent(fakeInstallEvent('dismissed')));
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    await act(async () => screen.getByRole('button', { name: 'Установить' }).click());
    expect(dialog()).toBeNull();
    expect(JSON.parse(localStorage.getItem(INSTALL_PROMPT_KEY)!).dismissedAt).toBeTypeOf('number');
  });

  it('iPhone Safari: три шага, напоминание про уведомления и Face ID', async () => {
    env(IPHONE_SAFARI);
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('Поделиться');
    expect(steps[1]).toHaveTextContent('На экран Домой');
    expect(steps[2]).toHaveTextContent('Добавить');
    expect(dialog()).toHaveTextContent(/уведомления/);
    expect(dialog()).toHaveTextContent(/Face ID/);
    expect(screen.queryByRole('button', { name: 'Установить' })).toBeNull();
  });

  it('iPhone с Chrome: «Откройте эту ссылку в Safari»', async () => {
    env(IPHONE_CHROME);
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toHaveTextContent('Откройте эту ссылку в Safari');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('не показывает: уже установлено, ПК, установлено ранее', async () => {
    env(IPHONE_SAFARI);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const a = render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
    a.unmount();

    delete (navigator as { standalone?: boolean }).standalone;
    env(DESKTOP, 0);
    act(() => void window.dispatchEvent(fakeInstallEvent('accepted')));
    const b = render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
    b.unmount();

    env(IPHONE_SAFARI);
    localStorage.setItem(INSTALL_PROMPT_KEY, JSON.stringify({ installed: true }));
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
  });

  it('appinstalled: запоминает «установлено» навсегда', () => {
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(JSON.parse(localStorage.getItem(INSTALL_PROMPT_KEY)!).installed).toBe(true);
  });

  it('«Не сейчас» закрывает на 7 дней: следующий запуск молчит, через 7 дней снова', async () => {
    env(IPHONE_SAFARI);
    const a = render(<InstallPrompt />);
    await wait(DELAY + 10);
    await act(async () => screen.getByRole('button', { name: 'Не сейчас' }).click());
    expect(dialog()).toBeNull();
    a.unmount();

    __resetShownThisSession(); // «новый запуск»
    const b = render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
    b.unmount();

    __resetShownThisSession();
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
  });

  it('Esc закрывает; фокус внутри окна', async () => {
    env(IPHONE_SAFARI);
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull();
  });

  it('localStorage недоступен: показывает, а после закрытия больше не лезет в этой сессии', async () => {
    env(IPHONE_SAFARI);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    const a = render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Не сейчас' }).click());
    a.unmount();
    render(<InstallPrompt />);
    await wait(DELAY + 10);
    expect(dialog()).toBeNull();
  });

  it('ждёт, пока на экране заслонка замка, и не показывается поверх неё', async () => {
    env(IPHONE_SAFARI);
    const cover = document.createElement('div');
    cover.setAttribute('data-lock-cover', '');
    document.body.appendChild(cover);
    render(<InstallPrompt />);
    await wait(DELAY + 3000);
    expect(dialog()).toBeNull();
    cover.remove();
    await wait(1100);
    expect(dialog()).not.toBeNull();
  });

  it('маленькая подсказка на «Главной» молчит, пока окно открыто', async () => {
    env(IPHONE_SAFARI);
    render(
      <>
        <InstallHint />
        <InstallPrompt />
      </>,
    );
    expect(screen.queryByRole('note')).not.toBeNull();
    await wait(DELAY + 10);
    expect(dialog()).not.toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Не сейчас' }).click());
    expect(screen.queryByRole('note')).not.toBeNull();
  });
});
