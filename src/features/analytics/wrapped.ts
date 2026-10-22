import { isAdjustment } from '@/domain/adjustment';
import { daysBetween, floorDiv } from '@/domain/forecast';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { longDate } from '@/features/budgets/budgetText';
import { addDays, monthTitle } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { isSpend, type AnomalyTx } from './anomalies';
import { weekdayOf, WEEKDAYS_DATIVE_PLURAL } from './analytics';
import { percentChange } from './periodText';
import { highlights, type Period, type PeriodReport } from './periods';

/**
 * «Итоги года» карточками: короткая серия слайдов по отчёту за год (periods.ts) и операциям года. ЧИСТЫЕ функции (без React и базы):
 * факты, которых нет в отчёте (самая крупная трата, день недели, серия дней без трат), считает wrappedFacts, а wrappedCards
 * собирает из них и из отчёта слайды. Слайд, для которого нет данных, пропускается. Суммы в слайдах — структурные (`{ money }`),
 * чтобы экран выводил их через MoneyText: режим «Скрыть суммы» тогда прячет и их.
 */

export type Seg = string | { money: Minor; tone?: 'income' | 'expense' | 'none' };

export interface WrappedCard {
  id: 'intro' | 'totals' | 'savings' | 'categories' | 'months' | 'biggest' | 'weekday' | 'streak' | 'compare';
  /** Короткий заголовок слайда. */
  heading: string;
  /** Главное на слайде крупно. */
  big: Seg[];
  /** Пояснения под ним. */
  lines: Seg[][];
  tone: 'brand' | 'income' | 'expense';
}

export interface WrappedFacts {
  /** Сколько операций (расходов и доходов) внёс человек за период. */
  operations: number;
  /** Самая крупная трата; null — расходов не было. */
  biggest: { txId: UUID; categoryId: UUID | null; note: string; amountMinor: Minor; occurredOn: IsoDate } | null;
  /** День недели, в который в среднем тратят больше всего (0 — понедельник); null — данных мало. */
  weekday: { day: number; avgMinor: Minor } | null;
  /** Самая длинная серия дней подряд без трат; null — серий короче двух дней нет. */
  streak: { days: number; from: IsoDate; to: IsoDate } | null;
}

/** Меньше стольких таких дней в периоде — «чаще всего тратите по …» не говорим (мало данных). */
export const MIN_WEEKDAY_DAYS = 4;
/** Серию без трат показываем, начиная с этой длины. */
export const MIN_STREAK_DAYS = 3;

type Tx = AnomalyTx;

export function wrappedFacts(txs: readonly Tx[], period: Pick<Period, 'from' | 'to'>, base: CurrencyCode): WrappedFacts {
  const inRange = txs.filter((t) => t.deletedAt === null && t.occurredOn >= period.from && t.occurredOn <= period.to);
  const human = inRange.filter((t) => (t.kind === 'expense' || t.kind === 'income') && (t.debtId ?? null) === null && !isAdjustment(t));
  const spends = inRange.filter((t) => isSpend(t, base));

  let biggest: WrappedFacts['biggest'] = null;
  for (const t of spends) {
    if (t.baseAmountMinor <= 0) continue;
    if (biggest === null || t.baseAmountMinor > biggest.amountMinor || (t.baseAmountMinor === biggest.amountMinor && t.id < biggest.txId)) {
      biggest = { txId: t.id, categoryId: t.categoryId, note: t.note.trim(), amountMinor: t.baseAmountMinor, occurredOn: t.occurredOn };
    }
  }

  // день недели: сумма трат ÷ сколько таких дней прошло (с первой записи периода: до неё человек приложением не пользовался)
  const firstOn = human.reduce<IsoDate | null>((m, t) => (m === null || t.occurredOn < m ? t.occurredOn : m), null);
  let weekday: WrappedFacts['weekday'] = null;
  let streak: WrappedFacts['streak'] = null;
  if (firstOn !== null) {
    const totals = new Array<Minor>(7).fill(0);
    for (const t of spends) totals[weekdayOf(t.occurredOn)]! += t.baseAmountMinor;
    const counts = new Array<number>(7).fill(0);
    const spendDays = new Set(spends.map((t) => t.occurredOn));
    let run = 0;
    let runFrom: IsoDate = firstOn;
    const total = daysBetween(firstOn, period.to) + 1;
    for (let i = 0; i < total; i++) {
      const d = addDays(firstOn, i);
      counts[weekdayOf(d)]!++;
      if (spendDays.has(d)) {
        run = 0;
      } else {
        if (run === 0) runFrom = d;
        run++;
        if (run >= MIN_STREAK_DAYS && (streak === null || run > streak.days)) streak = { days: run, from: runFrom, to: d };
      }
    }
    let best = -1;
    for (let w = 0; w < 7; w++) {
      if (counts[w]! < MIN_WEEKDAY_DAYS) continue;
      const avg = floorDiv(totals[w]!, counts[w]!);
      if (avg > 0 && (best < 0 || avg > (weekday?.avgMinor ?? 0))) {
        best = w;
        weekday = { day: w, avgMinor: avg };
      }
    }
  }
  return { operations: human.length, biggest, weekday, streak };
}

const days = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;

/** Слайды «Итогов года». `categoryName` — название категории по id (null — «Без категории»). */
export function wrappedCards(report: PeriodReport, facts: WrappedFacts, categoryName: (id: UUID | null) => string, today: IsoDate): WrappedCard[] {
  const { period, current, compare } = report;
  const cards: WrappedCard[] = [];
  const year = period.from.slice(0, 4);
  if (current.incomeMinor <= 0 && current.expenseMinor <= 0) return cards;

  cards.push({
    id: 'intro',
    heading: period.partial ? `${year} год: итоги на сегодня` : `Ваш ${year} год`,
    big: [period.partial ? 'Пока что' : 'Итоги года'],
    lines: [
      [`С ${longDate(period.from)} по ${longDate(period.to)}${period.partial && period.to === today ? ' (сегодня)' : ''}.`],
      [`Внесено операций: ${facts.operations}.`],
    ],
    tone: 'brand',
  });

  cards.push({
    id: 'totals',
    heading: 'Деньги за год',
    big: [{ money: current.expenseMinor, tone: 'none' }],
    lines: [
      ['потрачено'],
      ['Получено: ', { money: current.incomeMinor, tone: 'none' }],
      ['Разница: ', { money: current.netMinor, tone: 'none' }],
    ],
    tone: 'expense',
  });

  if (current.savingsRate !== null) {
    const rate = current.savingsRate;
    const prev = compare?.summary.savingsRate ?? null;
    cards.push({
      id: 'savings',
      heading: 'Норма сбережений',
      big: [`${rate}%`],
      lines: [
        [rate > 0 ? `дохода вы не потратили` : rate === 0 ? 'потратили ровно столько, сколько получили' : 'расходы больше доходов'],
        ...(prev !== null ? [[`В прошлом году было ${prev}%.`]] : []),
      ],
      tone: rate >= 0 ? 'income' : 'expense',
    });
  }

  const topRows = current.expenseByCategory.filter((c) => c.kind !== 'fee' && c.totalMinor > 0).slice(0, 3);
  const top = topRows[0];
  if (top) {
    cards.push({
      id: 'categories',
      heading: 'Куда уходит больше всего',
      big: [categoryName(top.categoryId)],
      lines: topRows.map((c, i) => [`${i + 1}. ${categoryName(c.categoryId)} — `, { money: c.totalMinor, tone: 'none' as const }]),
      tone: 'brand',
    });
  }

  const h = highlights(current);
  if (current.months.length >= 2 && (h.peakExpenseMonth || h.peakIncomeMonth)) {
    cards.push({
      id: 'months',
      heading: 'Месяцы',
      big: [h.peakExpenseMonth ? monthTitle(h.peakExpenseMonth.month).toLowerCase() : ''],
      lines: [
        ...(h.peakExpenseMonth ? [['самый затратный: ', { money: h.peakExpenseMonth.expenseMinor, tone: 'none' as const }]] : []),
        ...(h.peakIncomeMonth ? [[`Самый доходный — ${monthTitle(h.peakIncomeMonth.month).toLowerCase()}: `, { money: h.peakIncomeMonth.incomeMinor, tone: 'none' as const }]] : []),
        ...(h.avgMonthlyExpenseMinor !== null ? [['В среднем в месяц уходит ', { money: h.avgMonthlyExpenseMinor, tone: 'none' as const }]] : []),
      ],
      tone: 'expense',
    });
  }

  if (facts.biggest) {
    const b = facts.biggest;
    cards.push({
      id: 'biggest',
      heading: 'Самая крупная трата',
      big: [{ money: b.amountMinor, tone: 'none' }],
      lines: [[b.note !== '' ? `«${b.note}»` : categoryName(b.categoryId)], [longDate(b.occurredOn)]],
      tone: 'expense',
    });
  }

  if (facts.weekday) {
    cards.push({
      id: 'weekday',
      heading: 'День недели',
      big: [WEEKDAYS_DATIVE_PLURAL[facts.weekday.day] ?? ''],
      lines: [['Чаще всего вы тратите по этим дням: в среднем '], [{ money: facts.weekday.avgMinor, tone: 'none' }, ' в такой день']],
      tone: 'brand',
    });
  }

  if (facts.streak) {
    cards.push({
      id: 'streak',
      heading: 'Без трат',
      big: [days(facts.streak.days)],
      lines: [['подряд без единой траты'], [`С ${longDate(facts.streak.from)} по ${longDate(facts.streak.to)}`]],
      tone: 'income',
    });
  }

  if (compare) {
    const pct = percentChange(current.expenseMinor, compare.summary.expenseMinor);
    if (pct !== null) {
      cards.push({
        id: 'compare',
        heading: period.partial ? 'Против прошлого года' : 'Против прошлого года',
        big: [pct === 0 ? 'столько же' : pct > 0 ? `+${pct}%` : `−${-pct}%`],
        lines: [
          [pct === 0 ? 'расходов, сколько было' : pct > 0 ? 'больше расходов, чем' : 'меньше расходов, чем'],
          [period.partial ? 'за те же дни прошлого года: ' : 'в прошлом году: ', { money: compare.summary.expenseMinor, tone: 'none' }],
        ],
        tone: pct > 0 ? 'expense' : 'income',
      });
    }
  }
  return cards;
}
