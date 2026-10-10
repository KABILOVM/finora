import type { RateTable } from '@/domain/types';
import { abortError } from './http';
import { RateParseError, boundWarnings, isFutureDate, isPlainObject, isRateValue, normalizeDate } from './parseUtil';
import { assessRateTable } from './sanity';
import type { ParsedRateTable, RateProvider, RateTableWithEarlier } from './types';

/**
 * Минимальный срез supabase-js (сам supabase-js здесь не импортируется): достаточно, чтобы прочитать курсы.
 * Возвращаемое значение — PromiseLike, потому что построитель запросов supabase-js «thenable», а не Promise.
 */
export interface RatesQueryResult {
  data: unknown[] | null;
  error: unknown;
}
export interface RatesClient {
  from(table: string): {
    select(cols: string): {
      order(col: string, opts?: { ascending?: boolean }): {
        limit(n: number): PromiseLike<RatesQueryResult>;
      };
    };
  };
}

export interface ServerProviderOptions {
  now?: () => Date;
  /** Сколько последних строк читать (по убыванию as_of). */
  limit?: number;
}

/** Строка public.exchange_rates → таблица. null + причина, если строка непригодна. */
function rowToTable(row: unknown, now: Date): { table: ParsedRateTable } | { problem: string } {
  if (!isPlainObject(row)) return { problem: 'строка не объект' };
  const asOf = typeof row.as_of === 'string' ? normalizeDate(row.as_of) : null;
  if (asOf === null) return { problem: 'некорректный as_of' };
  if (isFutureDate(asOf, now)) return { problem: `as_of ${asOf} из будущего` };
  const pivot = row.pivot;
  if (typeof pivot !== 'string' || !/^[A-Z]{3}$/.test(pivot)) return { problem: 'некорректный pivot' };
  const fetched = typeof row.fetched_at === 'string' ? Date.parse(row.fetched_at) : NaN;
  if (Number.isNaN(fetched)) return { problem: 'некорректный fetched_at' };
  let raw: unknown = row.per_unit;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { problem: 'per_unit не JSON' };
    }
  }
  if (!isPlainObject(raw)) return { problem: 'per_unit не объект' };
  if (raw[pivot] !== undefined && raw[pivot] !== 1) return { problem: 'курс pivot в per_unit не равен 1' };
  const warnings: string[] = [];
  const perUnit: Record<string, number> = { [pivot]: 1 };
  for (const code of Object.keys(raw).sort()) {
    if (code === pivot) continue;
    const v = raw[code];
    if (!/^[A-Z]{3}$/.test(code) || !isRateValue(v)) {
      warnings.push(`${code.slice(0, 20)}: некорректный курс на сервере, запись отброшена`);
      continue;
    }
    perUnit[code] = v;
  }
  const table: RateTable = { asOf, pivot, perUnit, source: 'server', fetchedAt: new Date(fetched).toISOString() };
  const verdict = assessRateTable(table);
  if (!verdict.ok) return { problem: verdict.reasons.join('; ') };
  return { table: { ...table, warnings: boundWarnings(warnings) } };
}

function messageOf(error: unknown): string {
  if (isPlainObject(error) && typeof error.message === 'string') return error.message;
  return String(error);
}

/**
 * Читает последние строки public.exchange_rates (их туда кладёт Edge-функция fetch-rates) и отдаёт самую свежую.
 * При равной дате предпочитается строка с source = 'nbt' (официальные курсы), затем более поздний fetched_at.
 * Строки с битыми данными пропускаются; если пригодных нет — ошибка.
 * Если в самой свежей строке нет TJS (запасной источник без tjs записал её, когда НБТ не работал), к ней прикладывается
 * ближайшая более ранняя строка С TJS (`earlier`): без неё чистая установка осталась бы вообще без курса к сомони.
 */
export function serverProvider(client: RatesClient, options: ServerProviderOptions = {}): RateProvider {
  const limit = options.limit ?? 10;
  return {
    id: 'server',
    async fetchLatest(signal) {
      if (signal?.aborted) throw abortError(signal);
      const { data, error } = await client
        .from('exchange_rates')
        .select('as_of,source,pivot,per_unit,fetched_at')
        .order('as_of', { ascending: false })
        .limit(limit);
      if (signal?.aborted) throw abortError(signal);
      if (error) throw new Error(`Сервер курсов: ${messageOf(error)}`);
      if (!Array.isArray(data) || data.length === 0) throw new RateParseError('На сервере пока нет курсов');

      const now = options.now?.() ?? new Date();
      const problems: string[] = [];
      const usable: { table: ParsedRateTable; official: boolean }[] = [];
      for (const row of data) {
        const parsed = rowToTable(row, now);
        if ('problem' in parsed) problems.push(parsed.problem);
        else usable.push({ table: parsed.table, official: isPlainObject(row) && row.source === 'nbt' });
      }
      // лучшая первой: свежее по дате, при равной дате официальная, затем позднее полученная
      usable.sort(
        (a, b) =>
          (a.table.asOf < b.table.asOf ? 1 : a.table.asOf > b.table.asOf ? -1 : 0) ||
          Number(b.official) - Number(a.official) ||
          (a.table.fetchedAt < b.table.fetchedAt ? 1 : a.table.fetchedAt > b.table.fetchedAt ? -1 : 0),
      );
      const best = usable[0];
      if (best === undefined) throw new RateParseError(`На сервере нет пригодных курсов (${problems.slice(0, 3).join('; ')})`);
      const table = best.table;
      const hasTjs = (t: RateTable): boolean => Object.prototype.hasOwnProperty.call(t.perUnit, 'TJS');
      const withTjs = hasTjs(table) ? undefined : usable.find((u) => u.table.asOf < table.asOf && hasTjs(u.table));
      const result: RateTableWithEarlier = {
        ...table,
        warnings: boundWarnings([...table.warnings, ...problems.map((p) => `Строка сервера пропущена: ${p}`)]),
      };
      if (withTjs) result.earlier = [withTjs.table];
      return result;
    },
  };
}
