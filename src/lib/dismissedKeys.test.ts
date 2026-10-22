import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissKey, forgetDismissedCache, readDismissed, restoreKey, DISMISSED_MAX } from './dismissedKeys';

const NS = 'test';
const USER = 'u1';
const raw = (ns = NS, user = USER) => window.localStorage.getItem(`finora:dismissed:${ns}:${user}`);

beforeEach(() => {
  window.localStorage.clear();
  forgetDismissedCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  forgetDismissedCache();
});

describe('скрытые подсказки на устройстве', () => {
  it('сначала пусто; скрытое записывается и читается; повтор ничего не меняет', () => {
    expect(readDismissed(NS, USER)).toEqual([]);
    dismissKey(NS, USER, 'a');
    dismissKey(NS, USER, 'b');
    dismissKey(NS, USER, 'a');
    expect(readDismissed(NS, USER)).toEqual(['a', 'b']);
    expect(JSON.parse(raw()!)).toEqual(['a', 'b']);
  });

  it('пока ничего не менялось, это один и тот же массив (нужно для useSyncExternalStore)', () => {
    expect(readDismissed(NS, USER)).toBe(readDismissed(NS, USER));
    dismissKey(NS, USER, 'a');
    expect(readDismissed(NS, USER)).toBe(readDismissed(NS, USER));
  });

  it('у каждого человека и вида подсказок свой список', () => {
    dismissKey(NS, USER, 'a');
    expect(readDismissed(NS, 'u2')).toEqual([]);
    expect(readDismissed('другое', USER)).toEqual([]);
  });

  it('«вернуть» убирает ключ; чужой ключ — без изменений', () => {
    dismissKey(NS, USER, 'a');
    dismissKey(NS, USER, 'b');
    restoreKey(NS, USER, 'a');
    restoreKey(NS, USER, 'нет такого');
    expect(readDismissed(NS, USER)).toEqual(['b']);
  });

  it('помнит только последние DISMISSED_MAX: старые вытесняются', () => {
    for (let i = 0; i < DISMISSED_MAX + 5; i++) dismissKey(NS, USER, `k${i}`);
    const keys = readDismissed(NS, USER);
    expect(keys).toHaveLength(DISMISSED_MAX);
    expect(keys[0]).toBe('k5');
    expect(keys[keys.length - 1]).toBe(`k${DISMISSED_MAX + 4}`);
  });

  it('читает то, что записано раньше (после перезагрузки страницы); мусор читается как пустой список', () => {
    window.localStorage.setItem(`finora:dismissed:${NS}:${USER}`, JSON.stringify(['x', 5, null, 'y']));
    expect(readDismissed(NS, USER)).toEqual(['x', 'y']);
    forgetDismissedCache();
    window.localStorage.setItem(`finora:dismissed:${NS}:${USER}`, '{не json');
    expect(readDismissed(NS, USER)).toEqual([]);
    forgetDismissedCache();
    window.localStorage.setItem(`finora:dismissed:${NS}:${USER}`, '{"a":1}');
    expect(readDismissed(NS, USER)).toEqual([]);
  });

  it('хранилище недоступно: скрытое живёт в памяти до перезагрузки', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readDismissed(NS, USER)).toEqual([]);
    dismissKey(NS, USER, 'a');
    expect(readDismissed(NS, USER)).toEqual(['a']);
  });
});
