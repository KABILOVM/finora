import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRateStorage, createRateStorage, type StorageLike } from './storage';
import { RATES_STORAGE_KEY } from './types';

function fakeDisk(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  const disk = {
    data,
    failSet: false,
    failGet: false,
    getItem(k: string) {
      if (disk.failGet) throw new Error('SecurityError');
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (disk.failSet) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
  return disk satisfies StorageLike & Record<string, unknown>;
}

describe('createMemoryRateStorage', () => {
  it('хранит копию: правка исходного объекта или полученного не портит сохранённое', () => {
    const s = createMemoryRateStorage();
    expect(s.get()).toBeNull();
    const doc = { v: 1, list: [1, 2] };
    s.set(doc);
    doc.list.push(3);
    const got = s.get() as typeof doc;
    expect(got).toEqual({ v: 1, list: [1, 2] });
    got.list.push(9);
    expect(s.get()).toEqual({ v: 1, list: [1, 2] });
  });
});

describe('createRateStorage', () => {
  it('ключ по умолчанию — finora:rates:v1; запись и чтение JSON', () => {
    expect(RATES_STORAGE_KEY).toBe('finora:rates:v1');
    const disk = fakeDisk();
    const s = createRateStorage({ storage: disk });
    expect(s.get()).toBeNull();
    s.set({ a: 1 });
    expect(JSON.parse(disk.data.get('finora:rates:v1') as string)).toEqual({ a: 1 });
    expect(createRateStorage({ storage: disk }).get()).toEqual({ a: 1 }); // «после перезагрузки»
  });

  it('свой ключ', () => {
    const disk = fakeDisk();
    createRateStorage({ storage: disk, key: 'x' }).set(5);
    expect([...disk.data.keys()]).toEqual(['x']);
  });

  it('битый JSON на диске → get() не бросает; значение берётся из памяти после первой записи', () => {
    const disk = fakeDisk({ [RATES_STORAGE_KEY]: '{не json' });
    const s = createRateStorage({ storage: disk });
    expect(s.get()).toBeNull();
    s.set({ ok: true });
    expect(s.get()).toEqual({ ok: true });
  });

  it('переполнение при записи: курсы остаются доступны из памяти, пока диск не оправится', () => {
    const disk = fakeDisk();
    const s = createRateStorage({ storage: disk });
    s.set({ n: 1 });
    disk.failSet = true;
    expect(() => s.set({ n: 2 })).not.toThrow();
    expect(s.get()).toEqual({ n: 2 }); // а не устаревшее { n: 1 } с диска
    disk.failSet = false;
    s.set({ n: 3 });
    expect(s.get()).toEqual({ n: 3 });
    expect(JSON.parse(disk.data.get(RATES_STORAGE_KEY) as string)).toEqual({ n: 3 });
  });

  it('чтение с диска запрещено → память; запись не бросает', () => {
    const disk = fakeDisk();
    disk.failGet = true;
    const s = createRateStorage({ storage: disk });
    expect(s.get()).toBeNull();
    s.set({ k: 1 });
    expect(s.get()).toEqual({ k: 1 });
  });

  it('localStorage недоступен совсем (null) → только память', () => {
    const s = createRateStorage({ storage: null });
    s.set({ m: 1 });
    expect(s.get()).toEqual({ m: 1 });
  });

  it('в браузерной среде по умолчанию использует настоящий localStorage', () => {
    localStorage.removeItem(RATES_STORAGE_KEY);
    const s = createRateStorage();
    s.set({ real: true });
    expect(JSON.parse(localStorage.getItem(RATES_STORAGE_KEY) ?? 'null')).toEqual({ real: true });
    expect(createRateStorage().get()).toEqual({ real: true });
  });

  afterEach(() => localStorage.removeItem(RATES_STORAGE_KEY));
});

describe('createRateStorage.subscribe: изменения из других вкладок', () => {
  const fire = (key: string | null): void => {
    window.dispatchEvent(new StorageEvent('storage', { key }));
  };

  afterEach(() => vi.restoreAllMocks());

  it('слушатель вызывается на событие «storage» с нашим ключом и при очистке всего хранилища; на чужой ключ — нет', () => {
    const s = createRateStorage({ storage: fakeDisk() });
    const listener = vi.fn();
    const off = s.subscribe?.(listener);
    fire(RATES_STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    fire(null);
    expect(listener).toHaveBeenCalledTimes(2);
    fire('другой-ключ');
    expect(listener).toHaveBeenCalledTimes(2);
    off?.();
    fire(RATES_STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('свой ключ учитывается', () => {
    const s = createRateStorage({ storage: fakeDisk(), key: 'мой' });
    const listener = vi.fn();
    const off = s.subscribe?.(listener);
    fire(RATES_STORAGE_KEY);
    expect(listener).not.toHaveBeenCalled();
    fire('мой');
    expect(listener).toHaveBeenCalledTimes(1);
    off?.();
  });

  it('без доступа к диску слушать нечего: подписка пустая и безопасная', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const off = createRateStorage({ storage: null }).subscribe?.(() => {});
    expect(add).not.toHaveBeenCalledWith('storage', expect.anything());
    expect(() => off?.()).not.toThrow();
  });

  it('после смены содержимого другой вкладкой get() читает новое с диска', () => {
    const disk = fakeDisk();
    const s = createRateStorage({ storage: disk });
    s.set({ n: 1 });
    disk.data.set(RATES_STORAGE_KEY, JSON.stringify({ n: 2 })); // «записала другая вкладка»
    expect(s.get()).toEqual({ n: 2 });
  });
});
