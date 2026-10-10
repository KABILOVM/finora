import type { CurrencyCode, IsoDate, IsoDateTime, RateTable } from '@/domain/types';

/** Источник курсов. fetchLatest не должен возвращать «выдуманные» данные: нет данных — бросай ошибку. */
export interface RateProvider {
  /** 'server' | 'nbt' | 'api' — попадает в RateTable.source и в журнал ошибок. */
  id: string;
  fetchLatest(signal?: AbortSignal, context?: FetchContext): Promise<RateTable>;
}

/** Что сервис сообщает провайдеру о своём вызове. */
export interface FetchContext {
  /** Сколько мс сервис даёт на ВЕСЬ вызов. Провайдер, который пробует несколько адресов по очереди, делит это время между ними. */
  timeoutMs: number;
}

/**
 * Таблица + предупреждения разбора (дубли, отброшенные записи). Это подтип RateTable:
 * провайдеры отдают его как обычный RateTable, а сервис достаёт warnings и в хранилище их НЕ кладёт.
 */
export type ParsedRateTable = RateTable & { warnings: string[] };

/**
 * Ответ провайдера, который отдаёт вместе с главной таблицей ещё и более ранние (сервис сохранит их рядом).
 * Нужно, когда в свежей таблице нет валюты, которая есть во вчерашней (например, TJS): иначе курса к ней не будет совсем.
 */
export type RateTableWithEarlier = ParsedRateTable & { earlier?: RateTable[] };

/** Ответ getRate. */
export interface RateLookup {
  /** Единиц `to` за 1 единицу `from`. Конечное число > 0. */
  rate: number;
  /** 'same' | 'nbt' | 'server' | 'api' | 'manual' — совпадает с Transaction.fxSource. */
  source: string;
  asOf: IsoDate;
  /** Курс старше 3 суток — интерфейс должен показать «курс устарел». */
  stale: boolean;
  manual: boolean;
}

export type FailureKind =
  /** Не уложился в fetchTimeoutMs. */
  | 'timeout'
  /** Отменено вызывающим кодом. */
  | 'aborted'
  /** Сеть, HTTP, разбор — любая ошибка провайдера. */
  | 'error'
  /** Данные пришли, но не прошли проверку на здравый смысл (скачок курса, мусор). */
  | 'rejected'
  /** Данные старее тех, что уже сохранены. */
  | 'outdated';

export interface ProviderFailure {
  providerId: string;
  kind: FailureKind;
  message: string;
}

export interface RefreshResult {
  /** true — получена и сохранена новая таблица. false — остались прежние курсы. */
  ok: boolean;
  /** id провайдера-победителя; null, если обновить не удалось. */
  providerId: string | null;
  table: RateTable | null;
  failures: ProviderFailure[];
  /** Предупреждения для показа человеку: отброшенные записи, отклонённые подозрительные курсы. */
  warnings: string[];
  aborted: boolean;
}

export interface RateServiceStatus {
  /** Когда в последний раз приняли новую таблицу. */
  lastRefreshAt: IsoDateTime | null;
  /** Когда в последний раз пытались обновить (удачно или нет). */
  lastAttemptAt: IsoDateTime | null;
  /** Человекочитаемая причина последней неудачи; null, если последняя попытка удалась. */
  lastError: string | null;
}

/** Курсы не приватны, поэтому один общий ключ на устройство (а не по пользователю). */
export const RATES_STORAGE_KEY = 'finora:rates:v1';

/** Хранилище одного JSON-документа. get() не бросает: нет данных или они битые — вернёт null. */
export interface RateStorage {
  get(): unknown;
  set(value: unknown): void;
  /** Необязательно: вызвать listener, когда документ изменила ДРУГАЯ вкладка. Возвращает функцию отписки. */
  subscribe?(listener: () => void): () => void;
}

export interface RateService {
  /**
   * Не бросает: ошибки провайдеров собираются в результат. Параллельные вызовы делят один запрос; отмена одного вызова
   * обрывает запрос, только если его больше никто не ждёт (отменившему приходит aborted: true).
   */
  refresh(signal?: AbortSignal): Promise<RefreshResult>;
  getRate(from: CurrencyCode, to: CurrencyCode): RateLookup | null;
  /** Бросает RangeError, если курс не конечное число > 0 или коды валют некорректны. */
  setManualRate(from: CurrencyCode, to: CurrencyCode, rate: number): void;
  clearManualRate(from: CurrencyCode, to: CurrencyCode): void;
  listKnownCurrencies(): CurrencyCode[];
  getStatus(): RateServiceStatus;
  /** Слушатель вызывается после любого изменения курсов или статуса. Возвращает функцию отписки. */
  subscribe(listener: () => void): () => void;
}
