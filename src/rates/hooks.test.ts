import { StrictMode, createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { RateTable } from '@/domain/types';
import { act, mount, renderHook, waitFor } from './__fixtures__/reactTestkit';
import { makeTable, stubProvider } from './__fixtures__/testkit';
import {
  AUTO_REFRESH_INTERVAL_MS,
  MIN_RETRY_INTERVAL_MS,
  RateServiceProvider,
  shouldAutoRefresh,
  useRateService,
  useRates,
} from './hooks';
import { createRateService } from './service';
import { createMemoryRateStorage } from './storage';
import type { RateProvider, RateService, RateServiceStatus } from './types';

const HOUR = 3_600_000;
const NOW_MS = Date.parse('2026-10-10T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW_MS - msAgo).toISOString();
const status = (success: number | null, attempt: number | null, lastError: string | null = null): RateServiceStatus => ({
  lastRefreshAt: success === null ? null : iso(success),
  lastAttemptAt: attempt === null ? null : iso(attempt),
  lastError,
});

describe('shouldAutoRefresh', () => {
  it('константы: 6 часов и минута', () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(6 * HOUR);
    expect(MIN_RETRY_INTERVAL_MS).toBe(60_000);
  });

  it.each([
    ['ни разу не обновлялись', status(null, null), true, true],
    ['успех час назад', status(HOUR, HOUR), false, false],
    ['успех 5 ч 59 мин назад', status(6 * HOUR - 60_000, 6 * HOUR - 60_000), false, false],
    ['успех ровно 6 часов назад', status(6 * HOUR, 6 * HOUR), true, true],
    ['успех 7 часов назад, попытка 10 секунд назад: при запуске не долбим, по online — пробуем', status(7 * HOUR, 10_000), false, true],
    ['успеха не было, неудачная попытка 61 секунду назад', status(null, 61_000), true, true],
    ['успеха не было, попытка 5 секунд назад', status(null, 5_000), false, true],
    ['метка успеха «из будущего» (часы откатили) не блокирует обновление', status(-5 * HOUR, null), true, true],
    ['мусор в метках', { lastRefreshAt: 'давно', lastAttemptAt: 'вчера', lastError: null }, true, true],
  ])('%s', (_n, st, mount, online) => {
    expect(shouldAutoRefresh(st, NOW_MS, 'mount')).toBe(mount);
    expect(shouldAutoRefresh(st, NOW_MS, 'online')).toBe(online);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Сервис, чьё «сейчас» сдвинуто на msAgo назад — чтобы подготовить «последнее обновление было N часов назад». */
function seededStorage(msAgo: number) {
  const storage = createMemoryRateStorage();
  const seed = createRateService({
    providers: [stubProvider('nbt', () => makeTable())],
    storage,
    now: () => new Date(Date.now() - msAgo),
  });
  return seed.refresh().then(() => storage);
}

function serviceWith(provider: RateProvider, storage = createMemoryRateStorage()): RateService {
  return createRateService({ providers: [provider], storage });
}

function wrapper(service: RateService, props: { autoRefresh?: boolean; strict?: boolean } = {}) {
  return ({ children }: { children?: ReactNode }) => {
    const inner = createElement(RateServiceProvider, { service, autoRefresh: props.autoRefresh }, children);
    return props.strict ? createElement(StrictMode, null, inner) : inner;
  };
}

describe('RateServiceProvider: автообновление', () => {
  it('при монтировании без свежих курсов обновляет сам; refreshing включается и выключается; интерфейс получает курсы', async () => {
    const gate = deferred<RateTable>();
    const p = stubProvider('nbt', () => gate.promise);
    const service = serviceWith(p);
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(service) });
    expect(p.calls).toBe(1);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.getRate('USD', 'TJS')).toBeNull();
    expect(result.current.lastRefreshAt).toBeNull();

    await act(async () => gate.resolve(makeTable()));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, source: 'nbt' });
    expect(result.current.lastRefreshAt).not.toBeNull();
    expect(result.current.lastError).toBeNull();
  });

  it('свежие курсы (обновлены час назад) при монтировании не перезапрашиваются', async () => {
    const storage = await seededStorage(HOUR);
    const p = stubProvider('nbt', () => makeTable());
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p, storage)) });
    expect(p.calls).toBe(0);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.getRate('USD', 'TJS')?.rate).toBe(10.95); // курсы из хранилища видны сразу
  });

  it('курсы старше шести часов при монтировании обновляются', async () => {
    const storage = await seededStorage(7 * HOUR);
    const p = stubProvider('nbt', () => makeTable({ perUnit: { TJS: 1, USD: 11, EUR: 12.78 } }));
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p, storage)) });
    expect(p.calls).toBe(1);
    await waitFor(() => expect(result.current.getRate('USD', 'TJS')?.rate).toBe(11));
  });

  it('StrictMode (двойной запуск эффектов) даёт один запрос', async () => {
    const p = stubProvider('nbt', () => makeTable());
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p), { strict: true }) });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(p.calls).toBe(1);
  });

  it('событие online запускает обновление, если успешного обновления не было / оно старое; свежие курсы не трогает', async () => {
    let failing = true;
    const p = stubProvider('nbt', () => {
      if (failing) throw new TypeError('Failed to fetch');
      return makeTable();
    });
    const service = serviceWith(p);
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(service) });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(p.calls).toBe(1); // запуск без сети
    expect(result.current.lastError).toMatch(/Не удалось обновить курсы/);

    failing = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.lastRefreshAt).not.toBeNull());
    expect(p.calls).toBe(2);
    expect(result.current.lastError).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(p.calls).toBe(2); // уже свежо
  });

  it('после размонтирования слушатель online снят', async () => {
    const p = stubProvider('nbt', () => {
      throw new Error('нет сети');
    });
    const { unmount, result } = renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p)) });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    unmount();
    window.dispatchEvent(new Event('online'));
    expect(p.calls).toBe(1);
  });

  it('autoRefresh={false}: ни при запуске, ни по online', async () => {
    const p = stubProvider('nbt', () => makeTable());
    renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p), { autoRefresh: false }) });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(p.calls).toBe(0);
  });
});

describe('useRates', () => {
  it('вне провайдера — понятная ошибка', () => {
    const spy = console.error;
    const swallow = (e: Event) => e.preventDefault(); // иначе jsdom печатает ожидаемую ошибку в консоль
    console.error = () => {};
    window.addEventListener('error', swallow);
    try {
      expect(() => renderHook(() => useRates())).toThrow(/RateServiceProvider/);
      expect(() => renderHook(() => useRateService())).toThrow(/RateServiceProvider/);
    } finally {
      console.error = spy;
      window.removeEventListener('error', swallow);
    }
  });

  it('ручное обновление возвращает результат и переключает refreshing', async () => {
    const gate = deferred<RateTable>();
    const p = stubProvider('nbt', () => gate.promise);
    const { result } = renderHook(() => useRates(), { wrapper: wrapper(serviceWith(p), { autoRefresh: false }) });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      gate.resolve(makeTable());
      await pending;
    });
    expect(result.current.refreshing).toBe(false);
    await expect(pending).resolves.toMatchObject({ ok: true, providerId: 'nbt' });
  });

  it('при смене курсов getRate получает новую identity (безопасно для useMemo), без смены — прежнюю', async () => {
    const service = serviceWith(stubProvider('nbt', () => makeTable()));
    const { result, rerender } = renderHook(() => useRates(), { wrapper: wrapper(service, { autoRefresh: false }) });
    const before = result.current.getRate;
    rerender();
    expect(result.current.getRate).toBe(before);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.getRate).not.toBe(before);
  });

  it('ручной курс через useRateService сразу виден в useRates', () => {
    const service = serviceWith(stubProvider('nbt', () => makeTable()));
    const { result } = renderHook(() => ({ rates: useRates(), svc: useRateService() }), { wrapper: wrapper(service, { autoRefresh: false }) });
    expect(result.current.svc).toBe(service);
    expect(result.current.rates.getRate('USD', 'TJS')).toBeNull();
    act(() => result.current.svc.setManualRate('USD', 'TJS', 10.5));
    expect(result.current.rates.getRate('USD', 'TJS')).toMatchObject({ rate: 10.5, manual: true });
    act(() => result.current.svc.clearManualRate('USD', 'TJS'));
    expect(result.current.rates.getRate('USD', 'TJS')).toBeNull();
  });

  it('потребитель в дереве перерисовывается после обновления', async () => {
    const service = serviceWith(stubProvider('nbt', () => makeTable()));
    function Probe() {
      const { getRate } = useRates();
      return createElement('span', { 'data-testid': 'rate' }, String(getRate('USD', 'TJS')?.rate ?? 'нет'));
    }
    const { container } = mount(createElement(RateServiceProvider, { service }, createElement(Probe)));
    await waitFor(() => expect(container.querySelector('[data-testid="rate"]')?.textContent).toBe('10.95'));
  });
});
