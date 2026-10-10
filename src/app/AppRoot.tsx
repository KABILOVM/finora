import type { SupabaseClient } from '@supabase/supabase-js';
import { useMemo, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginPage from '@/features/auth/LoginPage';
import { BootScreen } from './BootScreen';
import { defaultDeps, type SessionDeps } from './deps';
import { AppEnvProvider } from './env';
import { UserSession } from './UserSession';

/** Решает, что показать: заставку, вход или данные пользователя. */
function SessionGate({ children }: { children?: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'booting') return <BootScreen />;
  if (state.status === 'signed-out') return <LoginPage />;
  // key: другой человек — другая сессия «с нуля», данные не смешиваются. offline-known → signed-in не перезапускает сеанс.
  return (
    <UserSession key={state.user.id} user={state.user}>
      {children}
    </UserSession>
  );
}

export interface AppRootProps {
  /** Клиент облака; null — локальный режим (облако не настроено). */
  client: SupabaseClient | null;
  deps?: SessionDeps;
  /** Сколько ждать сохранённую сессию при старте, мс. */
  bootTimeoutMs?: number;
  /** Приложение (маршруты). Показывается только когда вход выполнен и данные готовы. */
  children?: ReactNode;
}

/** Корень сборки: вход → локальная база → синхронизация → курсы → приложение. */
export function AppRoot({ client, deps = defaultDeps, bootTimeoutMs, children }: AppRootProps) {
  const env = useMemo(() => ({ client, deps }), [client, deps]);
  return (
    <AppEnvProvider value={env}>
      <AuthProvider client={client} bootTimeoutMs={bootTimeoutMs}>
        <SessionGate>{children}</SessionGate>
      </AuthProvider>
    </AppEnvProvider>
  );
}
