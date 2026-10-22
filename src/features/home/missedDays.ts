import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore, type Store } from '@/db';
import { isAdjustment } from '@/domain/adjustment';
import type { IsoDate } from '@/domain/types';
import { addDays, isValidIsoDate } from '@/lib/dates';

/**
 * «Пропущенные дни»: на «Главной» плашка «3 дня без записей — всё в порядке?», когда последние дни прошли без единой записи.
 * Нужна против главной причины неточного учёта — забытых трат. Ничего не пишет в данные: ответ «Ничего не тратил(а)» хранится
 * на этом устройстве (как и прочие подсказки интерфейса), поэтому на другом устройстве плашка может появиться ещё раз.
 */

/** Сколько последних дней подряд без записей нужно, чтобы показать плашку. Один день — обычное дело (вносят вечером). */
export const MISSED_MIN_DAYS = 2;
/** С такого числа дней пишем «больше месяца», а не точное число. */
export const MISSED_MANY_DAYS = 30;

/** Сколько суток от a до b (b позже a); по календарю, без часовых поясов. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export interface MissedInput {
  /** Дата самой поздней записи (не позже сегодняшней), которую внёс человек. null — записей нет совсем. */
  lastLoggedOn: IsoDate | null;
  /** «Ничего не тратил(а)» по эту дату включительно. null — не отвечал. */
  quietThrough: IsoDate | null;
  today: IsoDate;
}

export interface Missed {
  /** Сколько последних дней (до вчера включительно) прошло без записей. */
  days: number;
  /** Вчера: сюда предлагаем вносить траты. */
  yesterday: IsoDate;
}

/**
 * Сколько дней подряд до вчера без записей; null — плашка не нужна. Сегодня не считается: день ещё не закончился. Нет ни одной
 * записи — у человека ещё нечего «пропускать» (новому плашка не нужна).
 */
export function missedDays({ lastLoggedOn, quietThrough, today }: MissedInput): Missed | null {
  if (lastLoggedOn === null) return null;
  const accounted = quietThrough !== null && quietThrough > lastLoggedOn ? quietThrough : lastLoggedOn;
  const yesterday = addDays(today, -1);
  const days = daysBetween(accounted, yesterday);
  return days >= MISSED_MIN_DAYS ? { days, yesterday } : null;
}

/** Текст плашки: «2 дня без записей — всё в порядке?». */
export function missedText(days: number): string {
  if (days >= MISSED_MANY_DAYS) return 'Больше месяца без записей — всё в порядке?';
  const last2 = days % 100;
  const last = days % 10;
  const word = last2 >= 11 && last2 <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return `${days} ${word} без записей — всё в порядке?`;
}

// ───────────────────────── отметка «Ничего не тратил(а)» (на этом устройстве) ─────────────────────────

const key = (userId: string): string => `finora:quiet-through:${userId}`;
/** Если localStorage недоступен: помним до перезагрузки страницы. */
const memory = new Map<string, IsoDate | null>();
const listeners = new Set<() => void>();

export function readQuietThrough(userId: string): IsoDate | null {
  try {
    const v = window.localStorage.getItem(key(userId));
    return isValidIsoDate(v) ? v : null;
  } catch {
    return memory.get(userId) ?? null;
  }
}

/** null — снять отметку (для «Отменить»). */
export function writeQuietThrough(userId: string, date: IsoDate | null): void {
  memory.set(userId, date);
  try {
    if (date === null) window.localStorage.removeItem(key(userId));
    else window.localStorage.setItem(key(userId), date);
  } catch {
    // хранилище недоступно (приватный режим, переполнено): действует значение в памяти
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange); // ответили в другой вкладке
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export const useQuietThrough = (userId: string): IsoDate | null => useSyncExternalStore(subscribe, () => readQuietThrough(userId), () => null);

// ───────────────────────── последняя запись ─────────────────────────

/**
 * Дата самой поздней записи не позже `today`, которую внёс человек. Не считаются: удалённые, операции по расписанию (их проводит
 * приложение, а не человек) и корректировки остатка. Читается с конца индекса даты и останавливается на первой подходящей.
 */
export async function lastLoggedOn(store: Store, today: IsoDate): Promise<IsoDate | null> {
  const hit = await store.db.transactions
    .orderBy('occurredOn')
    .reverse()
    .filter((t) => t.deletedAt === null && t.recurringRuleId === null && !isAdjustment(t) && t.occurredOn <= today)
    .first();
  return hit?.occurredOn ?? null;
}

/**
 * Сколько последних дней без записей (null — плашка не нужна, undefined — ещё читается). Живой запрос: внесли операцию —
 * плашка пропадает сразу.
 */
export function useMissedDays(today: IsoDate): Missed | null | undefined {
  const store = useStore();
  const quiet = useQuietThrough(store.userId);
  const last = useLiveQuery(async () => ({ on: await lastLoggedOn(store, today) }), [store, today]);
  if (last === undefined) return undefined;
  return missedDays({ lastLoggedOn: last.on, quietThrough: quiet, today });
}
