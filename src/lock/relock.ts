import type { GraceSeconds } from './lockStore';

/**
 * Закрывать ли замок при возвращении в приложение. hiddenAt — когда страницу скрыли (Date.now()), null — не знаем.
 * Правило: при малейшем сомнении закрываем. Сомнение — не знаем, когда скрыли; время не число; часы ушли назад.
 * Ровно grace секунд тоже закрываем. grace = 0 («сразу»): закрываем всегда.
 */
export function shouldLockOnReturn(hiddenAt: number | null, now: number, graceSeconds: GraceSeconds): boolean {
  if (graceSeconds === 0) return true;
  if (hiddenAt === null || !Number.isFinite(hiddenAt) || !Number.isFinite(now)) return true;
  const elapsed = now - hiddenAt;
  if (elapsed < 0) return true;
  return elapsed >= graceSeconds * 1000;
}
