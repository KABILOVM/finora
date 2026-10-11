import { Outlet, useLocation } from 'react-router-dom';
import { useSyncEnabled } from '@/sync/syncContext';
import { LocalDataNotice } from './LocalDataNotice';
import { LocalModeBanner } from './LocalOnly';

/** Где показывать плашку локального режима: только на «Главной» (в «Настройках» и так всё видно по значку в шапке). */
function showsBanner(pathname: string): boolean {
  return pathname === '/';
}

/** Обёртка над страницами внутри каркаса: плашки-напоминания + сама страница. */
export function PageNotices() {
  const { pathname } = useLocation();
  const syncEnabled = useSyncEnabled();
  return (
    <>
      {!syncEnabled && showsBanner(pathname) && <LocalModeBanner />}
      {syncEnabled && showsBanner(pathname) && <LocalDataNotice />}
      <Outlet />
    </>
  );
}
