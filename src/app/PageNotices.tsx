import { Outlet, useLocation } from 'react-router-dom';
import { useSyncEnabled } from '@/sync/syncContext';
import { LocalModeBanner } from './LocalOnly';

/** Где показывать плашку локального режима: на «Главной» и в «Настройках». */
function showsBanner(pathname: string): boolean {
  return pathname === '/' || pathname === '/settings' || pathname === '/settings/';
}

/** Обёртка над страницами внутри каркаса: плашки-напоминания + сама страница. */
export function PageNotices() {
  const { pathname } = useLocation();
  const syncEnabled = useSyncEnabled();
  return (
    <>
      {!syncEnabled && showsBanner(pathname) && <LocalModeBanner />}
      <Outlet />
    </>
  );
}
