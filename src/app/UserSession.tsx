import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import type { AuthUser } from '@/auth/config';
import { ensureSeeded, StoreProvider, type Store } from '@/db';
import { RateServiceProvider } from '@/rates/hooks';
import { META_INITIAL_PULL, type SyncEngine } from '@/sync/engine';
import { SyncProvider, useSyncStatus } from '@/sync/syncContext';
import { BootScreen } from './BootScreen';
import { useAppEnv } from './env';
import { FirstLoadScreen } from './FirstLoadScreen';
import { StoreErrorScreen } from './StoreErrorScreen';

type Phase =
  | { kind: 'opening' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ready'; store: Store; engine: SyncEngine | null; initialPullDone: boolean };

/** Освободить ресурсы сеанса. Чуть позже, чем размонтирование: сначала React сам остановит SyncProvider. */
function release(engine: SyncEngine | null, store: Store | null): void {
  setTimeout(() => {
    try {
      engine?.dispose();
    } catch (e) {
      console.error('Не удалось остановить синхронизацию:', e);
    }
    try {
      store?.close();
    } catch (e) {
      console.error('Не удалось закрыть хранилище:', e);
    }
  }, 0);
}

/** Просьба движка «обнови сессию»: true — получилось, цикл можно повторить. */
async function refreshAuth(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.refreshSession();
    return !error && !!data.session;
  } catch {
    return false;
  }
}

export interface UserSessionProps {
  user: AuthUser;
  children?: ReactNode;
}

/**
 * Что открыть и когда. Для вошедшего пользователя (или локального):
 *  1) открыть ЕГО локальную базу;
 *  2) локальный режим — сразу затравка, и приложение готово;
 *  3) облако — создать движок синхронизации; пока не прошла ПЕРВАЯ загрузка с сервера, вместо приложения
 *     показывается экран «Первая загрузка данных…» (затравку делает сам движок после неё);
 *  4) закрыть базу и остановить движок при выходе или смене пользователя.
 * Компонент перемонтируется при смене id пользователя (key), поэтому данные разных людей не смешиваются.
 */
export function UserSession({ user, children }: UserSessionProps) {
  const { client, deps } = useAppEnv();
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Что уже открыто в этом запуске. free() освобождает ровно один раз всё, что успели открыть.
    const res: { store: Store | null; engine: SyncEngine | null } = { store: null, engine: null };
    const free = () => {
      const { store, engine } = res;
      res.store = null;
      res.engine = null;
      release(engine, store);
    };
    setPhase({ kind: 'opening' });

    void (async () => {
      try {
        const opened = await deps.openStore(user.id);
        res.store = opened;
        if (cancelled) return free();
        if (!client) {
          await ensureSeeded(opened);
          if (cancelled) return free();
          setPhase({ kind: 'ready', store: opened, engine: null, initialPullDone: true });
          return;
        }
        const engine = deps.createEngine({
          store: opened,
          transport: deps.createTransport(client),
          afterFirstPull: async () => {
            await ensureSeeded(opened);
          },
          onAuthError: () => refreshAuth(client),
        });
        res.engine = engine;
        const done = (await opened.sync.getMeta(META_INITIAL_PULL)) === true;
        if (cancelled) return free();
        setPhase({ kind: 'ready', store: opened, engine, initialPullDone: done });
      } catch (error) {
        console.error('Не удалось открыть данные:', error);
        free();
        if (!cancelled) setPhase({ kind: 'error', error });
      }
    })();

    return () => {
      cancelled = true;
      free();
    };
  }, [user.id, client, deps, attempt]);

  if (phase.kind === 'opening') return <BootScreen />;
  if (phase.kind === 'error') {
    return (
      <StoreErrorScreen
        error={phase.error}
        onRetry={() => setAttempt((n) => n + 1)}
        onSignOut={client ? () => void auth.signOut() : undefined}
      />
    );
  }
  return (
    <StoreProvider store={phase.store}>
      <SyncProvider engine={phase.engine}>
        <ReadyGate store={phase.store} cloud={phase.engine !== null} initialPullDone={phase.initialPullDone}>
          {children}
        </ReadyGate>
      </SyncProvider>
    </StoreProvider>
  );
}

/** Пропускает приложение дальше только после первой загрузки данных (в локальном режиме — сразу). */
function ReadyGate({
  store,
  cloud,
  initialPullDone,
  children,
}: {
  store: Store;
  cloud: boolean;
  initialPullDone: boolean;
  children?: ReactNode;
}) {
  const { client, deps } = useAppEnv();
  const status = useSyncStatus();
  const [done, setDone] = useState(initialPullDone || !cloud);

  // Каждое изменение статуса движка — повод заглянуть, не отметил ли он первую загрузку выполненной.
  useEffect(() => {
    if (done) return undefined;
    let alive = true;
    store.sync
      .getMeta(META_INITIAL_PULL)
      .then((v) => {
        if (alive && v === true) setDone(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [store, done, status]);

  const rates = useMemo(() => deps.createRates(client), [deps, client]);

  if (!done) return <FirstLoadScreen />;
  return <RateServiceProvider service={rates}>{children}</RateServiceProvider>;
}
