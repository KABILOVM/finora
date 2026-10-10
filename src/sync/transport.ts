import type { PulledRow, SyncTableName, WireRow } from './tables';

/**
 * Транспорт синхронизации — единственное место, где клиент говорит с сервером.
 * Реализации: SupabaseTransport (боевая), MemoryTransport (тесты/демо), PgliteTransport (проверка настоящего SQL).
 * ВСЕ реализации обязаны проходить один и тот же набор сценариев (tests/sync/conformance.ts).
 *
 * Семантика сервера (её исполняет триггер в supabase/schema.sql):
 *  - push = upsert по id. user_id всегда = текущий пользователь (клиентское значение игнорируется);
 *  - «последний побеждает»: правка принимается, только если (client_updated_at, device_id) СТРОГО больше сохранённых;
 *    иначе молча игнорируется (повторная отправка той же правки безопасна — идемпотентность);
 *  - client_updated_at ограничивается сверху «сейчас + 5 минут» (защита от часов, убежавших в будущее);
 *  - каждая принятая запись получает новый server_seq (растёт глобально) и server_updated_at;
 *  - физического удаления нет: удаление = deleted_at;
 *  - pull отдаёт только строки текущего пользователя, по возрастанию server_seq.
 */

export type TransportErrorKind =
  /** Нет сети / таймаут. Повторять позже. */
  | 'network'
  /** Токен просрочен или недействителен. Нужно обновить сессию / войти заново. */
  | 'auth'
  /** Сервер отверг данные (ограничение, FK, RLS). Повтор БЕЗ изменения данных не поможет. */
  | 'rejected'
  /** 5xx / перегрузка. Повторять с задержкой. */
  | 'server';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly code?: string;
  constructor(kind: TransportErrorKind, message: string, code?: string) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.code = code;
  }
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'server';
  }
}

export interface SyncTransport {
  /** Строки с server_seq > afterSeq, по возрастанию server_seq, не больше limit. */
  pull(table: SyncTableName, afterSeq: number, limit: number): Promise<PulledRow[]>;
  /** Upsert пачки строк. Бросает TransportError. Пустая пачка — no-op. */
  push(table: SyncTableName, rows: WireRow[]): Promise<void>;
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'auth-required';

export interface SyncStatus {
  phase: SyncPhase;
  /** Сколько локальных записей ждут отправки (по всем таблицам). */
  pending: number;
  /** Записи, которые сервер отверг (карантин) — требуют внимания, но не блокируют остальные. */
  quarantined: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SyncEngineApi {
  /** Подписаться на статус. Возвращает функцию отписки. Сразу вызывает слушателя с текущим статусом. */
  subscribe(listener: (s: SyncStatus) => void): () => void;
  getStatus(): SyncStatus;
  /** Один полный цикл (отправка → получение). Одновременно выполняется не более одного. */
  syncNow(reason?: string): Promise<void>;
  /** Подписывает триггеры: запуск, возврат на вкладку, online, таймер, изменения локальной базы. */
  start(): void;
  stop(): void;
}
