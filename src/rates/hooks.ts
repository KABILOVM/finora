import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { CurrencyCode, IsoDateTime } from '@/domain/types';
import type { RateLookup, RateService, RateServiceStatus, RefreshResult } from './types';

/** Автообновление не чаще, чем раз в столько после последнего УСПЕШНОГО обновления. */
export const AUTO_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Защита от долбёжки: при запуске не повторяем попытку, если прошлая была меньше минуты назад (двойной монтаж в StrictMode). */
export const MIN_RETRY_INTERVAL_MS = 60 * 1000;

export type AutoRefreshTrigger = 'mount' | 'online';

function ageMs(iso: IsoDateTime | null, nowMs: number): number | null {
  const t = iso === null ? NaN : Date.parse(iso);
  const age = nowMs - t;
  // часы, уехавшие назад (метка «из будущего»), не должны блокировать обновление
  return Number.isFinite(age) && age >= 0 ? age : null;
}

/**
 * Нужно ли обновлять курсы сейчас. Правило одно для запуска и для события online: если последнее УСПЕШНОЕ обновление было
 * меньше 6 часов назад — не нужно. Дополнительно при запуске не повторяем попытку чаще раза в минуту.
 */
export function shouldAutoRefresh(status: RateServiceStatus, nowMs: number, trigger: AutoRefreshTrigger): boolean {
  const sinceSuccess = ageMs(status.lastRefreshAt, nowMs);
  if (sinceSuccess !== null && sinceSuccess < AUTO_REFRESH_INTERVAL_MS) return false;
  if (trigger === 'mount') {
    const sinceAttempt = ageMs(status.lastAttemptAt, nowMs);
    if (sinceAttempt !== null && sinceAttempt < MIN_RETRY_INTERVAL_MS) return false;
  }
  return true;
}

interface RatesContextValue {
  service: RateService;
  refresh: () => Promise<RefreshResult>;
  refreshing: boolean;
  /** Растёт при любом изменении курсов или статуса — чтобы потребители пересчитались. */
  version: number;
}

const RatesContext = createContext<RatesContextValue | null>(null);

export interface RateServiceProviderProps {
  service: RateService;
  /** false — не обновлять само (для тестов и экранов без сети). */
  autoRefresh?: boolean;
  children?: ReactNode;
}

export function RateServiceProvider({ service, autoRefresh = true, children }: RateServiceProviderProps): ReactElement {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(0);

  useEffect(() => service.subscribe(() => setVersion((v) => v + 1)), [service]);

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    setActive((n) => n + 1);
    try {
      return await service.refresh();
    } finally {
      setActive((n) => n - 1);
    }
  }, [service]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const run = (trigger: AutoRefreshTrigger): void => {
      if (shouldAutoRefresh(service.getStatus(), Date.now(), trigger)) void refresh();
    };
    run('mount');
    const onOnline = (): void => run('online');
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [service, autoRefresh, refresh]);

  const value = useMemo<RatesContextValue>(
    () => ({ service, refresh, refreshing: active > 0, version }),
    [service, refresh, active, version],
  );
  return createElement(RatesContext.Provider, { value }, children);
}

function useRatesContext(): RatesContextValue {
  const ctx = useContext(RatesContext);
  if (!ctx) throw new Error('Курсы валют: оберни приложение в <RateServiceProvider service={...}>');
  return ctx;
}

export interface UseRates {
  /** Меняет identity при любом обновлении курсов — безопасно класть в зависимости useMemo/useEffect. */
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null;
  refresh: () => Promise<RefreshResult>;
  refreshing: boolean;
  lastRefreshAt: IsoDateTime | null;
  lastError: string | null;
}

export function useRates(): UseRates {
  const { service, refresh, refreshing, version } = useRatesContext();
  // version нужен только как зависимость: после обновления курсов getRate получает новую identity
  const getRate = useCallback((from: CurrencyCode, to: CurrencyCode) => service.getRate(from, to), [service, version]);
  const status = service.getStatus();
  return { getRate, refresh, refreshing, lastRefreshAt: status.lastRefreshAt, lastError: status.lastError };
}

/** Сам сервис — для ручных курсов (setManualRate / clearManualRate) и списка известных валют. */
export function useRateService(): RateService {
  return useRatesContext().service;
}
