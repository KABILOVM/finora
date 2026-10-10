import type { SupabaseClient } from '@supabase/supabase-js';
import { TABLE_SPECS, type PulledRow, type SyncTableName, type WireRow } from './tables';
import type { SessionAwareTransport } from './session';
import { TransportError } from './transport';

export interface SupabaseTransportOptions {
  /** Таймаут одного запроса, мс. По умолчанию 15000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Ошибка PostgREST / supabase-js в том виде, в каком она приходит в поле error. */
interface PostgrestFailure {
  message?: unknown;
  code?: unknown;
}

const NETWORK_TEXT = /abort|timeout|failed to fetch|load failed|networkerror|network request failed|fetch failed|econnreset|enotfound|econnrefused/i;
/** Ошибки данных: класс 22 (значение не того вида), класс 23 (ограничения и ключи). */
const DATA_ERROR_CODE = /^(22|23)[0-9A-Z]{3}$/;

const textOf = (e: PostgrestFailure | null | undefined, fallback: string): string => {
  const m = e?.message;
  return typeof m === 'string' && m.trim() !== '' ? m : fallback;
};

/**
 * Разбор отказа PostgREST по коду и статусу (порядок важен):
 *  1. нет ответа вовсе (статус 0, сбой fetch, отмена по таймауту) → 'network';
 *  2. HTTP 401, PGRST301/PGRST303 (просроченный или неверный JWT), SQLSTATE 28000 → 'auth'.
 *     Статус 401 сильнее кода: если сессия потеряна, supabase-js шлёт запрос с анонимным ключом, и Postgres отвечает 42501 —
 *     это «войдите заново», а не «данные плохие» (иначе вся очередь ушла бы в карантин);
 *  3. 21000, 22xxx, 23xxx, 42501 → 'rejected' (повтор тех же данных не поможет);
 *  4. HTTP 400 без кода («Bad Request» от шлюза или фильтра): запрос неверен сам по себе, повтор тех же данных не поможет.
 *     Иначе одна «ядовитая» запись вечно держала бы всю очередь (повтор пачки с ней всегда падает) → 'rejected':
 *     движок найдёт виновника делением пачки пополам и отправит остальное;
 *  5. всё остальное (5xx, перегрузка, неизвестные коды, ошибки схемы с кодом PGRST…) → 'server'.
 */
export function classifyPostgrestError(error: unknown, status?: number): TransportError {
  const e = (typeof error === 'object' && error !== null ? error : { message: String(error) }) as PostgrestFailure;
  const code = typeof e.code === 'string' && e.code !== '' ? e.code : typeof e.code === 'number' ? String(e.code) : undefined;
  const message = textOf(e, 'Ошибка запроса к серверу');
  const name = (error as { name?: unknown } | null)?.name;

  const thrownNetwork = error instanceof TypeError || name === 'AbortError' || name === 'TimeoutError';
  if (status === 0 || thrownNetwork || ((status === undefined || status === 0) && code === undefined && NETWORK_TEXT.test(message))) {
    return new TransportError('network', `Нет связи с сервером: ${message}`, code);
  }
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || code === '28000') {
    return new TransportError('auth', `Сессия недействительна: ${message}`, code);
  }
  if (code !== undefined && (code === '21000' || code === '42501' || DATA_ERROR_CODE.test(code))) {
    return new TransportError('rejected', `Сервер отверг данные: ${message}`, code);
  }
  if (code === undefined && status === 400) {
    return new TransportError('rejected', `Сервер отверг запрос (400): ${message}`, code);
  }
  return new TransportError('server', `Ошибка сервера${status ? ` (${status})` : ''}: ${message}`, code);
}

/**
 * Строка без «одиноких» половинок суррогатной пары (например, обрезанное по длине эмодзи): Postgres не умеет хранить такой текст
 * (JSON с ним отвергается кодом 22P02 навсегда). Заменяем их на U+FFFD «�», остальной текст не меняется.
 */
export function toWellFormed(text: string): string {
  if (!/[\uD800-\uDFFF]/.test(text)) return text;
  let out = '';
  for (const ch of text) out += ch.length === 1 && ch >= '\uD800' && ch <= '\uDFFF' ? '\uFFFD' : ch;
  return out;
}

const wellFormedRow = (row: WireRow): WireRow => {
  let copy: WireRow | null = null;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== 'string') continue;
    const fixed = toWellFormed(v);
    if (fixed !== v) (copy ??= { ...row })[k] = fixed;
  }
  return copy ?? row;
};

/** Идентификатор пользователя из токена (поле sub; именно его сервер считает владельцем строк). */
function subOfJwt(token: unknown): string | null {
  const payload = typeof token === 'string' ? token.split('.')[1] : undefined;
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const sub = (JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub !== '' ? sub : null;
  } catch {
    return null;
  }
}

interface PostgrestResult {
  data?: unknown;
  error?: unknown;
  status?: number;
}

/** Ответ supabase.auth.getSession() в той части, что нам нужна. */
interface SessionResult {
  data?: { session?: { access_token?: unknown; user?: { id?: unknown } | null } | null } | null;
  error?: (PostgrestFailure & { status?: number }) | null;
}

/** Транспорт поверх supabase-js. Только чтение и upsert — прямых UPDATE и RPC здесь нет (решает триггер sync_guard на сервере). */
export function createSupabaseTransport(client: SupabaseClient, opts: SupabaseTransportOptions = {}): SessionAwareTransport {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError(`timeoutMs: ожидалось положительное число, получено ${timeoutMs}`);

  /** Один запрос с жёстким таймаутом: отмена через AbortController + гонка с таймером (на случай клиента, не слушающего отмену). */
  async function request<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TransportError('network', `Сервер не ответил за ${Math.round(timeoutMs / 1000)} с`, 'timeout'));
      }, timeoutMs);
    });
    const call = (async () => run(controller.signal))(); // синхронный сбой при сборке запроса тоже станет отказом промиса
    call.then(undefined, () => undefined); // если победил таймаут, поздняя ошибка запроса никому не нужна
    try {
      return await Promise.race([call, timeout]);
    } catch (e) {
      throw e instanceof TransportError ? e : classifyPostgrestError(e, undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  const checkTable = (table: SyncTableName): string => {
    const spec = TABLE_SPECS[table] as (typeof TABLE_SPECS)[SyncTableName] | undefined;
    if (!spec) throw new TypeError(`Неизвестная таблица синхронизации: ${String(table)}`);
    return spec.remote;
  };

  return {
    async pull(table, afterSeq, limit) {
      const remote = checkTable(table);
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new RangeError(`afterSeq: ${afterSeq}`);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit: ${limit}`);
      const res = await request<PostgrestResult>((signal) => {
        const q = client
          .from(remote)
          .select('*')
          .gt('server_seq', afterSeq)
          .order('server_seq', { ascending: true })
          .limit(limit)
          .abortSignal(signal);
        // повторы запросов — забота движка (с паузами и общим таймаутом), а не встроенного повтора клиента
        return typeof (q as { retry?: unknown }).retry === 'function' ? q.retry(false) : q;
      });
      if (res.error) throw classifyPostgrestError(res.error, res.status);
      if (!Array.isArray(res.data) || res.data.some((r) => typeof r !== 'object' || r === null)) {
        throw new TransportError('server', 'Сервер вернул ответ в непонятном виде');
      }
      return res.data as PulledRow[];
    },

    async push(table, rows: WireRow[]) {
      const remote = checkTable(table);
      if (!Array.isArray(rows)) throw new TypeError('rows: ожидался массив');
      if (rows.length === 0) return; // пустая пачка — без запроса
      // upsert по id; ответ «minimal» (тело не нужно); принять или проигнорировать правку решает триггер на сервере
      const wire = rows.map(wellFormedRow);
      const res = await request<PostgrestResult>((signal) => client.from(remote).upsert(wire, { onConflict: 'id' }).abortSignal(signal));
      if (res.error) throw classifyPostgrestError(res.error, res.status);
    },

    /** Чей токен supabase-js возьмёт для следующего запроса (он читает ту же сессию). */
    async currentUserId() {
      let getSession: (() => PromiseLike<unknown>) | undefined;
      try {
        // клиент с собственным accessToken (серверный код, тесты) не даёт читать auth: общей сессии браузера у него нет
        const auth = client.auth;
        getSession = auth.getSession.bind(auth);
      } catch {
        return undefined;
      }
      if (typeof getSession !== 'function') return undefined;
      const res = (await request(() => getSession())) as SessionResult;
      if (res.error) {
        // нет связи (статус 0) и сбой сервера входа (5xx) — повторить позже; остальное (обновить сессию не вышло) — нужен вход
        const status = res.error.status;
        if (typeof status === 'number' && (status === 0 || status >= 500)) throw classifyPostgrestError(res.error, status);
        throw new TransportError('auth', `Сессия недействительна: ${textOf(res.error, 'не удалось прочитать сессию')}`);
      }
      const session = res.data?.session;
      if (!session) return null;
      const id = subOfJwt(session.access_token) ?? session.user?.id;
      return typeof id === 'string' && id !== '' ? id : null;
    },
  };
}
