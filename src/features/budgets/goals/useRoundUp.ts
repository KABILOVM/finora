import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import { roundUpNote, roundUpStepMinor, roundUpTotal, roundUpWindow, sweptThrough, type RoundUpStep, type RoundUpWindow } from '@/domain/roundUp';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { useToday } from '@/recurring/useToday';

export interface RoundUpState {
  /** Последний день, включённый в прошлый сбор; null — сборов ещё не было. */
  swept: IsoDate | null;
  /** За какие дни копится мелочь; null — собирать нечего (сбор был сегодня). */
  window: RoundUpWindow | null;
  /** Накопившаяся мелочь; null — суммы слишком большие, не посчитали. */
  totalMinor: Minor | null;
  /** Заметка для перевода-сбора по сегодняшний день; null, когда собирать нечего. */
  note: string | null;
}

/**
 * «Копилка из мелочи» для цели с кошельком `goalWalletId`: когда был последний сбор (читается из переводов на этот кошелёк),
 * за какие дни копится мелочь и сколько её набежало при шаге `step`. Пересчитывается сама после любой записи в базу.
 * undefined — читается.
 */
export function useRoundUp(base: CurrencyCode, goalWalletId: UUID | null, step: RoundUpStep): RoundUpState | undefined {
  const store = useStore();
  const today = useToday();
  const loaded = useLiveQuery(async () => {
    if (goalWalletId === null) return null;
    const toGoal = await store.db.transactions.where('toWalletId').equals(goalWalletId).toArray();
    const swept = sweptThrough(toGoal, goalWalletId);
    const window = roundUpWindow(swept, today);
    const rows = window ? await store.db.transactions.where('occurredOn').between(window.from, window.to, true, true).toArray() : [];
    return { swept, window, rows };
  }, [store, goalWalletId, today]);

  return useMemo((): RoundUpState | undefined => {
    if (loaded === undefined) return undefined;
    if (loaded === null) return { swept: null, window: null, totalMinor: 0, note: null };
    const { swept, window, rows } = loaded;
    if (window === null) return { swept, window, totalMinor: 0, note: null };
    let totalMinor: Minor | null = null;
    try {
      totalMinor = roundUpTotal(rows, { from: window.from, to: window.to, stepMinor: roundUpStepMinor(step, base), base, excludeWalletId: goalWalletId });
    } catch (e) {
      if (!(e instanceof RangeError)) throw e; // суммы не помещаются в расчёт — мелочь просто не показываем
    }
    return { swept, window, totalMinor, note: roundUpNote(window.to) };
  }, [loaded, step, base, goalWalletId]);
}
