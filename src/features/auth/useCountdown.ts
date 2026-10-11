import { useCallback, useEffect, useState } from 'react';

/** Что сказать скринридеру об ожидании. Меняется всего несколько раз (не каждую секунду), иначе речь «тараторит». */
export function resendAnnouncement(remaining: number): string {
  if (remaining <= 0) return 'Можно отправить код ещё раз.';
  if (remaining > 30) return 'Отправить код ещё раз можно через минуту.';
  if (remaining > 10) return 'Отправить код ещё раз можно через полминуты.';
  return 'Отправить код ещё раз можно через несколько секунд.';
}

/**
 * Обратный отсчёт в секундах. Считает по часам (Date.now), а не по числу тиков: в фоне таймеры замедляются,
 * а после возвращения отсчёт должен показать правильное оставшееся время.
 */
export function useCountdown() {
  const [run, setRun] = useState<{ endAt: number; total: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (run === null) return undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= run.endAt) setRun(null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [run]);

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setRun({ endAt: t + seconds * 1000, total: seconds });
  }, []);

  // min(total): если часы устройства перевели назад, отсчёт не растёт дольше заданного
  const remaining = run === null ? 0 : Math.min(run.total, Math.max(0, Math.ceil((run.endAt - now) / 1000)));
  return { remaining, start };
}
