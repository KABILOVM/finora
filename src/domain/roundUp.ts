import { isAdjustment } from './adjustment';
import { factorOf } from './currency';
import { addMinor, isMinor } from './money';
import type { CurrencyCode, IsoDate, Minor, Transaction, UUID } from './types';
import { addDays, isValidIsoDate } from '@/lib/dates';

/**
 * «Копилка из мелочи» — ЧИСТЫЕ функции (без базы, React и часов). Мелочь — разница между суммой расхода и ближайшей круглой суммой
 * вверх с шагом 1, 5 или 10 единиц основной валюты (расход 47 при шаге 5 даёт 3). Приложение само ничего не переводит: оно считает,
 * сколько мелочи накопилось с прошлого «сбора», и предлагает отложить её одним переводом на кошелёк цели.
 *
 * «Сбор» — обычный перевод на кошелёк цели с заметкой «Копилка из мелочи · до ГГГГ-ММ-ДД» (дата — последний день, включённый в
 * сбор). Дата последнего сбора читается из этих переводов, а не хранится отдельно: так она едет между устройствами вместе с данными
 * и два телефона не соберут одну и ту же мелочь дважды. Расходы, внесённые в день сбора уже после него, в следующий сбор не попадут.
 */

export const ROUND_UP_STEPS = [1, 5, 10] as const;
export type RoundUpStep = (typeof ROUND_UP_STEPS)[number];
export const DEFAULT_ROUND_UP_STEP: RoundUpStep = 5;

/** Сколько дней смотрим назад, если сборов ещё не было. */
export const ROUND_UP_FIRST_DAYS = 30;

export const ROUND_UP_NOTE_PREFIX = 'Копилка из мелочи';

export const isRoundUpStep = (v: unknown): v is RoundUpStep => ROUND_UP_STEPS.some((s) => s === v);

/** Шаг в минимальных единицах валюты: 5 при двух знаках после запятой — 500. */
export function roundUpStepMinor(step: RoundUpStep, currency: CurrencyCode): Minor {
  return step * factorOf(currency);
}

/**
 * Мелочь с одного расхода: сколько не хватает до ближайшей круглой суммы вверх. Сумма уже круглая — 0. Некорректная сумма или шаг — 0.
 * 0 ≤ результат < stepMinor, а сумма вместе с мелочью кратна шагу.
 */
export function roundUpDiffMinor(amountMinor: Minor, stepMinor: Minor): Minor {
  if (!isMinor(amountMinor) || amountMinor <= 0 || !isMinor(stepMinor) || stepMinor <= 0) return 0;
  const rest = amountMinor % stepMinor;
  return rest === 0 ? 0 : stepMinor - rest;
}

/** Заметка сбора: «Копилка из мелочи · до 2026-10-31». */
export const roundUpNote = (throughDate: IsoDate): string => `${ROUND_UP_NOTE_PREFIX} · до ${throughDate}`;

const NOTE_RE = new RegExp(`^${ROUND_UP_NOTE_PREFIX} · до (\\d{4}-\\d{2}-\\d{2})$`);

/** Дата из заметки сбора; не заметка сбора или дата ненастоящая — null. Пробелы по краям не мешают. */
export function parseRoundUpNote(note: string): IsoDate | null {
  const m = NOTE_RE.exec(note.trim());
  const date = m?.[1];
  return date !== undefined && isValidIsoDate(date) ? date : null;
}

type TransferLike = Pick<Transaction, 'kind' | 'toWalletId' | 'note' | 'deletedAt'>;

/** Последний день, включённый в сбор: наибольшая дата среди живых переводов на кошелёк цели с заметкой сбора. Сборов не было — null. */
export function sweptThrough(transfers: readonly TransferLike[], goalWalletId: UUID): IsoDate | null {
  let last: IsoDate | null = null;
  for (const t of transfers) {
    if (t.kind !== 'transfer' || t.deletedAt !== null || t.toWalletId !== goalWalletId) continue;
    const date = parseRoundUpNote(t.note);
    if (date !== null && (last === null || date > last)) last = date;
  }
  return last;
}

export interface RoundUpWindow {
  /** Первый день, который ещё не собран. */
  from: IsoDate;
  /** Последний день — сегодня. */
  to: IsoDate;
}

/**
 * За какие дни копится мелочь: со следующего дня после последнего сбора, а если сборов не было — за последние ROUND_UP_FIRST_DAYS дней.
 * null — собирать нечего: последний сбор сегодня или даже позже (дата в будущем из чужих часов).
 */
export function roundUpWindow(swept: IsoDate | null, today: IsoDate): RoundUpWindow | null {
  const from = swept === null ? addDays(today, -(ROUND_UP_FIRST_DAYS - 1)) : addDays(swept, 1);
  return from > today ? null : { from, to: today };
}

type ExpenseLike = Pick<Transaction, 'kind' | 'walletId' | 'occurredOn' | 'deletedAt' | 'baseCurrency' | 'baseAmountMinor'> & {
  debtId?: Transaction['debtId'] | undefined;
  fxSource?: Transaction['fxSource'] | undefined;
};

export interface RoundUpArgs {
  from: IsoDate;
  to: IsoDate;
  stepMinor: Minor;
  /** Основная валюта: считаются только расходы, внесённые в ней (сумма — baseAmountMinor). */
  base: CurrencyCode;
  /** Кошелёк цели: траты с него в мелочь не идут (иначе копилка копила бы сама на себя). */
  excludeWalletId?: UUID | null;
}

/**
 * Мелочь за период [from, to] (обе даты включительно). Берутся только настоящие расходы: не удалённые, не по долгам, не «Корректировка
 * остатка», внесённые в основной валюте, не с кошелька цели. Бросает RangeError, если сумма не помещается в безопасное целое.
 */
export function roundUpTotal(txs: readonly ExpenseLike[], { from, to, stepMinor, base, excludeWalletId = null }: RoundUpArgs): Minor {
  let total: Minor = 0;
  for (const t of txs) {
    if (t.kind !== 'expense' || t.deletedAt !== null || t.occurredOn < from || t.occurredOn > to) continue;
    if ((t.debtId ?? null) !== null || isAdjustment(t) || t.baseCurrency !== base) continue;
    if (excludeWalletId !== null && t.walletId === excludeWalletId) continue;
    total = addMinor(total, roundUpDiffMinor(t.baseAmountMinor, stepMinor));
  }
  return total;
}
