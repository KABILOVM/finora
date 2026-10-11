import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultId, getDeviceId, isUuid, newId, uuidV5 } from '@/db';
import { DEVICE_ID_KEY } from '@/db/deviceId';

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('UUID v4, без повторов', () => {
    const ids = Array.from({ length: 200 }, () => newId());
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('работает и без crypto.randomUUID (страница по http в локальной сети)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuid(id)).toBe(true);
  });
});

describe('uuidV5', () => {
  it('совпадает с эталонным значением RFC 4122 (python.org в пространстве DNS)', async () => {
    expect(await uuidV5(DNS_NAMESPACE, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('без crypto.subtle даёт ТОТ ЖЕ результат (запасной SHA-1)', async () => {
    const withSubtle = await Promise.all(['', 'a', 'python.org', 'я'.repeat(100), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)].map((n) => uuidV5(DNS_NAMESPACE, n)));
    vi.stubGlobal('crypto', { randomUUID: () => 'x' });
    const withoutSubtle = await Promise.all(['', 'a', 'python.org', 'я'.repeat(100), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)].map((n) => uuidV5(DNS_NAMESPACE, n)));
    expect(withoutSubtle).toEqual(withSubtle);
  });

  it('версия 5 и вариант RFC в битах', async () => {
    const id = await uuidV5(DNS_NAMESPACE, 'что-угодно');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('некорректное пространство имён — ошибка', async () => {
    await expect(uuidV5('не-uuid', 'x')).rejects.toThrow(/Некорректный UUID/);
  });
});

describe('defaultId', () => {
  it('детерминирован; зависит и от пользователя, и от slug', async () => {
    const a1 = await defaultId('user-1', 'category:food');
    const a2 = await defaultId('user-1', 'category:food');
    const otherUser = await defaultId('user-2', 'category:food');
    const otherSlug = await defaultId('user-1', 'category:groceries');
    expect(a1).toBe(a2);
    expect(new Set([a1, otherUser, otherSlug]).size).toBe(3);
    expect(isUuid(a1)).toBe(true);
  });

  it('значение зафиксировано: id стартовых записей не должны меняться между версиями', async () => {
    // эталон посчитан независимо (python: uuid.uuid5)
    expect(await defaultId('11111111-1111-4111-8111-111111111111', 'category:food')).toBe('533b4a99-2a57-5a18-9e76-cd442d2a3ea1');
    expect(await defaultId('11111111-1111-4111-8111-111111111111', 'wallet:cash')).toBe('dc7521fc-abff-5ffc-ab15-b93484d75f05');
  });
});

describe('getDeviceId', () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it('создаёт при первом обращении и дальше возвращает тот же', () => {
    const st = memoryStorage();
    const id = getDeviceId(st);
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(getDeviceId(st)).toBe(id);
    expect(st.data.get(DEVICE_ID_KEY)).toBe(id);
  });

  it('разные установки (хранилища) получают разные id', () => {
    expect(getDeviceId(memoryStorage())).not.toBe(getDeviceId(memoryStorage()));
  });

  it('испорченное значение заменяется', () => {
    const st = memoryStorage();
    st.data.set(DEVICE_ID_KEY, 'x y');
    const id = getDeviceId(st);
    expect(id).not.toBe('x y');
    expect(getDeviceId(st)).toBe(id);
  });

  it('без хранилища или с хранилищем, которое бросает исключения, id держится в памяти и не меняется', () => {
    const broken = {
      getItem: () => {
        throw new Error('запрещено');
      },
      setItem: () => {
        throw new Error('запрещено');
      },
    };
    const a = getDeviceId(broken);
    expect(getDeviceId(broken)).toBe(a);
    expect(getDeviceId(null)).toBe(a);
  });

  it('по умолчанию использует localStorage', () => {
    localStorage.removeItem(DEVICE_ID_KEY);
    const id = getDeviceId();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(id);
  });
});
