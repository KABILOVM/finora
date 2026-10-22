import type { IsoDate } from '@/domain/types';
import { daysBetween } from '@/domain/forecast';
import { addDays, isValidIsoDate } from '@/lib/dates';
import { customPeriod, MAX_CUSTOM_DAYS, MIN_YEAR, quarterOf, quarterPeriod, yearPeriod, type CompareMode, type Period, type PeriodKind } from './periods';

/**
 * Выбор на вкладке «Периоды»: что за период и с чем сравнивать. Живёт в адресе (?tab=periods&kind=quarter&year=2026&q=2&cmp=yoy):
 * «Назад», обновление страницы и ссылка его не сбрасывают. Всё читается с проверкой: чужое или испорченное значение заменяется
 * значением по умолчанию, а не ломает экран.
 */
export interface PeriodSelection {
  kind: PeriodKind;
  year: number;
  quarter: number;
  /** Для «своего периода»; могут не годиться (тогда resolvePeriod вернёт null и экран подскажет). */
  from: IsoDate;
  to: IsoDate;
  cmp: CompareMode;
}

const KINDS: readonly PeriodKind[] = ['year', 'quarter', 'custom'];
const COMPARES: readonly CompareMode[] = ['prev', 'yoy', 'none'];
/** Свой период по умолчанию — последние столько дней. */
export const DEFAULT_CUSTOM_DAYS = 30;

const asInt = (v: string | null): number | null => (v !== null && /^\d{1,4}$/.test(v) ? Number(v) : null);

/** Выбор по умолчанию: идущий год, предыдущий таким же периодом. */
export function defaultSelection(today: IsoDate): PeriodSelection {
  const { year, quarter } = quarterOf(today);
  return { kind: 'year', year, quarter, from: addDays(today, -(DEFAULT_CUSTOM_DAYS - 1)), to: today, cmp: 'prev' };
}

/** Читает выбор из адреса. Год — от MIN_YEAR до нынешнего; квартал нынешнего года — не дальше нынешнего. */
export function parseSelection(params: URLSearchParams, today: IsoDate): PeriodSelection {
  const def = defaultSelection(today);
  const kindRaw = params.get('kind');
  const cmpRaw = params.get('cmp');
  const kind = KINDS.find((k) => k === kindRaw) ?? def.kind;
  const cmp = COMPARES.find((c) => c === cmpRaw) ?? def.cmp;
  const yearRaw = asInt(params.get('year'));
  const year = yearRaw !== null && yearRaw >= MIN_YEAR && yearRaw <= def.year ? yearRaw : def.year;
  const qRaw = asInt(params.get('q'));
  let quarter = qRaw !== null && qRaw >= 1 && qRaw <= 4 ? qRaw : def.quarter;
  if (year === def.year && quarter > def.quarter) quarter = def.quarter; // будущего квартала нет
  const from = params.get('from');
  const to = params.get('to');
  return {
    kind,
    year,
    quarter,
    from: /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') ? (from as IsoDate) : def.from,
    to: /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? (to as IsoDate) : def.to,
    cmp,
  };
}

/** В адрес — только то, что отличается от умолчаний (по умолчанию адрес чистый), и только нужное для вида периода. */
export function selectionToParams(sel: PeriodSelection, today: IsoDate): URLSearchParams {
  const def = defaultSelection(today);
  const q = new URLSearchParams();
  if (sel.kind !== def.kind) q.set('kind', sel.kind);
  if (sel.kind === 'year' && sel.year !== def.year) q.set('year', String(sel.year));
  if (sel.kind === 'quarter') {
    if (sel.year !== def.year) q.set('year', String(sel.year));
    if (sel.year !== def.year || sel.quarter !== def.quarter) q.set('q', String(sel.quarter));
  }
  if (sel.kind === 'custom') {
    if (sel.from !== def.from) q.set('from', sel.from);
    if (sel.to !== def.to) q.set('to', sel.to);
  }
  if (sel.cmp !== def.cmp) q.set('cmp', sel.cmp);
  return q;
}

/** Период по выбору; null — даты не годятся (конец раньше начала, будущее начало, слишком длинный период). */
export function resolvePeriod(sel: PeriodSelection, today: IsoDate): Period | null {
  if (sel.kind === 'year') return yearPeriod(sel.year, today);
  if (sel.kind === 'quarter') return quarterPeriod(sel.year, sel.quarter, today);
  return customPeriod(sel.from, sel.to, today);
}

/**
 * Для года «с предыдущим» и «год назад» — одно и то же: оставляем одно. Нужно, чтобы выбор «год назад» при переходе на год не
 * оставлял в списке пункт, которого там нет.
 */
export function effectiveCompare(kind: PeriodKind, cmp: CompareMode): CompareMode {
  return kind === 'year' && cmp === 'yoy' ? 'prev' : cmp;
}

/** Что не так с датами своего периода (текст для подсказки под полем); null — даты годятся. Те же условия, что у customPeriod. */
export function customProblem(from: string, to: string, today: IsoDate): string | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return 'Укажите обе даты';
  if (from < `${MIN_YEAR}-01-01`) return `Начало не раньше ${MIN_YEAR} года`;
  if (from > today) return 'Начало периода ещё не наступило';
  if (from > to) return 'Начало позже конца';
  if (daysBetween(from, to > today ? today : to) + 1 > MAX_CUSTOM_DAYS) return 'Период не длиннее пяти лет';
  return null;
}
