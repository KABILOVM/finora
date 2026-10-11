import { describe, expect, it } from 'vitest';
import { INSTALL_PROMPT_KEY, SNOOZE_DAYS, readMemory, rememberDismissed, rememberInstalled, shouldShowInstallPrompt } from './frequency';
import { detectInstallMode } from './platform';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const env = (userAgent: string, o: { touch?: number; standalone?: boolean; native?: boolean } = {}) =>
  detectInstallMode({ userAgent, maxTouchPoints: o.touch ?? 0, standalone: o.standalone ?? false, hasNativePrompt: o.native ?? false });

describe('detectInstallMode', () => {
  it('iPhone Safari — шаги; Chrome/Firefox на iPhone — «откройте в Safari»', () => {
    expect(env(IPHONE_SAFARI, { touch: 5 })).toBe('ios-safari');
    expect(env(IPHONE_CHROME, { touch: 5 })).toBe('ios-other');
    expect(env(IPHONE_FIREFOX, { touch: 5 })).toBe('ios-other');
  });
  it('iPad с «десктопным» Safari — шаги, настоящий Mac — нет', () => {
    expect(env(MAC_SAFARI, { touch: 5 })).toBe('ios-safari');
    expect(env(MAC_SAFARI, { touch: 0 })).toBe('none');
  });
  it('Android: кнопка только когда браузер прислал событие', () => {
    expect(env(ANDROID_CHROME, { touch: 5, native: true })).toBe('native');
    expect(env(ANDROID_CHROME, { touch: 5, native: false })).toBe('none');
  });
  it('ПК не беспокоим, даже если Chrome прислал событие (и даже с тачскрином)', () => {
    expect(env(DESKTOP_CHROME, { native: true })).toBe('none');
    expect(env(DESKTOP_CHROME, { touch: 10, native: true })).toBe('none');
  });
  it('уже установлено — нигде не предлагаем', () => {
    expect(env(IPHONE_SAFARI, { touch: 5, standalone: true })).toBe('none');
    expect(env(ANDROID_CHROME, { touch: 5, standalone: true, native: true })).toBe('none');
  });
});

function memStore(initial?: string) {
  let v = initial ?? null;
  return { getItem: () => v, setItem: (_: string, x: string) => void (v = x), get raw() { return v; } };
}
const DAY = 24 * 60 * 60 * 1000;

describe('частота показа', () => {
  it('первый раз — показываем', () => {
    expect(shouldShowInstallPrompt({}, 1000, false)).toBe(true);
  });
  it('после «Не сейчас» молчим ровно 7 дней', () => {
    const t0 = 1_000_000;
    expect(shouldShowInstallPrompt({ dismissedAt: t0 }, t0 + 7 * DAY - 1, false)).toBe(false);
    expect(shouldShowInstallPrompt({ dismissedAt: t0 }, t0 + 7 * DAY, false)).toBe(true);
    expect(SNOOZE_DAYS).toBe(7);
  });
  it('часы ушли назад — считаем «недавно», не показываем', () => {
    expect(shouldShowInstallPrompt({ dismissedAt: 5 * DAY }, 1 * DAY, false)).toBe(false);
  });
  it('установлено — никогда; уже показывали в этой сессии — не повторяем', () => {
    expect(shouldShowInstallPrompt({ installed: true }, 100 * DAY, false)).toBe(false);
    expect(shouldShowInstallPrompt({}, 1000, true)).toBe(false);
  });
  it('запись и чтение; «установлено» не стирает дату отказа', () => {
    const s = memStore();
    rememberDismissed(42, s);
    rememberInstalled(s);
    expect(readMemory(s)).toEqual({ dismissedAt: 42, installed: true });
    expect(JSON.parse(s.raw!)).toEqual({ dismissedAt: 42, installed: true });
  });
  it('мусор и недоступное хранилище не роняют', () => {
    expect(readMemory(memStore('{не json'))).toEqual({});
    expect(readMemory(memStore('{"dismissedAt":"вчера","installed":1}'))).toEqual({});
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('Quota');
      },
    };
    expect(readMemory(broken)).toEqual({});
    expect(() => rememberDismissed(1, broken)).not.toThrow();
    expect(readMemory(null)).toEqual({});
    expect(INSTALL_PROMPT_KEY).toContain('v1');
  });
});
