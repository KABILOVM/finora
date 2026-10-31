import { endOfMonth } from './forecast';
import { ceilDiv, goalProgress, type GoalProgress } from './goals';
import { addMinor, isMinor } from './money';
import type { CurrencyCode, IsoDate, Minor, UUID } from './types';

/**
 * Цели накопления в «Бюджетах» — ЧИСТЫЕ функции (без базы, React и часов): сколько отложить в этом месяце, сколько из-за этого
 * можно тратить в день и какие траты придётся сократить или не делать, чтобы успеть к сроку.
 *
 *  1. На каждую цель — «нужно отложить в этом месяце» по тому же правилу, что у целей кошельков (domain/goals.ts savingNudge):
 *     (остаток до цели + уже отложенное в этом месяце) ÷ месяцев до срока, вверх; вычитаем то, что уже отложено в этом месяце.
 *  2. Сумма по целям (S) раскладывается на горизонт прогноза «Осталось на день» (H дней): резерв R = S × min(H, дней до конца
 *     месяца) ÷ дней до конца месяца, вверх. Если горизонт короче месяца (близкая зарплата), остальное досчитается после неё.
 *  3. Лимит в день с целью = лимит без цели − резерв в день (вверх), не ниже 0. Всё считается над ПРОГНОЗОМ, который уже вычел
 *     обязательные платежи и долги, поэтому платежи второй раз не вычитаются.
 *  4. Разбор по категориям. «Привычные траты» — средние за прошлые месяцы по категориям, пересчитанные на горизонт. Обязательные
 *     категории (Category.essential) и траты без категории не урезаем. Платежи по расписанию уже вычтены из прогноза, поэтому их
 *     долю не считаем второй раз: из привычных трат обязательных категорий вычитаем обязательства прогноза.
 *     Нужно сократить C = R − (лимит без цели × H − привычные траты), не меньше 0. C раскладывается на необязательные категории
 *     пропорционально привычным тратам (метод наибольших остатков: сумма ровно C). Не хватает необязательных трат — «впритык».
 *  5. Деление целочисленное (BigInt), никогда не обещаем больше, чем есть. Переполнение — признак ошибки, не исключение.
 *  6. «Впритык» (даже без необязательных трат не хватает) → подсказка срока catchUp: сколько удаётся отложить, если не тратить на
 *     необязательное (деньги на горизонте минус обязательные траты), и самая ранняя дата, к которой при таком темпе накопятся остатки
 *     всех целей. Это нижняя граница срока, а не обещание: темп берётся по этому месяцу и предполагает такой же в следующих.
 */

export type GoalState = 'active' | 'reached' | 'overdue' | 'other-currency';

/** Цель в том виде, в каком нужна расчёту. */
export interface PlanGoal {
  id: UUID;
  targetMinor: Minor;
  currency: CurrencyCode;
  dueOn: IsoDate;
  /** Накоплено: остаток привязанного кошелька; 0 — кошелёк не привязан. */
  savedMinor: Minor;
  /** Сколько пришло на кошелёк за этот месяц (domain/goals.ts walletNetFlow); 0 — кошелёк не привязан. Отрицательное считается нулём. */
  savedThisMonthMinor: Minor;
}

export interface GoalPlanItem {
  id: UUID;
  state: GoalState;
  /** null — цель в другой валюте, чем основная: сравнивать нельзя. */
  progress: GoalProgress | null;
  /** Сколько нужно отложить за этот месяц целиком (0, если цель не «активна»). */
  monthNeedMinor: Minor;
  /** Сколько уже отложено в этом месяце. */
  savedThisMonthMinor: Minor;
  /** Сколько ещё отложить в этом месяце. */
  leftThisMonthMinor: Minor;
}

/** Что показывает прогноз «Осталось на день» (domain/forecast.ts DailyForecastOk) — только нужные расчёту поля. */
export interface PlanForecast {
  perDayMinor: Minor;
  /** Дней от сегодня до конца горизонта прогноза включительно (≥ 1). */
  daysLeft: number;
  /** Обязательные платежи и долги до конца горизонта (уже вычтены из perDayMinor). */
  obligationsMinor: Minor;
}

/** Привычные траты категории за месяц (среднее за прошлые месяцы), в основной валюте. */
export interface UsualCategory {
  categoryId: UUID;
  usualMonthlyMinor: Minor;
  /** Обязательная категория (или подкатегория обязательной): не урезаем. */
  essential: boolean;
}

export interface UsualSpend {
  categories: readonly UsualCategory[];
  /** Привычные траты, которые нельзя отнести к категории (комиссии, «Без категории»): за месяц, не урезаем. */
  uncategorizedMonthlyMinor: Minor;
}

export interface SavingsPlanInput {
  today: IsoDate;
  base: CurrencyCode;
  goals: readonly PlanGoal[];
  /** null — прогноза нет (нет кошельков, суммы слишком большие): считаем только «сколько отложить». */
  forecast: PlanForecast | null;
  /** null — прошлых трат нет: разбора по категориям не будет, останется лимит в день. */
  usual: UsualSpend | null;
}

export type CategoryAdviceKind = 'keep' | 'trim' | 'skip';

export interface CategoryAdvice {
  categoryId: UUID;
  essential: boolean;
  /** Сколько на неё обычно ушло бы до конца горизонта. */
  usualRestMinor: Minor;
  /** На сколько сократить (0 — не нужно или нельзя). */
  cutMinor: Minor;
  /** Сколько можно потратить: обычное − сокращение. */
  allowedMinor: Minor;
  /** keep — тратьте как обычно; trim — потратьте не больше allowedMinor; skip — лучше не тратить совсем. */
  advice: CategoryAdviceKind;
}

/**
 * idle не бывает (тогда нет и DayPlan). ok — привычные траты и так укладываются; cut — нужно сократить необязательное;
 * tight — даже без необязательных трат не хватает uncoveredMinor: пора менять срок или сумму.
 */
export type PlanStatus = 'ok' | 'cut' | 'tight';

/** Дольше стольких месяцев «самую раннюю дату» не называем: она ничего не подскажет. */
export const MAX_CATCHUP_MONTHS = 120;

/**
 * Подсказка срока для «впритык». date — самая ранняя реалистичная дата накопить остатки всех активных целей при темпе monthlyMinor
 * (всё, что остаётся после обязательных трат); far — дольше MAX_CATCHUP_MONTHS; none — после обязательных трат ничего не остаётся.
 */
export type CatchUp =
  | { kind: 'date'; date: IsoDate; months: number; monthlyMinor: Minor }
  | { kind: 'far'; monthlyMinor: Minor }
  | { kind: 'none' };

export interface DayPlan {
  status: PlanStatus;
  horizonDays: number;
  /** Сколько нужно отложить за горизонт прогноза (доля от «ещё отложить в этом месяце»). */
  reserveMinor: Minor;
  /** Лимит в день без цели (из прогноза). */
  perDayMinor: Minor;
  /** Лимит в день с учётом цели. */
  perDayWithGoalMinor: Minor;
  /** Насколько цель уменьшает лимит в день. */
  cutPerDayMinor: Minor;
  /** Сколько нужно сократить привычные траты за горизонт; null — привычных трат не знаем. */
  cutTotalMinor: Minor | null;
  /** Не хватает даже без необязательных трат (для tight; иначе 0). */
  uncoveredMinor: Minor;
  /** Разбор по категориям: пусто, если привычных трат нет. Сначала те, где сокращение больше. */
  categories: CategoryAdvice[];
  /** Когда реально успеть — только при status = 'tight', иначе null. */
  catchUp: CatchUp | null;
}

export interface SavingsPlan {
  ok: true;
  /** Цели в порядке входа. */
  items: GoalPlanItem[];
  /** Сколько ещё откладывать в этом месяце по всем активным целям. */
  leftThisMonthMinor: Minor;
  /** null — откладывать в этом месяце уже нечего или прогноза нет. */
  day: DayPlan | null;
}

export type SavingsPlanResult = SavingsPlan | { ok: false; error: 'overflow' };

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function toMinor(v: bigint): Minor {
  if (v > MAX || v < -MAX) throw new RangeError('Переполнение суммы');
  return Number(v);
}

/** floor(a × b ÷ c) для a, b ≥ 0, c ≥ 1. */
const mulDivFloor = (a: Minor, b: number, c: number): Minor => toMinor((BigInt(a) * BigInt(b)) / BigInt(c));
/** ceil(a × b ÷ c) для a, b ≥ 0, c ≥ 1. */
const mulDivCeil = (a: Minor, b: number, c: number): Minor => toMinor((BigInt(a) * BigInt(b) + BigInt(c) - 1n) / BigInt(c));

/** Дней в месяце даты и дней от неё до конца месяца включительно. */
export function monthSpan(today: IsoDate): { totalDays: number; daysToEnd: number } {
  const totalDays = Number(endOfMonth(today).slice(8, 10));
  return { totalDays, daysToEnd: totalDays - Number(today.slice(8, 10)) + 1 };
}

/**
 * Разложить total на части пропорционально весам (целые ≥ 0, сумма > 0, total ≤ сумма весов) так, чтобы сумма частей была ровно total:
 * сначала целая часть доли, остаток — по одной копейке тем, у кого дробная часть больше (при равенстве — раньше в списке).
 */
export function distributeByWeight(total: Minor, weights: readonly Minor[]): Minor[] {
  const sum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (sum <= 0n || total <= 0) return weights.map(() => 0);
  const t = BigInt(total);
  const parts = weights.map((w) => ({ share: (t * BigInt(w)) / sum, rem: (t * BigInt(w)) % sum }));
  let left = t - parts.reduce((acc, p) => acc + p.share, 0n);
  const order = parts.map((_, i) => i).sort((a, b) => (parts[b]!.rem > parts[a]!.rem ? 1 : parts[b]!.rem < parts[a]!.rem ? -1 : a - b));
  const out = parts.map((p) => p.share);
  for (const i of order) {
    if (left <= 0n) break;
    if (parts[i]!.rem > 0n) {
      out[i] = out[i]! + 1n;
      left -= 1n;
    }
  }
  return out.map(toMinor);
}

/** Цель → шаг плана: состояние и сколько откладывать в этом месяце. */
export function planGoal(goal: PlanGoal, base: CurrencyCode, today: IsoDate): GoalPlanItem {
  if (goal.currency !== base) {
    return { id: goal.id, state: 'other-currency', progress: null, monthNeedMinor: 0, savedThisMonthMinor: 0, leftThisMonthMinor: 0 };
  }
  const progress = goalProgress({ balanceMinor: goal.savedMinor, goalMinor: goal.targetMinor, goalOn: goal.dueOn, today });
  const saved = isMinor(goal.savedThisMonthMinor) ? Math.max(0, goal.savedThisMonthMinor) : 0;
  const idle = { id: goal.id, progress, monthNeedMinor: 0, savedThisMonthMinor: saved, leftThisMonthMinor: 0 };
  if (progress.reached) return { ...idle, state: 'reached' };
  if (progress.monthsLeft === null) return { ...idle, state: 'overdue' };
  const need = ceilDiv(addMinor(progress.remainingMinor, saved), progress.monthsLeft);
  return { ...idle, state: 'active', monthNeedMinor: need, leftThisMonthMinor: need > saved ? need - saved : 0 };
}

/** Дата через n месяцев; день месяца, которого в нём нет (31-е в апреле), сдвигается на последний день месяца. */
export function addMonths(date: IsoDate, n: number): IsoDate {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Самая ранняя реалистичная дата. fundable — сколько можно отложить за горизонт, если не тратить на необязательное; remaining — сколько
 * ещё накопить по всем активным целям. Деньги на горизонте — запас, а не ежемесячный доход, поэтому растягивать его на весь месяц нельзя:
 * темп в месяц = fundable, а если горизонт короче остатка месяца (близкая зарплата) — fundable, пересчитанный на остаток месяца, вниз
 * (так же, как резерв: tight ⇔ резерв > fundable ⇔ месячная потребность > темп).
 */
function catchUpPlan(fundable: Minor, horizon: number, today: IsoDate, remaining: Minor): CatchUp {
  const { daysToEnd } = monthSpan(today);
  const funds = Math.max(0, fundable);
  const monthly = horizon >= daysToEnd ? funds : mulDivFloor(funds, daysToEnd, horizon);
  if (monthly <= 0) return { kind: 'none' };
  const months = Math.max(1, ceilDiv(remaining, monthly));
  if (months > MAX_CATCHUP_MONTHS) return { kind: 'far', monthlyMinor: monthly };
  return { kind: 'date', date: addMonths(today, months), months, monthlyMinor: monthly };
}

function dayPlan(reserve: Minor, forecast: PlanForecast, usual: UsualSpend | null, today: IsoDate, remaining: Minor): DayPlan {
  const horizon = forecast.daysLeft;
  const perDay = forecast.perDayMinor;
  const cutPerDay = mulDivCeil(reserve, 1, horizon);
  const perDayWithGoal = perDay > cutPerDay ? perDay - cutPerDay : 0;
  const allowance = toMinor(BigInt(perDay) * BigInt(horizon)); // сколько можно потратить за горизонт без цели
  const base = { horizonDays: horizon, reserveMinor: reserve, perDayMinor: perDay, perDayWithGoalMinor: perDayWithGoal, cutPerDayMinor: cutPerDay };

  if (usual === null) {
    // истории трат нет: без разбора по категориям — «можно тратить в день столько-то»; не хватает денег даже на цель — впритык
    const short = reserve > allowance ? reserve - allowance : 0;
    return {
      ...base,
      status: short > 0 ? 'tight' : 'cut',
      cutTotalMinor: null,
      uncoveredMinor: short,
      categories: [],
      catchUp: short > 0 ? catchUpPlan(allowance, horizon, today, remaining) : null,
    };
  }

  const { totalDays } = monthSpan(today);
  const rows = usual.categories
    .filter((c) => isMinor(c.usualMonthlyMinor) && c.usualMonthlyMinor > 0)
    .map((c) => ({ ...c, rest: mulDivFloor(c.usualMonthlyMinor, horizon, totalDays) }));
  const flexRows = rows.filter((r) => !r.essential);
  const flexRest = flexRows.reduce((acc, r) => addMinor(acc, r.rest), 0);
  const protectedRest = rows
    .filter((r) => r.essential)
    .reduce((acc, r) => addMinor(acc, r.rest), mulDivFloor(Math.max(0, usual.uncategorizedMonthlyMinor), horizon, totalDays));
  // платежи по расписанию уже вычтены из прогноза: их долю в обязательных тратах второй раз не считаем
  const protectedUnscheduled = protectedRest > forecast.obligationsMinor ? protectedRest - forecast.obligationsMinor : 0;
  const habitual = addMinor(flexRest, protectedUnscheduled);

  // сократить нужно: резерв + (привычные траты − можно потратить), не меньше 0
  const needCut = toMinor(BigInt(reserve) + BigInt(habitual) - BigInt(allowance));
  const cutTotal = needCut > 0 ? needCut : 0;

  const covered = Math.min(cutTotal, flexRest);
  const cuts = covered > 0 ? distributeByWeight(covered, flexRows.map((r) => r.rest)) : flexRows.map(() => 0);
  const cutById = new Map(flexRows.map((r, i) => [r.categoryId, cuts[i] ?? 0] as const));
  const categories: CategoryAdvice[] = rows
    .map((r): CategoryAdvice => {
      const cut = cutById.get(r.categoryId) ?? 0;
      return {
        categoryId: r.categoryId,
        essential: r.essential,
        usualRestMinor: r.rest,
        cutMinor: cut,
        allowedMinor: r.rest - cut,
        advice: cut > 0 && cut >= r.rest ? 'skip' : cut > 0 ? 'trim' : 'keep',
      };
    })
    .sort((a, b) => b.cutMinor - a.cutMinor || b.usualRestMinor - a.usualRestMinor || (a.categoryId < b.categoryId ? -1 : 1));

  const uncovered = cutTotal > flexRest ? cutTotal - flexRest : 0;
  // сколько можно отложить, если не тратить на необязательное: деньги на горизонте минус обязательные траты, не ушедшие в прогноз
  const fundable = allowance > protectedUnscheduled ? allowance - protectedUnscheduled : 0;
  return {
    ...base,
    status: cutTotal === 0 ? 'ok' : uncovered > 0 ? 'tight' : 'cut',
    cutTotalMinor: cutTotal,
    uncoveredMinor: uncovered,
    categories,
    catchUp: uncovered > 0 ? catchUpPlan(fundable, horizon, today, remaining) : null,
  };
}

/** План целей накопления на сегодня. Переполнение сумм — { ok: false }, а не исключение. */
export function computeSavingsPlan(input: SavingsPlanInput): SavingsPlanResult {
  try {
    const items = input.goals.map((g) => planGoal(g, input.base, input.today));
    let left: Minor = 0;
    for (const it of items) left = addMinor(left, it.leftThisMonthMinor);
    if (left === 0 || input.forecast === null || !Number.isInteger(input.forecast.daysLeft) || input.forecast.daysLeft < 1) {
      return { ok: true, items, leftThisMonthMinor: left, day: null };
    }
    const { daysToEnd } = monthSpan(input.today);
    const horizon = input.forecast.daysLeft;
    const reserve = horizon >= daysToEnd ? left : mulDivCeil(left, horizon, daysToEnd);
    let remaining: Minor = 0;
    for (const it of items) if (it.state === 'active' && it.progress) remaining = addMinor(remaining, it.progress.remainingMinor);
    return { ok: true, items, leftThisMonthMinor: left, day: dayPlan(reserve, input.forecast, input.usual, input.today, remaining) };
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: 'overflow' };
    throw e;
  }
}

// ───────────────────────── привычные траты из истории ─────────────────────────

/** Строка трат месяца по категории (как SpendRow из budgetProgress.ts). */
export interface HistoryRow {
  categoryId: UUID | null;
  totalMinor: Minor;
  kind?: 'fee';
}

export interface HistoryMonth {
  byCategory: readonly HistoryRow[];
  /** Все расходы месяца (с комиссиями и «без категории»). */
  expenseMinor: Minor;
}

/**
 * Привычные траты за месяц по категориям: среднее по прошлым месяцам, в которых вообще были траты (пустой месяц — новый
 * пользователь или отпуск от приложения — среднее не занижает). Нет ни одного месяца с тратами — null. Сумма траты без категории
 * и комиссий считается отдельно, они не урезаются. isEssential: категория обязательна сама или через родителя.
 * Целая арифметика, вниз. RangeError — суммы не помещаются.
 */
export function usualSpendFromHistory(months: readonly HistoryMonth[], isEssential: (categoryId: UUID) => boolean): UsualSpend | null {
  const used = months.filter((m) => isMinor(m.expenseMinor) && m.expenseMinor > 0);
  if (used.length === 0) return null;
  const n = BigInt(used.length);
  const byCategory = new Map<UUID, bigint>();
  let attributed = 0n;
  let expenses = 0n;
  for (const m of used) {
    expenses += BigInt(m.expenseMinor);
    for (const r of m.byCategory) {
      if (r.kind === 'fee' || r.categoryId === null || !isMinor(r.totalMinor) || r.totalMinor <= 0) continue;
      byCategory.set(r.categoryId, (byCategory.get(r.categoryId) ?? 0n) + BigInt(r.totalMinor));
      attributed += BigInt(r.totalMinor);
    }
  }
  const categories = [...byCategory.entries()]
    .map(([categoryId, sum]) => ({ categoryId, usualMonthlyMinor: toMinor(sum / n), essential: isEssential(categoryId) }))
    .filter((c) => c.usualMonthlyMinor > 0)
    .sort((a, b) => b.usualMonthlyMinor - a.usualMonthlyMinor || (a.categoryId < b.categoryId ? -1 : 1));
  const rest = expenses - attributed;
  return { categories, uncategorizedMonthlyMinor: rest > 0n ? toMinor(rest / n) : 0 };
}
