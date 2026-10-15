import { afterEach, describe, expect, it, vi } from 'vitest';
import { canNativeShare, nativeShare, telegramUrl, whatsappUrl } from './reminderShare';

const setShare = (fn: unknown) => Object.defineProperty(navigator, 'share', { value: fn, configurable: true, writable: true });
afterEach(() => {
  delete (navigator as { share?: unknown }).share;
  vi.restoreAllMocks();
});

describe('ссылки отправки', () => {
  it('текст кодируется целиком: символы адреса в нём не ломают ссылку и не добавляют параметров', () => {
    const text = 'Алишер, привет! 500 с. & срок=1#2 ?x';
    for (const url of [whatsappUrl(text), telegramUrl(text)]) {
      const u = new URL(url);
      expect(u.searchParams.get('text')).toBe(text);
      expect([...u.searchParams.keys()].filter((k) => k !== 'url')).toEqual(['text']);
      expect(u.hash).toBe('');
    }
  });

  it('хосты фиксированы: wa.me и t.me', () => {
    expect(new URL(whatsappUrl('x')).host).toBe('wa.me');
    expect(new URL(telegramUrl('x')).host).toBe('t.me');
    expect(new URL(telegramUrl('x')).searchParams.get('url')).toBe(' ');
  });
});

describe('nativeShare', () => {
  it('нет navigator.share — нельзя и не пробуем', async () => {
    expect(canNativeShare()).toBe(false);
    expect(await nativeShare('x')).toBe('failed');
  });

  it('поделились', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    expect(canNativeShare()).toBe(true);
    expect(await nativeShare('привет')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'привет' });
  });

  it('человек закрыл окно — «cancelled», это не ошибка', async () => {
    setShare(vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')));
    expect(await nativeShare('x')).toBe('cancelled');
  });

  it('любая другая ошибка — «failed»', async () => {
    setShare(vi.fn().mockRejectedValue(new Error('boom')));
    expect(await nativeShare('x')).toBe('failed');
    setShare(vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')));
    expect(await nativeShare('x')).toBe('failed');
  });
});
