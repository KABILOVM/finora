import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apiProvider, API_MIRRORS } from './api';
import { failResponse, okResponse, routeFetch, NOW, makeTable, stubProvider } from './__fixtures__/testkit';
import { BAD_ANSWER_TEXT, CANCELLED_TEXT, HttpError, NO_ANSWER_TEXT, NO_CONNECTION_TEXT, REFUSED_TEXT, UNKNOWN_FAILURE_TEXT, abortError, describeRateError, httpErrorText } from './http';
import { nbtProvider } from './nbt';
import { serverProvider, type RatesClient } from './server';
import { createRateService, providerLabel } from './service';
import { createMemoryRateStorage } from './storage';
import type { RateProvider } from './types';

/**
 * Всё, что человек видит про курсы (текст ошибки, статус «последняя попытка не удалась», предупреждения), — по-русски.
 * Никаких «Failed to fetch», «Load failed», «AbortError», «HTTP 503», «JWT expired» и прочего английского.
 */

const CYRILLIC = /[А-Яа-яЁё]/;
/** Английские системные слова, которым не место в тексте для человека. */
const ENGLISH_NOISE = /failed to fetch|load failed|network ?error|aborterror|typeerror|syntaxerror|\bHTTP\b|\bJWT\b|unexpected token|boom|timed? ?out|permission denied|\bfetch\b/i;
const noNoise = (text: string) => expect(text, text).not.toMatch(ENGLISH_NOISE);

describe('describeRateError: перевод системных ошибок', () => {
  const domAbort = () => new DOMException('The operation was aborted.', 'AbortError');
  const cases: [string, unknown, string][] = [
    ['Chrome без сети', new TypeError('Failed to fetch'), NO_CONNECTION_TEXT],
    ['Safari без сети (iPhone)', new TypeError('Load failed'), NO_CONNECTION_TEXT],
    ['Firefox без сети', new TypeError('NetworkError when attempting to fetch resource.'), NO_CONNECTION_TEXT],
    ['React Native / Node', new Error('Network request failed'), NO_CONNECTION_TEXT],
    ['Node: соединение сброшено', new Error('connect ECONNREFUSED 127.0.0.1:443'), NO_CONNECTION_TEXT],
    ['обрыв по AbortError (браузерный текст)', domAbort(), CANCELLED_TEXT],
    ['TimeoutError', new DOMException('signal timed out', 'TimeoutError'), NO_ANSWER_TEXT],
    ['«timed out» в тексте', new Error('Request timed out'), NO_ANSWER_TEXT],
    ['HttpError 503', new HttpError(503), 'Источник курсов сейчас не работает (ошибка 503)'],
    ['HttpError 404', new HttpError(404), 'Источник курсов не найден (ошибка 404)'],
    ['HttpError 403', new HttpError(403), 'Источник курсов не пустил запрос (ошибка 403)'],
    ['HttpError 429', new HttpError(429), 'Источник курсов просит подождать: слишком много запросов (ошибка 429)'],
    ['HttpError 418', new HttpError(418), 'Источник курсов вернул ошибку (код 418)'],
    ['«HTTP 502» из чужого кода', new Error('HTTP 502'), 'Источник курсов сейчас не работает (ошибка 502)'],
    ['битый JSON', new SyntaxError('Unexpected token < in JSON at position 0'), BAD_ANSWER_TEXT],
    ['ошибка сервера: JWT expired', { message: 'JWT expired', code: 'PGRST301' }, REFUSED_TEXT],
    ['ошибка сервера: permission denied', { message: 'permission denied for table exchange_rates' }, REFUSED_TEXT],
    ['просто строка', 'boom', UNKNOWN_FAILURE_TEXT],
    ['null', null, UNKNOWN_FAILURE_TEXT],
    ['undefined', undefined, UNKNOWN_FAILURE_TEXT],
    ['число', 42, UNKNOWN_FAILURE_TEXT],
    ['пустой объект', {}, UNKNOWN_FAILURE_TEXT],
    ['Error без текста', new Error(''), UNKNOWN_FAILURE_TEXT],
    ['смесь: русский текст + английский шум', new Error('Сервер курсов: TypeError: Failed to fetch'), NO_CONNECTION_TEXT],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(describeRateError(input)).toBe(expected);
  });

  it('свои русские сообщения проходят как есть', () => {
    for (const msg of ['нет ответа за 8 с', 'отменено', 'Ответ слишком большой', 'Дата курсов 2031-01-01 из будущего', 'сервер лежит']) {
      expect(describeRateError(new Error(msg))).toBe(msg);
    }
  });

  it('СВОЙСТВО: что бы ни пришло (без русских букв), результат — русский текст без английского шума', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.object()), fc.string(), (value, text) => {
        for (const input of [value, new Error(text), new TypeError(text), new DOMException(text, 'AbortError'), { message: text }]) {
          if (typeof input === 'string' && CYRILLIC.test(input)) continue;
          if (input instanceof Error && CYRILLIC.test(input.message)) continue;
          if (typeof input === 'object' && input !== null && 'message' in input && CYRILLIC.test(String((input as { message: unknown }).message))) continue;
          const out = describeRateError(input);
          expect(CYRILLIC.test(out), `«${out}»`).toBe(true);
          noNoise(out);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('httpErrorText: все коды дают русский текст с кодом', () => {
    for (const status of [400, 401, 403, 404, 418, 429, 500, 502, 503, 504, 599]) {
      const t = httpErrorText(status);
      expect(CYRILLIC.test(t)).toBe(true);
      expect(t).toContain(String(status));
      noNoise(t);
      expect(new HttpError(status).message).toBe(t);
    }
  });

  it('abortError: ответ на отмену по умолчанию — русский (браузерный английский текст подменяется), своя причина сохраняется', () => {
    const ctrl = new AbortController();
    ctrl.abort(); // у браузера причина — DOMException('signal is aborted without reason')
    const e = abortError(ctrl.signal);
    expect(e.name).toBe('AbortError');
    expect(e.message).toBe(CANCELLED_TEXT);
    const own = new Error('Остановлено пользователем');
    const ctrl2 = new AbortController();
    ctrl2.abort(own);
    expect(abortError(ctrl2.signal)).toBe(own);
    expect(abortError(undefined).message).toBe(CANCELLED_TEXT);
  });
});

describe('сервис курсов: статус и результат без английского', () => {
  const run = async (providers: RateProvider[], storage = createMemoryRateStorage()) => {
    const service = createRateService({ providers, storage, now: () => NOW });
    const result = await service.refresh();
    return { service, result, storage };
  };
  const everythingShown = (r: Awaited<ReturnType<typeof run>>) => [r.service.getStatus().lastError ?? '', ...r.result.failures.map((f) => f.message), ...r.result.warnings];

  it('провайдеры падают системными ошибками: failures и lastError по-русски, источники названы по-русски', async () => {
    const r = await run([
      stubProvider('server', () => {
        throw new TypeError('Failed to fetch');
      }),
      stubProvider('nbt', () => {
        throw new TypeError('Load failed');
      }),
      stubProvider('api', () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    ]);
    expect(r.result.failures.map((f) => f.message)).toEqual([NO_CONNECTION_TEXT, NO_CONNECTION_TEXT, CANCELLED_TEXT]);
    const err = r.service.getStatus().lastError ?? '';
    expect(err).toBe(
      'Не удалось обновить курсы: сервер курсов — нет связи с источником курсов; Нацбанк — нет связи с источником курсов; запасной источник — запрос отменён',
    );
    for (const t of everythingShown(r)) noNoise(t);
  });

  it('провайдер бросил не Error (строку, объект, undefined): по-русски', async () => {
    const r = await run([
      stubProvider('server', () => {
        throw 'boom'; // eslint-disable-line @typescript-eslint/only-throw-error
      }),
      stubProvider('nbt', () => {
        throw undefined; // eslint-disable-line @typescript-eslint/only-throw-error
      }),
      stubProvider('api', () => {
        throw { message: 'JWT expired' }; // eslint-disable-line @typescript-eslint/only-throw-error
      }),
    ]);
    expect(r.result.failures.map((f) => f.message)).toEqual([UNKNOWN_FAILURE_TEXT, UNKNOWN_FAILURE_TEXT, REFUSED_TEXT]);
    for (const t of everythingShown(r)) noNoise(t);
  });

  it('неизвестный (свой) источник назван по id, известные — по-русски', () => {
    expect(providerLabel('server')).toBe('сервер курсов');
    expect(providerLabel('nbt')).toBe('Нацбанк');
    expect(providerLabel('api')).toBe('запасной источник');
    expect(providerLabel('mock')).toBe('источник «mock»');
    expect(providerLabel('constructor')).toBe('источник «constructor»');
  });

  it('настоящие провайдеры на сломанном fetch: сеть, 5xx, HTML вместо JSON, ошибка сервера — всё по-русски', async () => {
    const offline = routeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const html = routeFetch(() => okResponse('<html>Service Unavailable</html>', 'text/html'));
    const http500 = routeFetch(() => failResponse(500));
    const client = (error: unknown): RatesClient => ({
      from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error }) }) }) }),
    });
    for (const [name, fetchImpl, serverError] of [
      ['нет сети', offline, { message: 'TypeError: Failed to fetch' }],
      ['5xx', http500, { message: 'permission denied for table exchange_rates', code: '42501' }],
      ['HTML вместо данных', html, { message: 'JWT expired', code: 'PGRST301' }],
    ] as const) {
      const r = await run([serverProvider(client(serverError)), nbtProvider(fetchImpl), apiProvider(fetchImpl)]);
      expect(r.result.ok, name).toBe(false);
      const shown = everythingShown(r);
      expect(shown.length).toBeGreaterThan(3);
      for (const t of shown) {
        expect(CYRILLIC.test(t) || t === '', `${name}: «${t}»`).toBe(true);
        noNoise(t);
      }
      expect(r.service.getStatus().lastError).toMatch(/^Не удалось обновить курсы: сервер курсов — /);
    }
  });

  it('apiProvider: причина по каждому зеркалу — по-русски, хост назван', async () => {
    const fetchImpl = routeFetch((url) => {
      if (url === API_MIRRORS[0]) throw new TypeError('Load failed');
      return failResponse(404);
    });
    const err = await apiProvider(fetchImpl).fetchLatest().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe(
      'Запасной источник курсов недоступен (cdn.jsdelivr.net: Нет связи с источником курсов; latest.currency-api.pages.dev: Источник курсов не найден (ошибка 404))',
    );
    noNoise(err?.message ?? '');
  });

  it('nbtProvider: сетевой сбой — ошибка с русским текстом (причина сохранена в cause), отмена остаётся отменой', async () => {
    const raw = new TypeError('Failed to fetch');
    const err = await nbtProvider(routeFetch(() => { throw raw; })).fetchLatest().then(
      () => null,
      (e: unknown) => e as Error & { cause?: unknown },
    );
    expect(err?.message).toBe(NO_CONNECTION_TEXT);
    expect(err?.cause).toBe(raw);
    const ctrl = new AbortController();
    ctrl.abort();
    const aborted = await nbtProvider(routeFetch(() => okResponse(''))).fetchLatest(ctrl.signal).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(aborted?.name).toBe('AbortError');
    expect(aborted?.message).toBe(CANCELLED_TEXT);
  });

  it('предупреждения об отклонённых курсах называют источник по-русски', async () => {
    const storage = createMemoryRateStorage();
    await run([stubProvider('nbt', () => makeTable())], storage);
    const r = await run([stubProvider('nbt', () => makeTable({ perUnit: { TJS: 1, USD: 25, EUR: 12.78, RUB: 0.1189 } }))], storage);
    expect(r.result.ok).toBe(false);
    const w = r.result.warnings.join(' ');
    expect(w).toContain('Курсы (Нацбанк) выглядят подозрительно и не приняты');
    expect(w).not.toContain('«nbt»');
  });

  it('прежняя версия записала в хранилище английскую ошибку: человеку она не показывается', () => {
    const doc = (lastError: unknown) => ({ v: 1, tables: [], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError });
    const status = (lastError: unknown) => createRateService({ providers: [], storage: createMemoryRateStorage(doc(lastError)), now: () => NOW }).getStatus().lastError;
    expect(status('Не удалось обновить курсы: nbt — нет связи (Failed to fetch)')).toBe('Не удалось обновить курсы');
    expect(status('Failed to fetch')).toBe('Не удалось обновить курсы');
    expect(status('Не удалось обновить курсы: nbt — HTTP 503')).toBe('Не удалось обновить курсы');
    expect(status('Не удалось обновить курсы: Нацбанк — нет связи с источником курсов')).toBe('Не удалось обновить курсы: Нацбанк — нет связи с источником курсов');
    expect(status(null)).toBeNull();
    expect(status(42)).toBeNull();
  });
});
