import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, type ReactNode } from 'react';
import { defaultDeps, type SessionDeps } from './deps';

export interface AppEnv {
  /** null — локальный режим. */
  client: SupabaseClient | null;
  deps: SessionDeps;
}

const AppEnvContext = createContext<AppEnv | null>(null);

export function AppEnvProvider({ value, children }: { value: AppEnv; children?: ReactNode }) {
  return <AppEnvContext.Provider value={value}>{children}</AppEnvContext.Provider>;
}

/** Облачный клиент и зависимости сеанса. Вне AppRoot (например, в простых тестах экрана) — локальный режим. */
export function useAppEnv(): AppEnv {
  return useContext(AppEnvContext) ?? { client: null, deps: defaultDeps };
}
