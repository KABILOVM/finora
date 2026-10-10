import type { CurrencyCode, RateTable } from '@/domain/types';
import { isValidCurrencyCode } from '@/domain/currency';
import { pickRate } from '@/domain/rates';
import { MAX_PER_UNIT, MIN_PER_UNIT, boundWarnings, daysBetween, isFutureDate, isRateValue, isoDateOf } from './parseUtil';
import { assessRateTable, pickComparable, withoutCodes } from './sanity';
import { cleanTable, emptyState, isStoredState, mergeTables, normalizeStored, pairKey, putTable, serializeState, stamp, type RatesState } from './state';
import type { FailureKind, ProviderFailure, RateLookup, RateProvider, RateService, RateServiceStatus, RateStorage, RefreshResult } from './types';

/** Курс старше стольких календарных суток считается устаревшим (в пятницу-воскресенье курс «живёт» до вторника). */
export const STALE_AFTER_DAYS = 3;
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export interface RateServiceOptions {
  /** Порядок опроса = порядок в массиве: обычно server → nbt → api. */
  providers: readonly RateProvider[];
  storage: RateStorage;
  now?: () => Date;
  /** Лимит времени НА КАЖДОГО провайдера. */
  fetchTimeoutMs?: number;
}

class TimeoutFailure extends Error {}
class AbortFailure extends Error {}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message || e.name : String(e);
  // fetch без сети в браузере бросает TypeError('Failed to fetch') / ('Load failed') — переводим на человеческий
  return (e instanceof TypeError ? `нет связи (${msg})` : msg).slice(0, 300);
}

function warningsOf(table: unknown): string[] {
  const w = (table as { warnings?: unknown } | null)?.warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
}

/** Более ранние таблицы, которые провайдер приложил к главной (RateTableWithEarlier); мусор отбрасывается. */
function earlierOf(table: unknown): RateTable[] {
  const e = (table as { earlier?: unknown } | null)?.earlier;
  return Array.isArray(e) ? (e as unknown[]).filter((t): t is RateTable => typeof (t as RateTable | null)?.source === 'string' && assessRateTable(t as RateTable).ok) : [];
}

const normCode = (c: unknown): CurrencyCode => (typeof c === 'string' ? c.trim().toUpperCase() : '');

/** Одна общая работа «обновить курсы» и число тех, кто её ещё ждёт (работа отменяется, только когда не ждёт никто). */
interface RefreshJob {
  ctrl: AbortController;
  waiters: number;
  promise: Promise<RefreshResult>;
}

const abortedResult = (): RefreshResult => ({ ok: false, providerId: null, table: null, failures: [], warnings: [], aborted: true });

export function createRateService(options: RateServiceOptions): RateService {
  const { providers, storage } = options;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const listeners = new Set<() => void>();
  let inflight: RefreshJob | null = null;
  let detachStorage: (() => void) | null = null;
  // true, если последняя запись в хранилище не удалась: в памяти есть то, чего там нет, и хранилище не должно это затирать
  let unsaved = false;

  let state: RatesState;
  try {
    state = normalizeStored(storage.get());
  } catch {
    state = emptyState(); // хранилище сломано — начинаем с пустого, сеть подтянет курсы
  }
  // таблица «из будущего» (часы устройства были неверны) заблокировала бы все нормальные обновления как «старые»
  const dropFuture = (tables: RateTable[]): RateTable[] => tables.filter((t) => !isFutureDate(t.asOf, now()));
  state.tables = dropFuture(state.tables);

  function notify(): void {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // один сломанный слушатель не должен мешать остальным
      }
    }
  }

  /** Документ из хранилища; null — там пусто, мусор или оно сломано (тогда верим памяти). */
  function readStored(): RatesState | null {
    try {
      const raw = storage.get();
      return isStoredState(raw) ? normalizeStored(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Подтянуть то, что записали другие вкладки. Таблицы объединяются; ручные курсы и статус берутся из хранилища: оно не старее
   * памяти, потому что каждая наша запись (commit) сначала читает его. Иначе вкладка со старым состоянием затирала бы чужой
   * ручной курс и воскрешала удалённый.
   */
  function pull(): void {
    const stored = readStored();
    if (!stored) return;
    state.tables = dropFuture(mergeTables(state.tables, stored.tables));
    if (!unsaved) state.manual = stored.manual;
    if (stamp(stored.lastAttemptAt) > stamp(state.lastAttemptAt)) {
      state.lastAttemptAt = stored.lastAttemptAt;
      state.lastError = stored.lastError;
    }
    if (stamp(stored.lastRefreshAt) > stamp(state.lastRefreshAt)) state.lastRefreshAt = stored.lastRefreshAt;
  }

  /** Читать свежее из хранилища → применить СВОЁ изменение → записать. Чужие изменения при этом не теряются. */
  function commit(change: () => void): void {
    pull();
    change();
    try {
      storage.set(serializeState(state));
      unsaved = false;
    } catch {
      unsaved = true; // не вышло записать — курсы остаются в памяти до перезагрузки
    }
  }

  /** Вызов провайдера с лимитом времени и отменой. Провайдер, игнорирующий signal, всё равно не повиснет. */
  function callProvider(provider: RateProvider, outer?: AbortSignal): Promise<RateTable> {
    return new Promise<RateTable>((resolve, reject) => {
      const ctrl = new AbortController();
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuterAbort);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          ctrl.abort();
          reject(new TimeoutFailure(`нет ответа за ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} с` : `${timeoutMs} мс`}`));
        });
      }, timeoutMs);
      function onOuterAbort(): void {
        finish(() => {
          ctrl.abort();
          reject(new AbortFailure('отменено'));
        });
      }
      outer?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        Promise.resolve(provider.fetchLatest(ctrl.signal, { timeoutMs })).then(
          (v) => finish(() => resolve(v)),
          (e: unknown) => finish(() => reject(e)),
        );
      } catch (e) {
        finish(() => reject(e));
      }
    });
  }

  async function runRefresh(signal?: AbortSignal): Promise<RefreshResult> {
    const failures: ProviderFailure[] = [];
    const warnings: string[] = [];
    let aborted = false;
    let winner: { providerId: string; table: RateTable; earlier: RateTable[] } | null = null;
    pull(); // сначала узнаём, что успели сохранить другие вкладки: иначе «свежесть» проверялась бы по устаревшей памяти
    const attemptAt = now().toISOString();
    state.lastAttemptAt = attemptAt;

    for (const provider of providers) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      let fetched: RateTable;
      try {
        fetched = await callProvider(provider, signal);
      } catch (e) {
        const kind: FailureKind = e instanceof TimeoutFailure ? 'timeout' : e instanceof AbortFailure ? 'aborted' : 'error';
        failures.push({ providerId: provider.id, kind, message: describeError(e) });
        if (kind === 'aborted') {
          aborted = true;
          break;
        }
        continue;
      }

      const latest = state.tables[0] ?? null;
      // сравниваем с таблицей, где есть та же опорная валюта: свежая таблица без TJS не видит ошибку в курсе сомони
      const verdict = assessRateTable(fetched, pickComparable(fetched, state.tables));
      if (!verdict.ok) {
        const why = verdict.reasons.join('; ');
        failures.push({ providerId: provider.id, kind: 'rejected', message: why });
        warnings.push(`Курсы от «${provider.id}» выглядят подозрительно и не приняты, оставлены прежние: ${why}`);
        continue;
      }
      if (isFutureDate(fetched.asOf, now())) {
        const why = `дата курсов ${fetched.asOf} из будущего (проверьте дату на устройстве)`;
        failures.push({ providerId: provider.id, kind: 'rejected', message: why });
        warnings.push(`Курсы от «${provider.id}» не приняты: ${why}`);
        continue;
      }
      if (latest && fetched.asOf < latest.asOf) {
        failures.push({ providerId: provider.id, kind: 'outdated', message: `курсы на ${fetched.asOf} старее сохранённых на ${latest.asOf}` });
        continue;
      }
      warnings.push(...warningsOf(fetched));
      let accepted: RateTable = fetched;
      if (verdict.excluded) {
        // скачок только у валют, которых нет в списке приложения: их не принимаем (прежние курсы остаются), остальные — да
        accepted = withoutCodes(fetched, verdict.excluded);
        warnings.push(`Курсы валют ${verdict.excluded.join(', ')} от «${provider.id}» не приняты, оставлены прежние: ${verdict.reasons.join('; ')}`);
      }
      // более ранние таблицы провайдера — только действительно более ранние и не из будущего
      const earlier = earlierOf(fetched)
        .filter((t) => t.asOf < accepted.asOf && !isFutureDate(t.asOf, now()))
        .map(cleanTable);
      winner = { providerId: provider.id, table: cleanTable(accepted), earlier };
      break;
    }

    const won = winner;
    commit(() => {
      state.lastAttemptAt = attemptAt;
      if (won) {
        for (const t of [...won.earlier, won.table]) state.tables = putTable(state.tables, t);
        state.lastRefreshAt = now().toISOString();
        state.lastError = null;
      } else if (!aborted) {
        state.lastError =
          providers.length === 0
            ? 'Не настроено ни одного источника курсов'
            : `Не удалось обновить курсы: ${failures.map((f) => `${f.providerId} — ${f.message}`).join('; ')}`.slice(0, 600);
      }
    });
    return {
      ok: won !== null,
      providerId: won?.providerId ?? null,
      table: won?.table ?? null,
      failures,
      warnings: boundWarnings(warnings),
      aborted,
    };
  }

  /**
   * Записывает вызывающего в ожидающие общей работы. Без signal он не отменит её никогда; с signal — отменит, только если
   * после его ухода ждать больше некому. Иначе отмена одного вызова обрывала бы обновление, которое просил другой.
   */
  function join(job: RefreshJob, signal?: AbortSignal): Promise<RefreshResult> {
    job.waiters++;
    if (!signal) return job.promise;
    return new Promise<RefreshResult>((resolve) => {
      const onAbort = (): void => {
        job.waiters--;
        if (job.waiters === 0) {
          job.ctrl.abort(); // ждать больше некому — работу отменяем, а этому вызову отдаём её настоящий итог
          void job.promise.then(resolve);
        } else {
          resolve(abortedResult()); // работа продолжается для остальных
        }
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      void job.promise.then((r) => {
        signal.removeEventListener('abort', onAbort);
        resolve(r);
      });
    });
  }

  function refresh(signal?: AbortSignal): Promise<RefreshResult> {
    if (inflight && !inflight.ctrl.signal.aborted) return join(inflight, signal);
    let finish!: (r: RefreshResult) => void;
    const job: RefreshJob = { ctrl: new AbortController(), waiters: 0, promise: new Promise<RefreshResult>((res) => (finish = res)) };
    inflight = job;
    const mine = join(job, signal); // раньше старта: уже отменённый signal остановит работу до первого провайдера
    void (async (): Promise<RefreshResult> => {
      try {
        return await runRefresh(job.ctrl.signal);
      } catch (e) {
        // сюда попадаем только при ошибке в самом сервисе; контракт «не бросает» важнее
        const message = describeError(e);
        state.lastError = `Внутренняя ошибка обновления курсов: ${message}`;
        return { ok: false, providerId: null, table: null, failures: [{ providerId: 'service', kind: 'error', message }], warnings: [], aborted: false };
      } finally {
        if (inflight === job) inflight = null;
        notify();
      }
    })().then(finish);
    return mine;
  }

  function getRate(from: CurrencyCode, to: CurrencyCode): RateLookup | null {
    const f = normCode(from);
    const t = normCode(to);
    if (!isValidCurrencyCode(f) || !isValidCurrencyCode(t)) return null;
    const today = isoDateOf(now());
    if (f === t) return { rate: 1, source: 'same', asOf: today, stale: false, manual: false };
    const manual = state.manual[pairKey(f, t)];
    if (manual) return { rate: manual.rate, source: 'manual', asOf: manual.setAt.slice(0, 10), stale: false, manual: true };
    const hit = pickRate(state.tables, f, t);
    if (!hit || !Number.isFinite(hit.rate) || hit.rate <= 0) return null;
    return {
      rate: hit.rate,
      source: hit.table.source,
      asOf: hit.table.asOf,
      stale: daysBetween(hit.table.asOf, today) > STALE_AFTER_DAYS,
      manual: false,
    };
  }

  function checkedPair(from: CurrencyCode, to: CurrencyCode): [CurrencyCode, CurrencyCode] {
    const f = normCode(from);
    const t = normCode(to);
    if (!isValidCurrencyCode(f) || !isValidCurrencyCode(t)) throw new RangeError(`Некорректная пара валют: ${String(from)} → ${String(to)}`);
    if (f === t) throw new RangeError('Курс валюты к самой себе всегда 1, задавать его не нужно');
    return [f, t];
  }

  function setManualRate(from: CurrencyCode, to: CurrencyCode, rate: number): void {
    const [f, t] = checkedPair(from, to);
    if (!isRateValue(rate)) {
      throw new RangeError(`Курс должен быть числом больше нуля (от ${MIN_PER_UNIT} до ${MAX_PER_UNIT}), получено ${String(rate)}`);
    }
    commit(() => {
      state.manual[pairKey(f, t)] = { rate, setAt: now().toISOString() };
    });
    notify();
  }

  function clearManualRate(from: CurrencyCode, to: CurrencyCode): void {
    const [f, t] = checkedPair(from, to);
    pull(); // курс мог быть задан в другой вкладке, а у этой в памяти его ещё нет
    if (!(pairKey(f, t) in state.manual)) return;
    commit(() => {
      delete state.manual[pairKey(f, t)];
    });
    notify();
  }

  function listKnownCurrencies(): CurrencyCode[] {
    const codes = new Set<CurrencyCode>();
    for (const table of state.tables) for (const code of Object.keys(table.perUnit)) codes.add(code);
    for (const key of Object.keys(state.manual)) for (const code of key.split('>')) codes.add(code);
    return [...codes].sort();
  }

  function getStatus(): RateServiceStatus {
    return { lastRefreshAt: state.lastRefreshAt, lastAttemptAt: state.lastAttemptAt, lastError: state.lastError };
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // пока есть слушатели, узнаём об изменениях из других вкладок (если хранилище умеет сообщать о них)
    if (!detachStorage && storage.subscribe) {
      try {
        detachStorage = storage.subscribe(() => {
          pull();
          notify();
        });
      } catch {
        detachStorage = null;
      }
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && detachStorage) {
        detachStorage();
        detachStorage = null;
      }
    };
  }

  return { refresh, getRate, setManualRate, clearManualRate, listKnownCurrencies, getStatus, subscribe };
}
