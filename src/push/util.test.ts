import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDeviceOptedOut, isDeviceOptedOut } from './deviceFlag';
import { TimeoutError, deviceTimezone, isOnline, isValidTimezone, withTimeout } from './util';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('withTimeout', () => {
  it('быстрый ответ проходит, ошибка пробрасывается, зависание даёт TimeoutError', async () => {
    await expect(withTimeout(Promise.resolve(5), 100)).resolves.toBe(5);
    await expect(withTimeout(Promise.reject(new Error('x')), 100)).rejects.toThrow('x');
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), 100);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(150);
    expect(await caught).toBeInstanceOf(TimeoutError);
  });
});

describe('часовой пояс', () => {
  it('isValidTimezone: настоящие имена да, мусор и слишком длинное нет', () => {
    for (const ok of ['Asia/Dushanbe', 'UTC', 'Europe/Moscow', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3']) expect(isValidTimezone(ok), ok).toBe(true);
    for (const bad of ['', 'Не/Зона', 'Not/AZone', 'x'.repeat(65), 'Asia/Dushanbe\n', ' UTC', '../etc', 5, null, undefined, {}]) expect(isValidTimezone(bad), String(bad)).toBe(false);
  });
  it('deviceTimezone: берёт пояс устройства; если браузер вернул странное — пояс по умолчанию', () => {
    expect(isValidTimezone(deviceTimezone())).toBe(true);
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => ({ resolvedOptions: () => ({ timeZone: 'мусор' }) })) as never);
    expect(deviceTimezone()).toBe('Asia/Dushanbe');
  });
});

describe('isOnline', () => {
  it('false только когда браузер точно знает, что сети нет', () => {
    expect(isOnline()).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isOnline()).toBe(false);
  });
});

describe('отметка «выключено на этом устройстве»', () => {
  it('своя у каждого пользователя; снимается; хранилище сломано — не падает', () => {
    expect(isDeviceOptedOut('a')).toBe(false);
    setDeviceOptedOut('a', true);
    expect(isDeviceOptedOut('a')).toBe(true);
    expect(isDeviceOptedOut('b')).toBe(false);
    setDeviceOptedOut('a', false);
    expect(isDeviceOptedOut('a')).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    expect(isDeviceOptedOut('a')).toBe(false);
    expect(() => setDeviceOptedOut('a', true)).not.toThrow();
  });
});
