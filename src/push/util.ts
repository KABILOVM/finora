/** Мелкие помощники модуля напоминаний: таймауты, сеть, часовой пояс. Без обращений к серверу. */
import { DEFAULT_REMINDER_SETTINGS } from './contract';

export class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/** Ждёт p не дольше ms. По таймауту бросает TimeoutError (сам запрос при этом не отменяется — ответ просто игнорируется). */
export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** false — браузер точно знает, что сети нет. Это подсказка: true не гарантирует доступ к серверу. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const TZ_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,3}$/;

/** Подходит ли строка как IANA-имя часового пояса для колонки timezone (1–64 символа, браузер её знает). */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length < 1 || tz.length > 64 || !TZ_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Часовой пояс устройства ('Asia/Dushanbe'). Не получилось определить или имя странное — пояс по умолчанию из договора. */
export function deviceTimezone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimezone(tz)) return tz;
  } catch {
    /* нет Intl — запасной вариант ниже */
  }
  return DEFAULT_REMINDER_SETTINGS.timezone;
}

/** Имя общей блокировки между вкладками и между сторожем (PushKeeper) и кнопками раздела: подписку меняет кто-то один. */
export const PUSH_LOCK_NAME = 'finora-push-subscription';

/** Выполняет fn под общей блокировкой (если браузер умеет Web Locks, иначе просто выполняет). Ждёт своей очереди. */
export function withPushLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManager }).locks;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(PUSH_LOCK_NAME, fn) as Promise<T>;
}
