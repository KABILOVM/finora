import { Outlet, useLocation } from 'react-router-dom';
import { useSyncEnabled } from '@/sync/syncContext';
import { LocalDataNotice } from './LocalDataNotice';

/** Где показывать плашку переноса записей: только на «Главной». */
function showsBanner(pathname: string): boolean {
  return pathname === '/';
}

/** Обёртка над страницами внутри каркаса: плашки-напоминания + сама страница. */
export function PageNotices() {
  const { pathname } = useLocation();
  const syncEnabled = useSyncEnabled();
  return (
    <>
      {syncEnabled && showsBanner(pathname) && <LocalDataNotice />}
      <Outlet />
    </>
  );
}
