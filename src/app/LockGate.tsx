import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import type { AuthUser } from '@/auth/config';
import { LockCover } from '@/lock/LockCover';
import { clearLock, readLock } from '@/lock/lockStore';
import { shouldLockOnReturn } from '@/lock/relock';
import { useLockState } from '@/lock/useLockState';

/**
 * «Замок» приложения (Face ID / отпечаток). Оборачивает сеанс пользователя и закрывает экран непрозрачной заслонкой, когда замок
 * включён и:
 *  - приложение только что открыли (закрыто С ПЕРВОГО КАДРА: состояние считается синхронно, до первой отрисовки, содержимое не мелькает);
 *  - страница была скрыта дольше, чем выбрано в настройках (visibilitychange, pagehide / pageshow); при сомнении — закрываем.
 * Приложение под заслонкой НЕ размонтируется и продолжает работать (синхронизация не прерывается), но недоступно для фокуса и чтения.
 * Заслонка выше роутера: адрес страницы замок не обходит. Открывает её только успешное подтверждение у системы (verifyLock),
 * запасной выход — «выйти и войти заново» (облако) или «снять замок» (локальный режим).
 */
export function LockGate({ user, children }: { user: AuthUser; children?: ReactNode }) {
  const auth = useAuth();
  const state = useLockState(user.id);
  // Считается один раз, синхронно, при первой отрисовке: запись есть (даже повреждённая) — закрыто.
  const [locked, setLocked] = useState(() => readLock(user.id).kind !== 'off');
  const hidden = useRef<{ at: number } | null>(null);

  // Замок выключили (здесь или в другой вкладке): заслонка не нужна, а флаг сбрасываем, чтобы повторное включение не закрыло экран сразу.
  useEffect(() => {
    if (state.kind === 'off') setLocked(false);
  }, [state.kind]);

  useEffect(() => {
    const lockIfEnabled = () => {
      if (readLock(user.id).kind !== 'off') setLocked(true);
    };
    const onHidden = () => {
      if (hidden.current === null) hidden.current = { at: Date.now() };
      const cur = readLock(user.id);
      // «Сразу» (и повреждённая запись): закрываем уже при скрытии, чтобы снимок в переключателе приложений не показал данные.
      if (cur.kind === 'broken' || (cur.kind === 'on' && cur.setting.graceSeconds === 0)) setLocked(true);
    };
    const onReturn = () => {
      const was = hidden.current;
      if (was === null) return; // возврата без ухода не бывает: это повторное событие того же возвращения
      hidden.current = null;
      const cur = readLock(user.id);
      if (cur.kind === 'off') return;
      const grace = cur.kind === 'on' ? cur.setting.graceSeconds : 0;
      if (shouldLockOnReturn(was.at, Date.now(), grace)) lockIfEnabled();
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? onHidden() : onReturn());
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onReturn();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [user.id]);

  const unlock = useCallback(() => {
    hidden.current = null;
    setLocked(false);
  }, []);

  const leave = useCallback(async (): Promise<boolean> => {
    if (auth.cloud) {
      // signOut сам снимает замок этого пользователя, когда сессия уже снята; экран входа заменит всё это
      await auth.signOut();
      return true;
    }
    // локальный режим: входа нет, личность доказать нечем — снимаем замок (записи не трогаем)
    return clearLock(user.id);
  }, [auth, user.id]);

  return (
    <>
      {children}
      {locked && state.kind !== 'off' && <LockCover state={state} cloud={auth.cloud} onUnlock={unlock} onLeave={leave} />}
    </>
  );
}
