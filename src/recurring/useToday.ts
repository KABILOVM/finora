import { useEffect, useState } from 'react';
import type { IsoDate } from '@/domain/types';
import { todayLocal } from '@/lib/dates';

/** Проверять смену даты не реже, чем раз в столько (мс). */
const CHECK_MS = 30_000;

/**
 * Сегодняшняя дата по местным часам устройства. Меняется сама: за полночь, при возвращении на вкладку и при возврате
 * фокуса — экран, простоявший ночь открытым, не покажет вчерашний день как «Сегодня».
 */
export function useToday(): IsoDate {
  const [today, setToday] = useState<IsoDate>(() => todayLocal());
  useEffect(() => {
    const check = () => setToday((cur) => {
      const now = todayLocal();
      return now === cur ? cur : now;
    });
    check();
    const timer = setInterval(check, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}
