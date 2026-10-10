import { decodeBody, MAX_BODY_CHARS, RateParseError, boundWarnings, isFutureDate, isPlainObject, isRateValue, normalizeDate, parseDecimal } from './parseUtil';
import { abortError, defaultFetch, fetchBytes, type FetchLike } from './http';
import type { ParsedRateTable, RateProvider } from './types';

/*
 * ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ — разбор составлен по предположению.
 * Ожидается JSON currency-api (@fawazahmed0): {"date":"2026-10-10","usd":{"tjs":9.2,"eur":0.92,...}},
 * где число — сколько единиц валюты X за 1 единицу базовой. Наличие кода «tjs» НЕ подтверждено:
 *   - есть tjs  → таблица приводится к pivot 'TJS' (perUnit[X] = tjs / x);
 *   - нет tjs   → pivot остаётся базовой валютой, пересчёт в сомони по такой таблице невозможен (будет предупреждение).
 * Список кодов в этом сервисе включает и крипто-коды из 3 букв (BTC, ETH...): мы их не фильтруем,
 * поэтому список валют для выбора пользователем нужно брать из domain/currency.ts, а не из этой таблицы.
 *
 * Блок между маркерами SHARED:api ДОСЛОВНО скопирован в supabase/functions/fetch-rates/index.ts.
 * Правишь здесь — правь и там; тест edge.test.ts сравнит текст.
 */

// <<< SHARED:api
/**
 * JSON currency-api → RateTable. `json` — объект или JSON-строка, `base` — код базовой валюты ответа ('usd').
 * Бросает RateParseError: не JSON, нет даты / раздела base, дата из будущего, нет ни одного корректного курса.
 */
export function parseCurrencyApiJson(json: unknown, base: string, now: Date = new Date()): ParsedRateTable {
  const baseCode = typeof base === 'string' ? base.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(baseCode)) throw new RateParseError('Некорректная базовая валюта ответа');
  let data: unknown = json;
  if (typeof data === 'string') {
    if (data.length > MAX_BODY_CHARS) throw new RateParseError('Ответ слишком большой');
    try {
      data = JSON.parse(data.replace(/^﻿/, ''));
    } catch {
      throw new RateParseError('Ответ не является JSON');
    }
  }
  if (!isPlainObject(data)) throw new RateParseError('Ответ не является JSON-объектом');
  const asOf = typeof data.date === 'string' ? normalizeDate(data.date) : null;
  if (asOf === null) throw new RateParseError('В ответе нет корректной даты курсов');
  if (isFutureDate(asOf, now)) throw new RateParseError(`Дата курсов ${asOf} из будущего`);
  const section = data[baseCode.toLowerCase()] ?? data[baseCode];
  if (!isPlainObject(section)) throw new RateParseError(`В ответе нет раздела «${baseCode.toLowerCase()}»`);

  const warnings: string[] = [];
  const units = new Map<string, number>(); // код → единиц этой валюты за 1 базовую
  for (const [key, raw] of Object.entries(section)) {
    const code = key.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === baseCode) continue; // 1inch, ... — не валюты; сама база — не курс
    if (units.has(code)) {
      warnings.push(`Дубль ${code}: повторная запись проигнорирована, взята первая`);
      continue;
    }
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseDecimal(raw) : null;
    if (!isRateValue(value)) {
      warnings.push(`${code}: некорректное значение, запись отброшена`);
      continue;
    }
    units.set(code, value);
  }

  const tjsPerBase = baseCode === 'TJS' ? 1 : units.get('TJS');
  const pivot = tjsPerBase === undefined ? baseCode : 'TJS';
  if (tjsPerBase === undefined) {
    warnings.push(`В ответе нет tjs: курсы приведены к ${baseCode}, пересчёт в сомони по ним невозможен`);
  }
  const factor = pivot === 'TJS' ? (tjsPerBase as number) : 1; // сколько единиц pivot в 1 единице базовой валюты
  const perUnit: Record<string, number> = { [pivot]: 1 };
  if (baseCode !== pivot) perUnit[baseCode] = factor;
  for (const code of [...units.keys()].sort()) {
    if (code === pivot) continue;
    const v = factor / (units.get(code) as number);
    if (!isRateValue(v)) {
      warnings.push(`${code}: курс ${v} вне допустимых границ, запись отброшена`);
      continue;
    }
    perUnit[code] = v;
  }
  if (Object.keys(perUnit).length < 2) throw new RateParseError('Не найдено ни одного корректного курса');
  return { asOf, pivot, perUnit, source: 'api', fetchedAt: now.toISOString(), warnings: boundWarnings(warnings) };
}
// SHARED:api >>>

/** Зеркала по порядку; адреса из задания, НЕ ПРОВЕРЕНЫ. */
export const API_MIRRORS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
];

export interface ApiProviderOptions {
  /** Базовая валюта файлов-зеркал; должна совпадать с именем файла и разделом ответа. */
  base?: string;
  mirrors?: readonly string[];
  now?: () => Date;
}

/** Сигнал одной попытки: отменяется вместе с внешним и сам — через `ms`, если задано. */
function attemptSignal(outer: AbortSignal | undefined, ms: number | undefined) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onOuter = (): void => ctrl.abort(outer?.reason);
  outer?.addEventListener('abort', onOuter, { once: true });
  const timer =
    ms === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, ms);
  return {
    signal: ctrl.signal,
    timedOut: (): boolean => timedOut,
    dispose(): void {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

const waitedText = (ms: number): string => `нет ответа за ${ms >= 1000 ? `${Math.round(ms / 1000)} с` : `${ms} мс`}`;

/**
 * Перебирает зеркала по порядку; побеждает первое, чей ответ разобрался. Если упали все — одна ошибка со всеми причинами.
 * Время, которое сервис дал на весь вызов (context.timeoutMs), делится между оставшимися зеркалами: зависшее первое
 * зеркало отпускается вовремя и второе успевает ответить. Без context лимита времени на зеркало нет.
 */
export function apiProvider(fetchImpl: FetchLike = defaultFetch, options: ApiProviderOptions = {}): RateProvider {
  const mirrors = options.mirrors ?? API_MIRRORS;
  const base = options.base ?? 'usd';
  return {
    id: 'api',
    async fetchLatest(signal, context) {
      const problems: string[] = [];
      const startedAt = Date.now();
      for (const [i, url] of mirrors.entries()) {
        if (signal?.aborted) throw abortError(signal);
        const budget = context?.timeoutMs;
        const slice = budget === undefined ? undefined : Math.max(1, Math.floor((budget - (Date.now() - startedAt)) / (mirrors.length - i)));
        const attempt = attemptSignal(signal, slice);
        try {
          const { bytes, contentType } = await fetchBytes(fetchImpl, url, attempt.signal);
          return parseCurrencyApiJson(decodeBody(bytes, contentType), base, options.now?.() ?? new Date());
        } catch (e) {
          if (signal?.aborted) throw e;
          problems.push(`${hostOf(url)}: ${attempt.timedOut() && slice !== undefined ? waitedText(slice) : e instanceof Error ? e.message : String(e)}`);
        } finally {
          attempt.dispose();
        }
      }
      throw new Error(`Все зеркала currency-api недоступны (${problems.join('; ') || 'список зеркал пуст'})`);
    },
  };
}

function hostOf(url: string): string {
  return /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url;
}
