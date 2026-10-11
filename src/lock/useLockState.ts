import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { readLockRaw, parseLock, subscribeLock, type LockState } from './lockStore';
import { getLockSupport, type LockSupport } from './webauthn';

/** Настройка замка пользователя; обновляется, когда её меняют в этой или другой вкладке. Читается синхронно — уже при первой отрисовке. */
export function useLockState(userId: string): LockState {
  const subscribe = useCallback((onChange: () => void) => subscribeLock(userId, onChange), [userId]);
  const raw = useSyncExternalStore(
    subscribe,
    () => readLockRaw(userId),
    () => null,
  );
  return useMemo(() => parseLock(raw), [raw]);
}

/** Умеет ли устройство замок. 'checking' — проверка идёт. */
export function useLockSupport(): 'checking' | LockSupport {
  const [support, setSupport] = useState<'checking' | LockSupport>('checking');
  useEffect(() => {
    let alive = true;
    void getLockSupport().then((s) => {
      if (alive) setSupport(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return support;
}
