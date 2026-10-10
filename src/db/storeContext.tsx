import { createContext, useContext, type ReactNode } from 'react';
import type { Store } from './store';

const StoreContext = createContext<Store | null>(null);

/** Даёт хукам доступ к локальной базе текущего пользователя. Хранилище открывает приложение (openStore). */
export function StoreProvider({ store, children }: { store: Store; children?: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore: оберните приложение в <StoreProvider store={...}>');
  return store;
}
