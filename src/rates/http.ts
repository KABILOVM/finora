import { MAX_BODY_CHARS, RateParseError } from './parseUtil';

/** Минимум, который нужен от fetch/Response: совместим с настоящим fetch и легко подменяется в тестах. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FetchInit {
  signal?: AbortSignal;
  cache?: 'no-store';
  credentials?: 'omit';
  redirect?: 'follow';
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<ResponseLike>;

/** Настоящий fetch берётся в момент вызова (а не при импорте), чтобы тесты и SSR не падали. */
export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

/** Что сказать человеку про код ответа источника. Без английских «HTTP 503». */
export function httpErrorText(status: number): string {
  if (status === 401 || status === 403) return `Источник курсов не пустил запрос (ошибка ${status})`;
  if (status === 404) return 'Источник курсов не найден (ошибка 404)';
  if (status === 429) return 'Источник курсов просит подождать: слишком много запросов (ошибка 429)';
  if (status >= 500) return `Источник курсов сейчас не работает (ошибка ${status})`;
  return `Источник курсов вернул ошибку (код ${status})`;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(httpErrorText(status));
    this.name = 'HttpError';
    this.status = status;
  }
}

export const NO_CONNECTION_TEXT = 'Нет связи с источником курсов';
export const BAD_ANSWER_TEXT = 'Источник вернул непонятный ответ';
export const CANCELLED_TEXT = 'Запрос отменён';
export const NO_ANSWER_TEXT = 'Источник курсов не ответил вовремя';
export const REFUSED_TEXT = 'Источник курсов не пустил запрос (нужен вход или доступ закрыт)';
export const UNKNOWN_FAILURE_TEXT = 'Источник курсов вернул ошибку';

const CYRILLIC = /[А-Яа-яЁё]/;
/** То, что отдают браузер и библиотеки, когда сети нет или ответ плохой. В тексте для человека этому не место. */
const ENGLISH_NOISE = new RegExp(
  [
    'failed to fetch|load failed|network ?error|aborterror|typeerror|\\bHTTP\\s*\\d{3}\\b',
    // узнаваемые хвосты сетевых сбоев и ответов сервера: русская приставка («Ошибка сети: …») их не оправдывает
    '\\bE(?:CONN\\w+|NOTFOUND|TIMEDOUT|HOSTUNREACH|NETUNREACH|PIPE|AI_AGAIN)\\b',
    'internal server error|service unavailable|bad gateway|gateway time-?out|too many requests',
    'unexpected (?:token|end)|in JSON at position',
  ].join('|'),
  'i',
);
/** Ошибка самой программы (а не источника): слово вроде «permission» внутри её текста ничего не говорит про доступ. */
const PROGRAMMING_ERROR = /cannot read propert|cannot set propert|is not a function|is not iterable|is not defined|is not a constructor|of (?:undefined|null)\b|^(?:undefined|null) is not/i;

/** Сообщение из Error, строки или объекта-ошибки сервера ({ message }). */
function rawMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Любая ошибка источника курсов → короткий текст ПО-РУССКИ для человека. Английские системные сообщения
 * («Failed to fetch», «Load failed», «AbortError», «HTTP 503», «JWT expired») наружу не выходят.
 * Наши собственные сообщения (уже по-русски) возвращаются как есть. Не бросает.
 */
export function describeRateError(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  const name = typeof e === 'object' && e !== null ? String((e as { name?: unknown }).name ?? '') : '';
  if (name === 'AbortError') return CANCELLED_TEXT;
  if (name === 'TimeoutError') return NO_ANSWER_TEXT;
  const msg = rawMessage(e).trim();
  // Уже по-русски (наше сообщение, например «нет ответа за 8 с») — как есть, если в нём нет английского системного шума.
  if (CYRILLIC.test(msg) && !ENGLISH_NOISE.test(msg)) return msg;
  const http = /\bHTTP\s*(\d{3})\b/i.exec(msg);
  if (http) return httpErrorText(Number(http[1]));
  if (e instanceof TypeError && PROGRAMMING_ERROR.test(msg)) return UNKNOWN_FAILURE_TEXT;
  if (/failed to fetch|load failed|network ?error|network request failed|fetch failed|offline|econn|enotfound|etimedout|connection|socket|dns/i.test(msg)) {
    return NO_CONNECTION_TEXT;
  }
  if (/abort|cancel/i.test(msg)) return CANCELLED_TEXT;
  if (/time(d)? ?out/i.test(msg)) return NO_ANSWER_TEXT;
  if (e instanceof SyntaxError || /json|unexpected (token|end)|parse|syntax/i.test(msg)) return BAD_ANSWER_TEXT;
  if (/jwt|unauthori[sz]ed|forbidden|permission|denied|not allowed|invalid api key|apikey|\b40[13]\b/i.test(msg)) return REFUSED_TEXT;
  return UNKNOWN_FAILURE_TEXT;
}

/**
 * Ошибка источника → ошибка с русским текстом (для провайдеров: их исключения не должны нести «Failed to fetch»).
 * HttpError и RateParseError уже такие; отмена остаётся отменой (name 'AbortError'); остальное пересказывается по-русски.
 */
export function russianError(e: unknown): Error {
  if (e instanceof HttpError || e instanceof RateParseError) return e;
  const text = describeRateError(e);
  if (text === CANCELLED_TEXT) return new DOMException(CANCELLED_TEXT, 'AbortError');
  if (e instanceof Error && e.message === text) return e;
  return Object.assign(new Error(text), { cause: e });
}

const MAX_BODY_BYTES = MAX_BODY_CHARS * 2;

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  // Причина по умолчанию у браузера — DOMException с английским текстом («signal is aborted without reason»): подменяем.
  const own = reason instanceof Error && reason.name !== 'AbortError' && reason.name !== 'TimeoutError';
  return own ? reason : new DOMException(CANCELLED_TEXT, 'AbortError');
}

/** GET без кэша и без cookie. Бросает HttpError для не-2xx и RateParseError для слишком большого ответа. */
export async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  if (signal?.aborted) throw abortError(signal);
  const res = await fetchImpl(url, { signal, cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new HttpError(res.status);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new RateParseError('Ответ слишком большой');
  return { bytes, contentType: res.headers?.get('content-type') ?? null };
}
