import { useEffect, useState } from 'react';

/** Как часто обновляем «сейчас»: за это время текущий час в прогнозе из памяти успевает смениться. */
export const NOW_TICK_MS = 5 * 60 * 1000;

/** Текущее время, которое само обновляется раз в несколько минут (и сразу, когда человек вернулся на вкладку). */
export function useNow(intervalMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}
