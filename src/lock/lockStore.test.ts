import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLock,
  DEFAULT_GRACE,
  lockKey,
  parseLock,
  readLock,
  subscribeLock,
  updateGrace,
  writeLock,
  type LockSetting,
} from './lockStore';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const setting: LockSetting = { credentialId: 'AbCd_-0123', enabledAt: '2026-10-11T08:00:00.000Z', graceSeconds: 60 };

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('parseLock: запись, которую не поняли, — это НЕ «замок выключен»', () => {
  it('нет записи — выключен', () => {
    expect(parseLock(null)).toEqual({ kind: 'off' });
  });

  it('целая запись — включён', () => {
    expect(parseLock(JSON.stringify(setting))).toEqual({ kind: 'on', setting });
  });

  it.each([
    ['{битый json'],
    [''],
    ['null'],
    ['123'],
    ['"строка"'],
    ['[]'],
    ['{}'],
    ['{"credentialId":""}'],
    ['{"credentialId":5}'],
    ['{"credentialId":"не base64url!"}'],
    ['{"enabledAt":"2026-01-01","graceSeconds":60}'],
  ])('повреждённая запись %j — broken (экран остаётся закрытым)', (raw) => {
    expect(parseLock(raw)).toEqual({ kind: 'broken' });
  });

  it('непонятное время закрытия — самое строгое («сразу»), ключ сохраняется', () => {
    for (const graceSeconds of [77, -1, '60', null, undefined, 1e9]) {
      const s = parseLock(JSON.stringify({ credentialId: 'AbCd', enabledAt: 'x', graceSeconds }));
      expect(s).toEqual({ kind: 'on', setting: { credentialId: 'AbCd', enabledAt: 'x', graceSeconds: 0 } });
    }
    expect(parseLock(JSON.stringify({ credentialId: 'AbCd' }))).toMatchObject({ kind: 'on', setting: { enabledAt: '', graceSeconds: 0 } });
  });
});

describe('хранилище', () => {
  it('запись и чтение; ключ включает id пользователя, у разных пользователей настройки разные', () => {
    expect(readLock(A)).toEqual({ kind: 'off' });
    expect(writeLock(A, setting)).toBe(true);
    expect(localStorage.getItem(lockKey(A))).not.toBeNull();
    expect(readLock(A)).toEqual({ kind: 'on', setting });
    expect(readLock(B)).toEqual({ kind: 'off' });
    expect(lockKey(A)).toContain(A);
  });

  it('в записи нет почты и лишних полей', () => {
    writeLock(A, setting);
    expect(Object.keys(JSON.parse(localStorage.getItem(lockKey(A))!) as object).sort()).toEqual(['credentialId', 'enabledAt', 'graceSeconds']);
  });

  it('updateGrace меняет только время закрытия; без включённого замка — false', () => {
    expect(updateGrace(A, 300)).toBe(false);
    writeLock(A, setting);
    expect(updateGrace(A, 300)).toBe(true);
    expect(readLock(A)).toEqual({ kind: 'on', setting: { ...setting, graceSeconds: 300 } });
    localStorage.setItem(lockKey(A), '{битый');
    expect(updateGrace(A, 0)).toBe(false);
    expect(readLock(A)).toEqual({ kind: 'broken' });
  });

  it('clearLock убирает запись, в том числе повреждённую', () => {
    writeLock(A, setting);
    expect(clearLock(A)).toBe(true);
    expect(readLock(A)).toEqual({ kind: 'off' });
    localStorage.setItem(lockKey(A), 'мусор');
    expect(clearLock(A)).toBe(true);
    expect(readLock(A)).toEqual({ kind: 'off' });
  });

  it('хранилище недоступно: чтение — «выключен», запись и снятие — false, ничего не бросается', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    expect(readLock(A)).toEqual({ kind: 'off' });
    expect(writeLock(A, setting)).toBe(false);
    expect(clearLock(A)).toBe(false);
    expect(updateGrace(A, 0)).toBe(false);
  });

  it('запись не читается обратно такой же (переполнение хранилища «тихо») — writeLock говорит false', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    expect(writeLock(A, setting)).toBe(false);
  });

  it('по умолчанию — через 1 минуту', () => {
    expect(DEFAULT_GRACE).toBe(60);
  });
});

describe('подписка', () => {
  it('слушатель получает изменения в этой вкладке и из других (storage); отписка работает', () => {
    const seen = vi.fn();
    const off = subscribeLock(A, seen);
    writeLock(A, setting);
    clearLock(A);
    expect(seen).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: lockKey(A) }));
    expect(seen).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: lockKey(B) }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'другой' }));
    expect(seen).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: null })); // «очистили всё»
    expect(seen).toHaveBeenCalledTimes(4);
    off();
    writeLock(A, setting);
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it('тихое снятие (при выходе) слушателей не будит', () => {
    writeLock(A, setting);
    const seen = vi.fn();
    const off = subscribeLock(A, seen);
    expect(clearLock(A, true)).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('сломанный слушатель не мешает остальным', () => {
    const good = vi.fn();
    const off1 = subscribeLock(A, () => {
      throw new Error('boom');
    });
    const off2 = subscribeLock(A, good);
    writeLock(A, setting);
    expect(good).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });
});
