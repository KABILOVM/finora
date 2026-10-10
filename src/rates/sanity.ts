import { boundWarnings, isPlainObject, isRateValue, normalizeDate } from './parseUtil';
import type { RateTable } from '@/domain/types';

/*
 * Защита от кривых данных: снимки операций (baseAmountMinor) пересчитываются по курсу ОДИН раз и больше не меняются,
 * поэтому испорченный курс испортит деньги навсегда. Подозрительную таблицу не принимаем молча.
 *
 * Блок между маркерами SHARED:sanity ДОСЛОВНО скопирован в supabase/functions/fetch-rates/index.ts
 * (сервер проверяет таблицу перед записью в exchange_rates). Правишь здесь — правь и там.
 */

// <<< SHARED:sanity
export interface RateAssessment {
  ok: boolean;
  /**
   * Почему отказ. При ok=true непустой список — предупреждение: валюты из `excluded` скакнули, их надо убрать
   * из таблицы (withoutCodes) и не принимать, а остальные курсы таблицы принять.
   */
  reasons: string[];
  /** Только при ok=true и только если есть что убрать: коды валют (не из GUARDED_CURRENCIES) со скачком курса. */
  excluded?: string[];
}

/** Курс любой валюты не должен меняться больше чем на 50% относительно предыдущей сохранённой таблицы. */
export const MAX_RELATIVE_CHANGE = 0.5;

/**
 * Валюты, которые можно выбрать в приложении (копия CURRENCIES из domain/currency.ts, сверяется тестом).
 * Скачок такой валюты отвергает всю таблицу: по ней считаются деньги пользователя. Скачок любой другой (ARS, крипто-монета
 * из currency-api и т.п.) убирает из таблицы только её саму: иначе одна «взбесившаяся» экзотическая валюта навсегда
 * заморозила бы курсы USD и EUR.
 */
export const GUARDED_CURRENCIES: readonly string[] = ['TJS', 'USD', 'EUR', 'RUB', 'KZT', 'UZS', 'KGS', 'CNY', 'TRY', 'AED', 'GBP', 'KRW', 'JPY'];

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const fmt = (n: number): string => String(Number(n.toPrecision(6)));

/** Структура и значения: пусто = таблица пригодна к использованию. */
function tableProblems(t: unknown): string[] {
  if (!isPlainObject(t)) return ['Таблица курсов не является объектом'];
  const out: string[] = [];
  const pivot = t.pivot;
  if (typeof pivot !== 'string' || !/^[A-Z]{3}$/.test(pivot)) out.push('Некорректная опорная валюта');
  if (typeof t.asOf !== 'string' || normalizeDate(t.asOf) !== t.asOf) out.push('Некорректная дата курсов');
  if (typeof t.fetchedAt !== 'string' || Number.isNaN(Date.parse(t.fetchedAt))) out.push('Некорректное время получения курсов');
  const perUnit = t.perUnit;
  if (!isPlainObject(perUnit)) return [...out, 'Нет таблицы курсов perUnit'];
  if (typeof pivot === 'string' && perUnit[pivot] !== 1) out.push('Курс опорной валюты должен быть равен 1');
  const codes = Object.keys(perUnit);
  if (codes.length < 2) out.push('В таблице нет ни одного курса, кроме опорной валюты');
  for (const code of codes) {
    if (!/^[A-Z]{3}$/.test(code)) out.push(`Некорректный код валюты «${code.slice(0, 20)}»`);
    else if (!isRateValue(perUnit[code])) out.push(`Некорректное значение курса ${code}: ${String(perUnit[code]).slice(0, 30)}`);
  }
  return out;
}

interface Jump {
  code: string;
  text: string;
}

/** Сравнение с прошлой таблицей. Таблицы могут иметь разные pivot — тогда сравниваем курсы относительно общей валюты. */
function jumps(next: RateTable, prev: RateTable): { compared: number; found: Jump[] } {
  const common = Object.keys(next.perUnit).filter((c) => hasOwn(prev.perUnit, c));
  if (common.length < 2) return { compared: 0, found: [] }; // сравнивать нечего
  const ref =
    next.pivot === prev.pivot || hasOwn(prev.perUnit, next.pivot)
      ? next.pivot
      : hasOwn(next.perUnit, prev.pivot)
        ? prev.pivot
        : (common[0] as string);
  const nextRef = next.perUnit[ref] as number;
  const prevRef = prev.perUnit[ref] as number;
  const found: Jump[] = [];
  let compared = 0;
  for (const code of common) {
    if (code === ref) continue;
    compared++;
    const a = (next.perUnit[code] as number) / nextRef;
    const b = (prev.perUnit[code] as number) / prevRef;
    const change = (a - b) / b;
    if (Math.abs(change) > MAX_RELATIVE_CHANGE) {
      found.push({ code, text: `${code}: ${fmt(b)} → ${fmt(a)} (${change > 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%)` });
    }
  }
  return { compared, found };
}

/**
 * С какой из сохранённых таблиц (свежие первыми) сравнивать `next`: с самой свежей, где есть опорная валюта `next`.
 * Иначе масштаб относительно неё не проверить: свежая таблица без TJS «слепа» к ошибке в курсе сомони. Нет такой — самая свежая.
 */
export function pickComparable(next: unknown, candidates: readonly RateTable[]): RateTable | null {
  const pivot = isPlainObject(next) ? next.pivot : undefined;
  if (typeof pivot === 'string') {
    const hit = candidates.find((c) => isPlainObject(c) && isPlainObject(c.perUnit) && hasOwn(c.perUnit, pivot));
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

/** Копия таблицы без перечисленных валют (опорную не трогает). */
export function withoutCodes(table: RateTable, codes: readonly string[]): RateTable {
  const perUnit: Record<string, number> = {};
  for (const [code, v] of Object.entries(table.perUnit)) if (code === table.pivot || !codes.includes(code)) perUnit[code] = v;
  return { ...table, perUnit };
}

/**
 * Годится ли таблица `next` для сохранения. Отвергает: битую структуру; нечисловые, не конечные, нулевые,
 * отрицательные и «огромные» значения; скачок курса любой валюты из GUARDED_CURRENCIES больше чем на 50% относительно
 * `previous`; скачки у половины и более сравниваемых валют (так выглядит системная ошибка, например масштаба).
 * Скачок только у валют вне GUARDED_CURRENCIES не отвергает таблицу: ok=true и `excluded` — их надо убрать (withoutCodes).
 */
export function assessRateTable(next: RateTable, previous?: RateTable | null): RateAssessment {
  const bad = tableProblems(next);
  if (bad.length > 0) return { ok: false, reasons: boundWarnings(bad) };
  if (!previous || tableProblems(previous).length > 0) return { ok: true, reasons: [] };
  const { compared, found } = jumps(next, previous);
  if (found.length === 0) return { ok: true, reasons: [] };
  const reasons = boundWarnings(found.map((j) => j.text));
  if (found.some((j) => GUARDED_CURRENCIES.includes(j.code)) || found.length * 2 >= compared) return { ok: false, reasons };
  return { ok: true, reasons, excluded: found.map((j) => j.code) };
}
// SHARED:sanity >>>
