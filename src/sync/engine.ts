import type { Store } from '@/db';
import { META_LAST_SYNCED_AT } from '@/db/database';
import { BISECT_BUDGET, BisectBudgetError, pushAll, type PushCtx } from './pushPhase';
import { UNREADABLE_MESSAGE, pullAll } from './pullPhase';
import { TransportError, type SyncEngineApi, type SyncPhase, type SyncStatus, type SyncTransport } from './transport';

/** Ключ в store.sync.getMeta/setMeta: true после первого успешного полного получения данных с сервера. */
export const META_INITIAL_PULL = 'initialPullDone';

export interface CreateSyncEngineOptions {
  store: Store;
  transport: SyncTransport;
  /**
   * Вызывается ОДИН РАЗ после первого успешного полного получения данных с сервера (до первой отправки).
   * Здесь приложение делает затравку (ensureSeeded): только теперь известно, есть ли у пользователя данные на сервере.
   * Если колбэк бросил ошибку — META_INITIAL_PULL не ставится, при следующем цикле всё повторится.
   */
  afterFirstPull?: () => Promise<void>;
  /** Просьба обновить сессию, когда сервер ответил 'auth'. true — сессия обновлена, цикл можно повторить. */
  onAuthError?: () => Promise<boolean>;
  now?: () => number;
}

export interface SyncEngine extends SyncEngineApi {
  /** Полная остановка: снимает все слушатели и таймеры. После dispose engine использовать нельзя. */
  dispose(): void;
}

/** Почему запущен цикл. Первые четыре обходят паузу после сбоя; остальные ждут своей очереди. */
type Reason = 'start' | 'online' | 'manual' | 'retry' | 'visible' | 'interval' | 'local-change';
const FORCING: ReadonlySet<Reason> = new Set<Reason>(['start', 'online', 'manual', 'retry']);

const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 1_000;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;

/** Движок выключен посреди цикла: цикл тихо обрывается. */
class DisposedSignal extends Error {}
/** Данные с сервера не читаются этой версией приложения. */
class UnreadableSignal extends Error {}

const INITIAL_STATUS: SyncStatus = { phase: 'idle', pending: 0, quarantined: 0, lastSyncedAt: null, lastError: null };

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reasons: Set<Reason>;
}

const defer = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve, reasons: new Set() };
};

const errorText = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : 'Неизвестная ошибка');

export function createSyncEngine(opts: CreateSyncEngineOptions): SyncEngine {
  const { store, transport } = opts;
  const now = opts.now ?? (() => Date.now());

  let status: SyncStatus = INITIAL_STATUS;
  const listeners = new Set<(s: SyncStatus) => void>();
  let started = false;
  let disposed = false;

  /** Идёт цикл (флаг ставится ДО запуска: подписчик статуса может позвать syncNow прямо из колбэка). */
  let running = false;
  let queued: Deferred | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let stopLocalChange: (() => void) | null = null;

  // ---- статус ---------------------------------------------------------------------------------------------------

  function setStatus(patch: Partial<SyncStatus>): void {
    const next = { ...status, ...patch };
    if (
      next.phase === status.phase &&
      next.pending === status.pending &&
      next.quarantined === status.quarantined &&
      next.lastSyncedAt === status.lastSyncedAt &&
      next.lastError === status.lastError
    ) {
      return; // тот же объект, пока ничего не изменилось (иначе useSyncExternalStore зациклится)
    }
    status = next;
    for (const l of [...listeners]) {
      try {
        l(status);
      } catch {
        // ошибка подписчика не должна ломать синхронизацию
      }
    }
  }

  let countsRunning: Promise<void> | null = null;
  let countsAgain = false;
  /** Пересчёт «ждут отправки / в карантине». Одновременно идёт один пересчёт; пришедшие во время него схлопываются в один повторный. */
  function refreshCounts(): Promise<void> {
    if (countsRunning) {
      countsAgain = true;
      return countsRunning;
    }
    countsRunning = (async () => {
      try {
        do {
          countsAgain = false;
          const c = await store.sync.counts();
          if (!disposed) setStatus({ pending: c.pending, quarantined: c.quarantined });
        } while (countsAgain && !disposed);
      } catch {
        // база закрыта или недоступна: счётчики остаются прежними
      } finally {
        countsRunning = null;
      }
    })();
    return countsRunning;
  }

  async function loadSavedStatus(): Promise<void> {
    try {
      const saved = await store.sync.getMeta(META_LAST_SYNCED_AT);
      if (!disposed && typeof saved === 'string' && status.lastSyncedAt === null) setStatus({ lastSyncedAt: saved });
    } catch {
      // нет сохранённого времени — не страшно
    }
    await refreshCounts();
  }

  // ---- цикл -----------------------------------------------------------------------------------------------------

  const browserOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
  const pageVisible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

  function check(): void {
    if (disposed) throw new DisposedSignal();
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /** Повтор после сбоя: 5 с, 10 с, 20 с … до 5 минут. Сбрасывается успехом, возвратом сети и ручным запуском. */
  function scheduleRetry(): void {
    if (!started || disposed || retryTimer !== null) return;
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** attempts, BACKOFF_MAX_MS);
    attempts++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void request('retry');
    }, delay);
  }

  /** Один заход: (первая загрузка + затравка) → отправка → получение. Бросает при любой беде. */
  async function runOnce(ctx: PushCtx): Promise<void> {
    if ((await store.sync.getMeta(META_INITIAL_PULL)) !== true) {
      // Пока не известно, что уже есть на сервере, свои данные не отправляем и не создаём: сначала забираем всё.
      if ((await pullAll(ctx)).unreadable) throw new UnreadableSignal();
      if (opts.afterFirstPull) await opts.afterFirstPull();
      await store.sync.setMeta(META_INITIAL_PULL, true);
    }
    await pushAll(ctx);
    await refreshCounts();
    // Обязательно забираем после отправки: сервер мог оставить свою, более новую версию — принимаем её.
    if ((await pullAll(ctx)).unreadable) throw new UnreadableSignal();
  }

  async function cycle(): Promise<void> {
    if (browserOffline()) {
      setStatus({ phase: 'offline', lastError: null });
      await refreshCounts();
      return;
    }
    setStatus({ phase: 'syncing' });
    let authRetried = false;
    try {
      for (;;) {
        const ctx: PushCtx = { store, transport, check, budget: { left: BISECT_BUDGET } };
        try {
          await runOnce(ctx);
          const stamp = new Date(now()).toISOString();
          try {
            await store.sync.setMeta(META_LAST_SYNCED_AT, stamp);
          } catch {
            // не записалось — покажем время из памяти; на синхронизацию это не влияет
          }
          attempts = 0;
          clearRetry();
          setStatus({ phase: 'idle', lastSyncedAt: stamp, lastError: null });
          return;
        } catch (e) {
          if (e instanceof DisposedSignal || disposed) return;
          if (e instanceof TransportError && e.kind === 'auth') {
            if (!authRetried && opts.onAuthError) {
              authRetried = true;
              let refreshed = false;
              try {
                refreshed = await opts.onAuthError();
              } catch {
                refreshed = false;
              }
              if (refreshed) continue; // сессия обновлена: повторяем цикл один раз
            }
            setStatus({ phase: 'auth-required', lastError: 'Нужно войти заново' });
            return;
          }
          const failure = describeFailure(e);
          setStatus({ phase: failure.phase, lastError: failure.message });
          scheduleRetry();
          return;
        }
      }
    } finally {
      if (!disposed) await refreshCounts();
    }
  }

  function describeFailure(e: unknown): { phase: SyncPhase; message: string } {
    if (e instanceof TransportError && e.kind === 'network') return { phase: 'offline', message: 'Нет связи с сервером' };
    if (e instanceof TransportError && e.kind === 'server') return { phase: 'error', message: 'Сервер временно недоступен' };
    if (e instanceof UnreadableSignal) return { phase: 'error', message: UNREADABLE_MESSAGE };
    if (e instanceof BisectBudgetError) return { phase: 'error', message: e.message };
    if (e instanceof TransportError) return { phase: 'error', message: `Сервер отверг запрос: ${e.message}` };
    return { phase: 'error', message: errorText(e) };
  }

  // ---- запуск циклов: один за раз, лишние запросы схлопываются в один повторный ------------------------------------

  /** Пока идёт пауза после сбоя, «мягкие» причины ждут таймер. При «нужен вход» не дёргаем сервер по кругу, кроме возврата на вкладку. */
  function mayRun(reason: Reason): boolean {
    if (FORCING.has(reason)) return true;
    if (retryTimer !== null) return false;
    if (status.phase === 'auth-required') return reason === 'visible';
    return true;
  }

  async function drain(): Promise<void> {
    try {
      await cycle();
      while (queued && !disposed) {
        const q = queued;
        queued = null;
        if ([...q.reasons].some(mayRun)) await cycle();
        q.resolve();
      }
    } finally {
      running = false;
      if (queued) {
        queued.resolve();
        queued = null;
      }
    }
  }

  function request(reason: Reason): Promise<void> {
    if (disposed) return Promise.resolve();
    if (reason === 'online' || reason === 'manual') {
      attempts = 0;
      clearRetry();
    }
    if (!mayRun(reason)) return Promise.resolve();
    if (running) {
      queued ??= defer();
      queued.reasons.add(reason);
      return queued.promise;
    }
    running = true;
    return drain();
  }

  // ---- триггеры ---------------------------------------------------------------------------------------------------

  const onOnline = (): void => void request('online');
  const onOffline = (): void => {
    if (status.phase !== 'syncing') setStatus({ phase: 'offline', lastError: null });
  };
  const startInterval = (): void => {
    if (intervalTimer === null) intervalTimer = setInterval(() => void request('interval'), INTERVAL_MS);
  };
  const stopInterval = (): void => {
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };
  const onVisibility = (): void => {
    if (pageVisible()) {
      startInterval();
      void request('visible');
    } else {
      stopInterval();
    }
  };
  const onLocalChange = (): void => {
    void refreshCounts();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void request('local-change');
    }, DEBOUNCE_MS);
  };

  async function bootstrap(): Promise<void> {
    try {
      // временные отказы получают второй шанс: снимаем карантин один раз при запуске
      await store.sync.retryQuarantined();
    } catch {
      // не вышло — отправка пойдёт как есть
    }
    await refreshCounts();
    if (started && !disposed) void request('start');
  }

  function start(): void {
    if (started || disposed) return;
    started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    stopLocalChange = store.onLocalChange(onLocalChange);
    if (pageVisible()) startInterval();
    void bootstrap();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    stopLocalChange?.();
    stopLocalChange = null;
    stopInterval();
    clearRetry();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  void loadSavedStatus();

  return {
    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(status);
      } catch {
        // ошибка подписчика не должна ломать синхронизацию
      }
      return () => {
        listeners.delete(listener);
      };
    },

    getStatus: () => status,

    syncNow: () => request('manual'),

    start,
    stop,
    dispose() {
      stop();
      disposed = true;
      listeners.clear();
    },
  };
}
