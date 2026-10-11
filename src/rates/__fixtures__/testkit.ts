import type { RateTable } from '@/domain/types';
import type { FetchInit, FetchLike, ResponseLike } from '../http';
import { createRateService, type RateServiceOptions } from '../service';
import { createMemoryRateStorage } from '../storage';
import type { RateProvider, RateService, RateStorage } from '../types';

/** «Сегодня» во всех тестах. Полдень UTC, чтобы результат не зависел от часового пояса машины. */
export const NOW = new Date('2026-10-10T12:00:00.000Z');

export function okResponse(body: string | Uint8Array, contentType: string | null = null): ResponseLike {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

export function failResponse(status: number): ResponseLike {
  return { ok: false, status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
}

export type RecordingFetch = FetchLike & { calls: { url: string; init?: FetchInit }[] };

/** fetch, который записывает вызовы и отвечает функцией handler (может бросить — это «нет сети»). */
export function routeFetch(handler: (url: string, init?: FetchInit) => ResponseLike | Promise<ResponseLike>): RecordingFetch {
  const calls: RecordingFetch['calls'] = [];
  const fn = (async (url: string, init?: FetchInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as RecordingFetch;
  fn.calls = calls;
  return fn;
}

export function makeTable(over: Partial<RateTable> = {}): RateTable {
  return {
    asOf: '2026-10-10',
    pivot: 'TJS',
    perUnit: { TJS: 1, USD: 10.95, EUR: 12.78, RUB: 0.1189 },
    source: 'nbt',
    fetchedAt: NOW.toISOString(),
    ...over,
  };
}

export type StubProvider = RateProvider & { calls: number; signals: (AbortSignal | undefined)[] };

export function stubProvider(id: string, impl: (signal?: AbortSignal) => Promise<RateTable> | RateTable): StubProvider {
  const p: StubProvider = {
    id,
    calls: 0,
    signals: [],
    async fetchLatest(signal) {
      p.calls++;
      p.signals.push(signal);
      return impl(signal);
    },
  };
  return p;
}

/** Кодирование в windows-1251 (только кириллица и ASCII) — чтобы проверить разбор «исторической» выдачи. */
export function encodeWin1251(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    if (c < 0x80) out.push(c);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else out.push(63);
  }
  return Uint8Array.from(out);
}

/** Провайдер-функция «вернуть такую таблицу». */
export const ok = (over: Partial<RateTable> = {}) => () => makeTable(over);

/** Провайдер-функция «упасть с таким сообщением». */
export const fail = (msg = 'boom') => () => {
  throw new Error(msg);
};

/** Сервис курсов на памяти с фиксированным «сейчас» (NOW). */
export function setup(providers: RateProvider[], extra: Partial<RateServiceOptions> = {}): { service: RateService; storage: RateStorage } {
  const storage = extra.storage ?? createMemoryRateStorage();
  const service = createRateService({ providers, storage, now: () => NOW, ...extra });
  return { service, storage };
}
