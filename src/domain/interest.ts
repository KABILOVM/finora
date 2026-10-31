import type { Debt, Minor } from './types';

/**
 * Проценты по долгу (кредит в банке) — чистые расчёты без базы и без React.
 *
 * Как это устроено: у долга хранится СУММА процентов за весь срок (interestMinor), а ставка и срок — то, из чего она получена
 * (для показа и подсказки платежа). Остаток считается от «суммы долга + проценты» (см. domain/debts.ts), поэтому сумму процентов
 * всегда можно поправить руками под договор: у банков бывают комиссии, дифференцированные платежи, плата за ведение счёта.
 * Калькулятор ниже — аннуитет («равными платежами»), как у большинства банков: проценты начисляются каждый месяц на остаток
 * основного долга, платёж каждый месяц один и тот же, последний добирает остаток.
 */

/** Ставка хранится целым числом в сотых долях процента годовых: 24,5 % = 2450. Так деньги и ставки не делят дробными числами. */
export const RATE_BP_MIN = 1;
export const RATE_BP_MAX = 100_000; // 1000 % годовых — выше только опечатка
export const TERM_MONTHS_MIN = 1;
export const TERM_MONTHS_MAX = 600; // 50 лет — как предел «Платить частями» (payoff.ts)
/** Сумма процентов — в тех же границах, что и сумма долга (1e15 минорных единиц, см. supabase/schema.sql). */
export const INTEREST_MINOR_MAX = 1_000_000_000_000_000;

export interface AnnuityPlan {
  /** Обычный ежемесячный платёж. */
  paymentMinor: Minor;
  /** Последний платёж: добирает остаток, поэтому чуть отличается от обычного (в копейках). */
  lastPaymentMinor: Minor;
  /** Проценты за весь срок. */
  interestMinor: Minor;
  /** Всего вернуть: сумма долга + проценты. */
  totalMinor: Minor;
}

/**
 * Аннуитет: сумма долга principalMinor, ставка rateBp (сотые доли процента годовых), срок months (целых месяцев).
 * Проценты каждого месяца округляются до минорной единицы, как в банковском графике; платёж — тоже.
 * null — посчитать нельзя: исходные числа вне границ или итог не помещается в безопасное целое.
 */
export function annuityPlan(principalMinor: Minor, rateBp: number, months: number): AnnuityPlan | null {
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0 || principalMinor > INTEREST_MINOR_MAX) return null;
  if (!Number.isSafeInteger(rateBp) || rateBp < RATE_BP_MIN || rateBp > RATE_BP_MAX) return null;
  if (!Number.isSafeInteger(months) || months < TERM_MONTHS_MIN || months > TERM_MONTHS_MAX) return null;

  const r = rateBp / 10_000 / 12; // ставка за месяц
  // платёж = S·r / (1 − (1+r)^−n); знаменатель считаем через expm1/log1p — при малой ставке иначе теряется точность
  const factor = -Math.expm1(-months * Math.log1p(r));
  const payment = Math.round((principalMinor * r) / factor);
  if (!Number.isSafeInteger(payment) || payment <= 0) return null;

  // График по месяцам: проценты месяца округляются, платёж один и тот же, последний — остаток долга плюс его проценты
  let balance = principalMinor;
  let interest = 0;
  let last = payment;
  for (let k = 1; k <= months; k++) {
    const part = Math.round(balance * r);
    interest += part;
    if (k === months) {
      last = balance + part;
      balance = 0;
    } else {
      balance = balance + part - payment;
      if (balance <= 0) {
        // платёж округлился так, что долг закрылся раньше срока: считаем остаток нулевым (возможно только при ничтожной ставке)
        last = payment;
        balance = 0;
        break;
      }
    }
  }
  if (!Number.isSafeInteger(interest) || interest < 0 || interest > INTEREST_MINOR_MAX) return null;
  const total = principalMinor + interest;
  if (!Number.isSafeInteger(total)) return null;
  return { paymentMinor: payment, lastPaymentMinor: last > 0 ? last : payment, interestMinor: interest, totalMinor: total };
}

/** Проценты за срок для формы: 0 или меньше означает «процентов нет» (null), а не «ноль процентов». null — посчитать нельзя. */
export function interestFor(principalMinor: Minor, rateBp: number, months: number): Minor | null {
  const plan = annuityPlan(principalMinor, rateBp, months);
  return plan !== null && plan.interestMinor > 0 ? plan.interestMinor : null;
}

/** Проценты долга числом: нет процентов — 0. */
export const interestOf = (debt: Pick<Debt, 'interestMinor'> | { interestMinor?: Minor | null }): Minor => debt.interestMinor ?? 0;

/**
 * Сколько платить в месяц по договору: «сумма долга + проценты» поровну на срок, с округлением вверх. null — срока нет или
 * числа не годятся. Это подсказка для «Платить частями»; настоящий остаток всё равно считается по платежам.
 */
export function suggestedMonthlyMinor(totalMinor: Minor, termMonths: number | null): Minor | null {
  if (termMonths === null || !Number.isSafeInteger(termMonths) || termMonths < TERM_MONTHS_MIN) return null;
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) return null;
  return Math.floor((totalMinor - 1) / termMonths) + 1;
}

const RATE_RE = /^(\d{1,4})(?:[.,](\d{0,2}))?$/;

/**
 * '24' → 2400, '24,5' → 2450, '24.55' → 2455. Пробелы по краям не мешают; больше двух знаков после запятой, минус, буквы — null
 * (как с суммами: двусмысленную запись не угадываем). Границы (от 0,01 % до 1000 %) проверяет вызывающий код через rateError.
 */
export function parseRateBp(text: string): number | null {
  const m = RATE_RE.exec(text.trim().replace(/\s+/g, ''));
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(frac);
}

/** 2400 → '24', 2450 → '24,5', 2455 → '24,55'. Для поля ввода и подписей. */
export function formatRateBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole},${frac}`;
}

/** Сообщение, если ставка не годится (пусто — годится). */
export function rateError(bp: number | null): string | null {
  if (bp === null) return 'Ставка — число, например 24 или 18,5';
  if (bp < RATE_BP_MIN) return 'Ставка должна быть больше нуля';
  if (bp > RATE_BP_MAX) return 'Ставка не больше 1000 % годовых';
  return null;
}

/** Срок целым числом месяцев: '12' → 12; пусто, дробь, минус, буквы — null. */
export function parseTermMonths(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
}

/** Сообщение, если срок не годится (пусто — годится). */
export function termError(months: number | null): string | null {
  if (months === null) return 'Срок — целое число месяцев, например 12';
  if (months < TERM_MONTHS_MIN) return 'Срок должен быть не меньше месяца';
  if (months > TERM_MONTHS_MAX) return `Срок не больше ${TERM_MONTHS_MAX} месяцев`;
  return null;
}
