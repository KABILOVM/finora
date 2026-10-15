import { addDays } from '@/lib/dates';
import { daysBetween, floorDiv } from './forecast';
import { nextOccurrence } from './schedule';
import type { Frequency, IsoDate, Minor, RecurringRule, Transaction, UUID } from './types';

/**
 * «Похоже на подписку»: повторяющиеся расходы, которые ещё не заведены как регулярный платёж. ЧИСТАЯ функция (без базы и часов).
 *
 * Расходы одного кошелька группируются по заметке (без регистра и лишних пробелов); без заметки — по категории и точной сумме.
 * Группа — подписка, если в её свежей серии (без дублей в один день) не меньше MIN_REPEATS платежей, суммы отличаются не больше чем
 * на 5% от медианы, а промежутки между платежами все укладываются в один из шагов: неделя, две недели, месяц.
 * Раз в год не ищем: три годовых платежа — это больше двух лет истории, а смотрим мы WINDOW_DAYS дней.
 * Давно прекратившиеся (последний платёж — больше двух шагов назад) и уже покрытые регулярным платежом не показываются.
 */

export const MIN_REPEATS = 3;
/** Сколько последних платежей серии смотрим. */
const MAX_SERIES = 12;
/** Расходы старше стольких дней не смотрим. */
export const WINDOW_DAYS = 400;
const AMOUNT_TOLERANCE_PERCENT = 5;

export type SubTx = Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'categoryId' | 'occurredOn' | 'note' | 'debtId' | 'recurringRuleId' | 'deletedAt'>;
export type SubRule = Pick<RecurringRule, 'kind' | 'walletId' | 'amountMinor' | 'categoryId' | 'note' | 'archivedAt' | 'deletedAt'>;

interface Step {
  frequency: Frequency;
  intervalN: number;
  /** Допустимые промежутки между платежами в днях (включительно). */
  min: number;
  max: number;
  /** Номинальная длина шага: для сортировки по стоимости в год. */
  nominal: number;
}

const STEPS: readonly Step[] = [
  { frequency: 'weekly', intervalN: 1, min: 5, max: 9, nominal: 7 },
  { frequency: 'weekly', intervalN: 2, min: 12, max: 16, nominal: 14 },
  { frequency: 'monthly', intervalN: 1, min: 26, max: 35, nominal: 30 },
];

export interface SubscriptionCandidate {
  /** Стабильный ключ: по нему «Не показывать» помнит отказ. */
  key: string;
  walletId: UUID;
  categoryId: UUID | null;
  /** Заметка последнего платежа как её написали (может быть пустой — тогда название берётся из категории). */
  note: string;
  /** Типичная сумма (медиана) в валюте кошелька. */
  amountMinor: Minor;
  frequency: Frequency;
  intervalN: number;
  /** Сколько платежей в серии. */
  count: number;
  lastOn: IsoDate;
  /** Когда ждать следующий (не раньше сегодня). */
  nextOn: IsoDate;
}

export const normNote = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');

function median(values: readonly Minor[]): Minor {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : floorDiv(sorted[mid - 1]! + sorted[mid]!, 2);
}

/** |a − m| ≤ 5% от m — целыми числами. */
const near = (a: Minor, m: Minor): boolean => Math.abs(a - m) * 100 <= m * AMOUNT_TOLERANCE_PERCENT;

/** Подходит ли серия под шаг: суммы близки к медиане, все промежутки в пределах шага. */
function fits(series: readonly SubTx[], step: Step): Minor | null {
  const m = median(series.map((t) => t.amountMinor));
  if (!series.every((t) => near(t.amountMinor, m))) return null;
  for (let i = 1; i < series.length; i++) {
    const gap = daysBetween(series[i - 1]!.occurredOn, series[i]!.occurredOn);
    if (gap < step.min || gap > step.max) return null;
  }
  return m;
}

const covers = (rule: SubRule, c: { walletId: UUID; categoryId: UUID | null; noteKey: string; amountMinor: Minor }): boolean =>
  rule.deletedAt === null &&
  rule.archivedAt === null &&
  rule.kind === 'expense' &&
  rule.walletId === c.walletId &&
  near(rule.amountMinor, c.amountMinor) &&
  ((c.noteKey !== '' && normNote(rule.note) === c.noteKey) || (c.categoryId !== null && rule.categoryId === c.categoryId));

/** Повторяющиеся расходы, похожие на подписки; дорогие (в пересчёте на год) первыми. today — сегодняшняя дата 'ГГГГ-ММ-ДД'. */
export function detectRecurring(txs: readonly SubTx[], rules: readonly SubRule[], today: IsoDate): SubscriptionCandidate[] {
  const groups = new Map<string, SubTx[]>();
  for (const t of txs) {
    if (t.deletedAt !== null || t.kind !== 'expense' || t.debtId !== null || t.recurringRuleId !== null) continue;
    if (t.occurredOn > today || daysBetween(t.occurredOn, today) > WINDOW_DAYS) continue;
    const note = normNote(t.note);
    let key: string;
    if (note !== '') key = `${t.walletId}|n:${note}`;
    else if (t.categoryId !== null) key = `${t.walletId}|c:${t.categoryId}|a:${t.amountMinor}`;
    else continue; // ни заметки, ни категории: что именно повторяется — неизвестно
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: (SubscriptionCandidate & { yearly: number })[] = [];
  for (const [key, list] of groups) {
    // один платёж на дату (два чека в один день — не подписка); порядок — по возрастанию дат
    const byDate = new Map<IsoDate, SubTx>();
    for (const t of [...list].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.id < b.id ? -1 : 1))) {
      if (!byDate.has(t.occurredOn)) byDate.set(t.occurredOn, t);
    }
    const all = [...byDate.values()].slice(-MAX_SERIES);
    if (all.length < MIN_REPEATS) continue;

    let found: { series: SubTx[]; step: Step; amount: Minor } | null = null;
    // самая длинная свежая серия, которая ложится в шаг (цена могла измениться — старые платежи тогда отбрасываются)
    search: for (let n = all.length; n >= MIN_REPEATS; n--) {
      const series = all.slice(all.length - n);
      for (const step of STEPS) {
        const amount = fits(series, step);
        if (amount !== null) {
          found = { series, step, amount };
          break search;
        }
      }
    }
    if (!found) continue;

    const last = found.series[found.series.length - 1]!;
    if (daysBetween(last.occurredOn, today) > 2 * found.step.max) continue; // давно прекратилось
    const noteKey = normNote(last.note);
    if (rules.some((r) => covers(r, { walletId: last.walletId, categoryId: last.categoryId, noteKey, amountMinor: found.amount }))) continue;
    const after = last.occurredOn > addDays(today, -1) ? last.occurredOn : addDays(today, -1);
    const nextOn = nextOccurrence({ frequency: found.step.frequency, intervalN: found.step.intervalN, startOn: last.occurredOn, endOn: null }, after);
    if (nextOn === null) continue;
    out.push({
      key,
      walletId: last.walletId,
      categoryId: last.categoryId,
      note: last.note.trim(),
      amountMinor: found.amount,
      frequency: found.step.frequency,
      intervalN: found.step.intervalN,
      count: found.series.length,
      lastOn: last.occurredOn,
      nextOn,
      yearly: found.amount * Math.round(365 / found.step.nominal),
    });
  }
  out.sort((a, b) => b.yearly - a.yearly || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.map(({ yearly: _yearly, ...c }) => c);
}
