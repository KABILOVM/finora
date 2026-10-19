import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { coverFocusables, installCoverGuards } from './coverGuards';
import { inertOutside } from './inertOutside';
import type { LockState } from './lockStore';
import { LOCK_FAILURE_TEXT, verifyLock } from './webauthn';

export interface LockCoverProps {
  /** Состояние закрытого замка: 'on' (есть ключ) или 'broken' (запись повреждена — открыть по ключу нельзя). */
  state: Exclude<LockState, { kind: 'off' }>;
  /** Есть вход в облако: «выйти и войти заново» доступно. Нет — запасной выход «снять замок» (проверить личность нечем). */
  cloud: boolean;
  /** Вызывается ТОЛЬКО после успешного подтверждения у системы. */
  onUnlock(): void;
  /**
   * Запасной выход: выйти из аккаунта (облако) или снять замок (локальный режим). Сам убирает заслонку, когда всё сделано.
   * false — не получилось (например, не удалось записать настройку): заслонка остаётся, человеку говорим об этом.
   */
  onLeave(): Promise<boolean>;
}

type View = 'main' | 'leave';

/**
 * Заслонка закрытого замка: непрозрачный экран поверх всего приложения (рисуется в <body>, выше шитов и уведомлений).
 * Всё остальное на странице получает inert и aria-hidden, пока заслонка есть; приложение под ней продолжает работать.
 * Откроет её только успешный verifyLock. Esc и «назад» её не снимают и не доходят до окон под ней (см. coverGuards).
 */
export function LockCover({ state, cloud, onUnlock, onLeave }: LockCoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const leaveOpenRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const titleId = useId();
  const descId = useId();
  const [view, setView] = useState<View>('main');
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const credentialId = state.kind === 'on' ? state.setting.credentialId : null;

  // Что сейчас показано и идёт ли выход — для обработчиков, которые ставятся один раз (они не должны пересоздаваться на каждый показ).
  const viewRef = useRef<View>('main');
  const leavingRef = useRef(false);
  viewRef.current = view;
  leavingRef.current = leaving;

  // До первой отрисовки: всё остальное в <body> недоступно (в том числе окна, появившиеся позже), а клавиатура, фокус и «назад»
  // не доходят до окон под заслонкой.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const releaseInert = inertOutside(root);
    const releaseGuards = installCoverGuards(root, {
      onEscape: () => {
        // Esc закрывает только вопрос «Выйти?»; саму заслонку не снимает никогда.
        if (viewRef.current === 'leave' && !leavingRef.current) setView('main');
      },
      // Фокус вернуть: «Отмена» в вопросе, иначе первая доступная кнопка (открыть, а пока она занята — «Не получается?»).
      focusPrimary: () => {
        const target = viewRef.current === 'leave' ? cancelRef.current : (coverFocusables(root)[0] ?? null);
        (target ?? root).focus({ preventScroll: true });
      },
    });
    return () => {
      releaseGuards();
      releaseInert();
    };
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** source 'auto' — попытка без нажатия: неудача молчит (на iPhone запрос без нажатия может не показаться вовсе). */
  const attempt = async (source: 'button' | 'auto') => {
    if (credentialId === null) return;
    if (source === 'button') setMessage(null);
    // Автозапрос при показе кнопку не блокирует: заблокированная кнопка теряет фокус, и он потом оставался на «Не получается?».
    if (source === 'button') setChecking(true);
    const result = await verifyLock(credentialId);
    if (!alive.current) return;
    if (source === 'button') setChecking(false);
    if (result.ok) {
      onUnlock();
    } else if (source === 'button') {
      setMessage(LOCK_FAILURE_TEXT[result.reason]);
    } else if (result.reason === 'blocked' || result.reason === 'unsupported') {
      setMessage(LOCK_FAILURE_TEXT[result.reason]);
    }
  };

  // Автозапрос при показе — дополнение к кнопке, не замена: кнопка всегда на месте.
  useEffect(() => {
    if (credentialId !== null && typeof document !== 'undefined' && document.visibilityState !== 'hidden') void attempt('auto');
    // один раз при появлении заслонки
  }, []);

  // Фокус забирает заслонка.
  useEffect(() => {
    if (view === 'leave') cancelRef.current?.focus();
    else (openRef.current ?? leaveOpenRef.current ?? rootRef.current)?.focus();
  }, [view]);

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    setMessage(null);
    try {
      const done = await onLeave();
      if (!done && alive.current) setMessage(LOCK_FAILURE_TEXT.failed);
    } catch {
      if (alive.current) setMessage(LOCK_FAILURE_TEXT.failed);
    } finally {
      if (alive.current) setLeaving(false);
    }
  };

  const leaveLabel = cloud ? 'Не получается? Выйти и войти заново' : 'Не получается? Снять замок';

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
      data-lock-cover=""
      // Коснуться экрана в любом месте — то же, что нажать «Открыть»: одно касание вместо прицеливания в кнопку (и жест, без которого
      // iPhone не покажет запрос Face ID). Кнопки и ссылки работают сами по себе.
      onClick={(e) => {
        if (view !== 'main' || state.kind !== 'on' || checking || leaving) return;
        if ((e.target as HTMLElement).closest('button, a')) return;
        void attempt('button');
      }}
      className="fixed inset-0 z-[1000] flex flex-col items-center overflow-y-auto overscroll-contain bg-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-text outline-none"
    >
      <div className="my-auto flex w-full max-w-sm flex-col items-center gap-4 py-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-brand" aria-hidden="true">
          <Icon name="lock" size={32} />
        </span>

        {view === 'main' ? (
          <>
            <h2 id={titleId} className="text-2xl font-bold tracking-tight">
              Sumoima закрыта
            </h2>
            <p id={descId} className="text-muted">
              {state.kind === 'on'
                ? 'Коснитесь экрана и подтвердите, что это вы: Face ID, отпечаток или код экрана.'
                : 'Запись о замке на этом устройстве повреждена, поэтому открыть его по Face ID не получится.'}
            </p>

            {state.kind === 'on' && (
              <Button ref={openRef} size="lg" fullWidth loading={checking} onClick={() => void attempt('button')}>
                Открыть по Face ID / отпечатку
              </Button>
            )}
            {message && (
              <Notice tone="danger" className="w-full">
                {message}
              </Notice>
            )}

            <Button
              ref={leaveOpenRef}
              variant={state.kind === 'broken' ? 'primary' : 'ghost'}
              size={state.kind === 'broken' ? 'lg' : 'md'}
              fullWidth={state.kind === 'broken'}
              onClick={() => setView('leave')}
              disabled={leaving}
            >
              {leaveLabel}
            </Button>
          </>
        ) : (
          <>
            <h2 id={titleId} className="text-2xl font-bold tracking-tight">
              {cloud ? 'Выйти из аккаунта?' : 'Снять замок?'}
            </h2>
            <div id={descId} className="flex flex-col gap-2 text-muted">
              {cloud ? (
                <>
                  <p>Вы выйдете на этом устройстве, и замок снимется. Записи на устройстве сохранятся.</p>
                  <p>Чтобы войти снова, понадобится почта: пароль или код из письма. Всё, что ещё не отправилось в облако, останется здесь и отправится после входа под этой же почтой.</p>
                </>
              ) : (
                <>
                  <p>Замок выключится, и приложение откроется без проверки. Записи не удалятся.</p>
                  <p>Без входа в облако проверить, что это вы, нечем. Снимайте замок, только если это ваш телефон.</p>
                </>
              )}
            </div>
            {message && (
              <Notice tone="danger" className="w-full">
                {message}
              </Notice>
            )}
            <div className="flex w-full flex-col gap-2">
              <Button variant="danger" fullWidth loading={leaving} onClick={() => void leave()}>
                {cloud ? 'Выйти' : 'Снять замок'}
              </Button>
              <Button ref={cancelRef} variant="secondary" fullWidth disabled={leaving} onClick={() => setView('main')}>
                Отмена
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
