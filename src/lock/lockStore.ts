/**
 * Настройка «замка» приложения. Хранится ЛОКАЛЬНО на этом устройстве, отдельно для каждого пользователя
 * (localStorage, ключ с id пользователя). В облако не уходит и в резервную копию не попадает: это свойство устройства.
 *
 * Правило безопасной стороны: запись, которую не удалось разобрать, — это НЕ «замок выключен». Раз ключ в хранилище есть, замок
 * когда-то включали; поэтому состояние 'broken' держит экран закрытым и предлагает только «выйти и войти заново».
 * «Выключен» — только когда записи нет совсем (или хранилище недоступно: тогда не знаем ничего ни мы, ни приложение).
 */
import { fromBase64Url } from './bytes';

export const LOCK_KEY_PREFIX = 'finora:appLock:';

/** Через сколько секунд скрытия закрывать: 0 — сразу, 60 — через минуту, 300 — через 5 минут. */
export type GraceSeconds = 0 | 60 | 300;
export const GRACE_OPTIONS: readonly GraceSeconds[] = [0, 60, 300];
export const DEFAULT_GRACE: GraceSeconds = 60;

export interface LockSetting {
  /** Идентификатор ключа Face ID / отпечатка (base64url). Это не секрет, но и не для чужих глаз: в журнал не пишем. */
  credentialId: string;
  enabledAt: string;
  graceSeconds: GraceSeconds;
}

export type LockState = { kind: 'off' } | { kind: 'on'; setting: LockSetting } | { kind: 'broken' };

export const lockKey = (userId: string): string => `${LOCK_KEY_PREFIX}${userId}`;

export function isGraceSeconds(v: unknown): v is GraceSeconds {
  return v === 0 || v === 60 || v === 300;
}

/** Разбор сохранённой строки. null — записи нет. Всё непонятное — 'broken', а не 'off'. */
export function parseLock(raw: string | null): LockState {
  if (raw === null) return { kind: 'off' };
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { kind: 'broken' };
    const o = v as Record<string, unknown>;
    if (typeof o.credentialId !== 'string' || fromBase64Url(o.credentialId) === null) return { kind: 'broken' };
    return {
      kind: 'on',
      setting: {
        credentialId: o.credentialId,
        enabledAt: typeof o.enabledAt === 'string' ? o.enabledAt : '',
        // непонятное время закрытия — самое строгое («сразу»), а не самое мягкое
        graceSeconds: isGraceSeconds(o.graceSeconds) ? o.graceSeconds : 0,
      },
    };
  } catch {
    return { kind: 'broken' };
  }
}

/** Сырая строка записи; null — нет записи или хранилище недоступно. */
export function readLockRaw(userId: string): string | null {
  try {
    return localStorage.getItem(lockKey(userId));
  } catch {
    return null;
  }
}

export function readLock(userId: string): LockState {
  return parseLock(readLockRaw(userId));
}

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // один сломанный слушатель не должен мешать остальным
    }
  }
};

/** Подписка на изменения записи: в этой вкладке и в других (событие storage). */
export function subscribeLock(userId: string, listener: () => void): () => void {
  const key = lockKey(userId);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === key) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Записать настройку. true — запись на месте и читается обратно такой же (иначе замок «включили», а он не сохранился). */
export function writeLock(userId: string, setting: LockSetting): boolean {
  const text = JSON.stringify({ credentialId: setting.credentialId, enabledAt: setting.enabledAt, graceSeconds: setting.graceSeconds });
  try {
    localStorage.setItem(lockKey(userId), text);
    if (localStorage.getItem(lockKey(userId)) !== text) return false;
  } catch {
    return false;
  }
  notify();
  return true;
}

/** Сменить время закрытия у включённого замка. false — замка нет или не удалось сохранить. */
export function updateGrace(userId: string, graceSeconds: GraceSeconds): boolean {
  const cur = readLock(userId);
  if (cur.kind !== 'on') return false;
  return writeLock(userId, { ...cur.setting, graceSeconds });
}

/**
 * Убрать настройку. true — записи больше нет. quiet: не будить слушателей этой вкладки (выход из аккаунта: экран и так
 * сменится, а лишняя перерисовка заслонки не должна на кадр открыть содержимое).
 */
export function clearLock(userId: string, quiet = false): boolean {
  let gone = false;
  try {
    localStorage.removeItem(lockKey(userId));
    gone = localStorage.getItem(lockKey(userId)) === null;
  } catch {
    gone = false;
  }
  if (!quiet) notify();
  return gone;
}
