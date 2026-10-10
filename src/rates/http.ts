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

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

const MAX_BODY_BYTES = MAX_BODY_CHARS * 2;

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Запрос отменён', 'AbortError');
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
