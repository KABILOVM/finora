import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '@/db';
import type { Store } from '@/db';
import { mount, renderHook } from './__fixtures__/reactTestkit';
import { NOW, makeTable, ok, stubProvider } from './__fixtures__/testkit';
import { RateServiceProvider, useRateService, useRates } from './hooks';
import { createRateService } from './service';
import { createMemoryRateStorage } from './storage';
import type { RateService, RateStorage } from './types';

/**
 * Ручные курсы по пользователям. На общем телефоне свой курс одного человека не становится курсом другого;
 * автоматические курсы общие; старые ручные курсы (до появления пользователей) остаются у того, кто открыл приложение первым.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const SET_AT = '2026-10-01T08:00:00.000Z';

/** «Сеанс» пользователя: новый сервис на общем хранилище устройства, как после перезагрузки или входа другого человека. */
function session(storage: RateStorage, userId?: string, providers = [stubProvider('nbt', ok())]): RateService {
  const service = createRateService({ providers, storage, now: () => NOW });
  if (userId !== undefined) service.bindUser?.(userId);
  return service;
}

/** Документ хранилища в прежнем формате: только общие ручные курсы, без manualByUser. */
const legacyDoc = (manual: Record<string, { rate: number; setAt: string }>) => ({
  v: 1,
  tables: [],
  manual,
  lastRefreshAt: null,
  lastAttemptAt: null,
  lastError: null,
});

const stored = (storage: RateStorage) => storage.get() as { manual: Record<string, unknown>; manualByUser?: Record<string, Record<string, { rate: number }>> };

describe('ручные курсы: у каждого пользователя свои', () => {
  it('курс Алисы не становится курсом Боба на общем телефоне, и наоборот', () => {
    const storage = createMemoryRateStorage();
    const alice = session(storage, ALICE);
    alice.setManualRate('USD', 'TJS', 11);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 11, manual: true, source: 'manual' });

    const bob = session(storage, BOB);
    expect(bob.getRate('USD', 'TJS')).toBeNull(); // автоматических курсов нет, чужого ручного — тоже
    bob.setManualRate('USD', 'TJS', 12);
    expect(bob.getRate('USD', 'TJS')).toMatchObject({ rate: 12, manual: true });

    // «Перезагрузка»: каждый видит своё
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ rate: 11, manual: true });
    expect(session(storage, BOB).getRate('USD', 'TJS')).toMatchObject({ rate: 12, manual: true });
  });

  it('ключ хранения включает id пользователя; «общая» корзина остаётся пустой', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).setManualRate('USD', 'TJS', 11);
    session(storage, BOB).setManualRate('EUR', 'TJS', 12.5);
    const doc = stored(storage);
    expect(doc.manual).toEqual({});
    expect(Object.keys(doc.manualByUser ?? {}).sort()).toEqual([ALICE, BOB]);
    expect(doc.manualByUser?.[ALICE]?.['USD>TJS']?.rate).toBe(11);
    expect(doc.manualByUser?.[BOB]?.['EUR>TJS']?.rate).toBe(12.5);
  });

  it('автоматические курсы остаются общими: Боб видит курс Нацбанка, полученный сеансом Алисы', async () => {
    const storage = createMemoryRateStorage();
    const alice = session(storage, ALICE);
    await alice.refresh();
    alice.setManualRate('EUR', 'TJS', 13);
    const bob = session(storage, BOB, []);
    expect(bob.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, source: 'nbt', manual: false });
    expect(bob.getRate('EUR', 'TJS')).toMatchObject({ rate: 12.78, source: 'nbt', manual: false }); // не 13 Алисы
    expect(alice.getRate('EUR', 'TJS')).toMatchObject({ rate: 13, manual: true });
  });

  it('«Убрать свой курс» убирает только свой; у другого остаётся', () => {
    const storage = createMemoryRateStorage();
    const alice = session(storage, ALICE);
    const bob = session(storage, BOB);
    alice.setManualRate('USD', 'TJS', 11);
    bob.setManualRate('USD', 'TJS', 12);
    alice.clearManualRate('USD', 'TJS');
    expect(alice.getRate('USD', 'TJS')).toBeNull();
    expect(bob.getRate('USD', 'TJS')).toMatchObject({ rate: 12, manual: true });
    expect(session(storage, BOB).getRate('USD', 'TJS')).toMatchObject({ rate: 12 });
    // пустая корзина Алисы не хранится
    expect(Object.keys(stored(storage).manualByUser ?? {})).toEqual([BOB]);
    // повторное удаление безопасно
    expect(() => alice.clearManualRate('USD', 'TJS')).not.toThrow();
  });

  it('список известных валют включает только ручные курсы своего пользователя', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).setManualRate('GBP', 'TJS', 14);
    expect(session(storage, ALICE, []).listKnownCurrencies()).toEqual(['GBP', 'TJS']);
    expect(session(storage, BOB, []).listKnownCurrencies()).toEqual([]);
  });

  it('две вкладки с разными людьми одновременно не затирают курсы друг друга', async () => {
    const storage = createMemoryRateStorage();
    const tabA = session(storage, ALICE);
    const tabB = session(storage, BOB);
    tabA.setManualRate('USD', 'TJS', 11);
    tabB.setManualRate('USD', 'TJS', 12);
    await tabA.refresh(); // запись всего документа вкладкой А после записи Боба
    tabA.setManualRate('EUR', 'TJS', 13);
    const doc = stored(storage);
    expect(doc.manualByUser?.[ALICE]).toMatchObject({ 'USD>TJS': { rate: 11 }, 'EUR>TJS': { rate: 13 } });
    expect(doc.manualByUser?.[BOB]).toMatchObject({ 'USD>TJS': { rate: 12 } });
  });

  it('сервис без названного пользователя работает как раньше (общая корзина)', () => {
    const storage = createMemoryRateStorage();
    const anon = session(storage);
    anon.setManualRate('USD', 'TJS', 10.5);
    expect(anon.getRate('USD', 'TJS')).toMatchObject({ rate: 10.5, manual: true });
    expect(stored(storage).manual['USD>TJS']).toMatchObject({ rate: 10.5 });
    expect(stored(storage).manualByUser ?? {}).toEqual({});
  });
});

describe('миграция: старые ручные курсы достаются тому, кто открыл приложение первым', () => {
  const OLD = { 'USD>TJS': { rate: 11.5, setAt: SET_AT }, 'EUR>TJS': { rate: 12.9, setAt: SET_AT } };

  it('до привязки старые курсы видны (ничего не пропало); первый пользователь забирает их себе, второй их не видит', () => {
    const storage = createMemoryRateStorage(legacyDoc(OLD));
    expect(session(storage).getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });

    const first = session(storage, ALICE);
    expect(first.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });
    expect(first.getRate('EUR', 'TJS')).toMatchObject({ rate: 12.9, manual: true });
    expect(stored(storage).manual).toEqual({}); // общих больше нет: курсы переехали
    expect(Object.keys(stored(storage).manualByUser ?? {})).toEqual([ALICE]);

    const second = session(storage, BOB);
    expect(second.getRate('USD', 'TJS')).toBeNull();
    expect(second.getRate('EUR', 'TJS')).toBeNull();
    // Алиса после перезагрузки по-прежнему всё видит
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ rate: 11.5 });
  });

  it('значение, даты и пары переезжают без искажений (метка setAt сохранена)', () => {
    const storage = createMemoryRateStorage(legacyDoc(OLD));
    session(storage, ALICE);
    expect(stored(storage).manualByUser?.[ALICE]).toEqual(OLD);
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ asOf: '2026-10-01' });
  });

  it('если у пользователя уже есть свой курс той же пары, свой побеждает, чужие пары добираются', () => {
    const storage = createMemoryRateStorage({
      ...legacyDoc(OLD),
      manualByUser: { [ALICE]: { 'USD>TJS': { rate: 99, setAt: SET_AT } } },
    });
    const alice = session(storage, ALICE);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 99 });
    expect(alice.getRate('EUR', 'TJS')).toMatchObject({ rate: 12.9 });
  });

  it('повторная привязка того же пользователя ничего не меняет и не пишет лишнего', () => {
    const storage = createMemoryRateStorage(legacyDoc(OLD));
    const alice = session(storage, ALICE);
    const before = JSON.stringify(storage.get());
    alice.bindUser?.(ALICE);
    expect(JSON.stringify(storage.get())).toBe(before);
  });

  it('хранилище без доступа на запись: курс остаётся в памяти этого сеанса, а не пропадает', () => {
    const base = createMemoryRateStorage(legacyDoc(OLD));
    const broken: RateStorage = {
      get: () => base.get(),
      set: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const alice = session(broken, ALICE);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });
  });
});

describe('привязка пользователя: границы', () => {
  it.each(['', ' ', '\t', 'a\nb', 'x\u0000', 'x'.repeat(129)])('некорректный id %j → RangeError, ничего не меняется', (id) => {
    const storage = createMemoryRateStorage(legacyDoc({ 'USD>TJS': { rate: 11.5, setAt: SET_AT } }));
    const service = session(storage);
    expect(() => service.bindUser?.(id)).toThrow(RangeError);
    expect(stored(storage).manual['USD>TJS']).toBeDefined(); // старые курсы не уехали никуда
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5 });
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'user@example.com', 'с кириллицей и пробелом', 'x'.repeat(128)])('id «%s» — обычный пользователь, прототип не подменяется', (id) => {
    const storage = createMemoryRateStorage();
    const s = session(storage, id);
    expect(s.getRate('USD', 'TJS')).toBeNull();
    s.setManualRate('USD', 'TJS', 11);
    expect(session(storage, id).getRate('USD', 'TJS')).toMatchObject({ rate: 11 });
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toBeNull();
    expect(({} as Record<string, unknown>)['USD>TJS']).toBeUndefined();
  });

  it('мусор в manualByUser отбрасывается, нормальное остаётся', () => {
    const storage = createMemoryRateStorage({
      ...legacyDoc({}),
      manualByUser: {
        [ALICE]: { 'USD>TJS': { rate: 11, setAt: SET_AT }, 'USD>USD': { rate: 1, setAt: SET_AT }, 'eur>tjs': { rate: 5, setAt: SET_AT }, 'GBP>TJS': { rate: -3, setAt: SET_AT }, 'KZT>TJS': { rate: 0.02, setAt: 'вчера' } },
        '': { 'USD>TJS': { rate: 7, setAt: SET_AT } },
        '\u0001x': { 'USD>TJS': { rate: 8, setAt: SET_AT } },
        [BOB]: [1, 2, 3],
      },
    });
    const alice = session(storage, ALICE);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 11 });
    expect(alice.getRate('GBP', 'TJS')).toBeNull();
    expect(alice.getRate('KZT', 'TJS')).toBeNull();
    expect(session(storage, BOB).getRate('USD', 'TJS')).toBeNull();
    alice.setManualRate('EUR', 'TJS', 13); // любая запись переписывает документ уже очищенным
    expect(Object.keys(stored(storage).manualByUser ?? {})).toEqual([ALICE]);
  });

  it('документ от версии без manualByUser читается; запись новой версии не ломает ему «ничьи» курсы других форматов', () => {
    const storage = createMemoryRateStorage({ v: 1, tables: [makeTable()], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null });
    const alice = session(storage, ALICE, []);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, manual: false });
    alice.setManualRate('USD', 'TJS', 11);
    const doc = stored(storage) as unknown as { v: number; tables: unknown[] };
    expect(doc.v).toBe(1);
    expect(doc.tables).toHaveLength(1);
  });
});

describe('RateServiceProvider привязывает ручные курсы к владельцу локальной базы', () => {
  const fakeStore = (userId: string) => ({ userId }) as unknown as Store;
  /** Обёртка «приложение»: база пользователя + провайдер курсов (как в UserSession). */
  const inStore = (service: RateService, userId: string) =>
    function Wrapper({ children }: { children?: ReactNode }) {
      return createElement(StoreProvider, { store: fakeStore(userId) }, createElement(RateServiceProvider, { service, autoRefresh: false }, children));
    };

  it('в сеансе Боба курс Алисы не виден уже в самом первом кадре, а свой ручной курс сохраняется за Бобом', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).setManualRate('USD', 'TJS', 11);

    const service = session(storage); // сервис создан без пользователя, как делает приложение (deps.createRates)
    const seen: (number | null)[] = [];
    const { result } = renderHook(
      () => {
        const rates = useRates();
        seen.push(rates.getRate('USD', 'TJS')?.rate ?? null);
        return { rates, svc: useRateService() };
      },
      { wrapper: inStore(service, BOB) },
    );
    expect(seen[0]).toBeNull(); // первый же кадр без чужого курса
    expect(seen.every((v) => v === null)).toBe(true);
    result.current.svc.setManualRate('USD', 'TJS', 12);
    expect(stored(storage).manualByUser?.[BOB]?.['USD>TJS']?.rate).toBe(12);
    expect(stored(storage).manualByUser?.[ALICE]?.['USD>TJS']?.rate).toBe(11);
  });

  it('в сеансе Алисы её курс виден с первого кадра', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).setManualRate('USD', 'TJS', 11);
    const seen: (number | null)[] = [];
    renderHook(
      () => {
        seen.push(useRates().getRate('USD', 'TJS')?.rate ?? null);
        return null;
      },
      { wrapper: inStore(session(storage), ALICE) },
    );
    expect(seen[0]).toBe(11);
  });

  it('prop userId сильнее базы; без базы и без userId ручные курсы остаются общими (как раньше)', () => {
    const storage = createMemoryRateStorage();
    const service = session(storage);
    mount(createElement(RateServiceProvider, { service, autoRefresh: false, userId: ALICE }));
    service.setManualRate('USD', 'TJS', 11);
    expect(stored(storage).manualByUser?.[ALICE]?.['USD>TJS']?.rate).toBe(11);

    const storage2 = createMemoryRateStorage();
    const service2 = session(storage2);
    mount(createElement(RateServiceProvider, { service: service2, autoRefresh: false }));
    service2.setManualRate('USD', 'TJS', 10);
    expect(stored(storage2).manual['USD>TJS']).toMatchObject({ rate: 10 });
  });

  it('подставной сервис без bindUser не ломает провайдер', () => {
    const real = session(createMemoryRateStorage());
    const fake: RateService = {
      refresh: real.refresh,
      getRate: real.getRate,
      setManualRate: real.setManualRate,
      clearManualRate: real.clearManualRate,
      listKnownCurrencies: real.listKnownCurrencies,
      getStatus: real.getStatus,
      subscribe: real.subscribe,
    };
    const { result } = renderHook(() => useRates(), { wrapper: inStore(fake, ALICE) });
    expect(result.current.getRate('USD', 'TJS')).toBeNull();
  });

  it('некорректный id владельца не роняет приложение: ошибка в консоль, курсы остаются общими', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { result } = renderHook(() => useRates(), { wrapper: inStore(session(createMemoryRateStorage()), '') });
      expect(result.current.getRate('USD', 'TJS')).toBeNull();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
