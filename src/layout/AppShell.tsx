import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { InstallHint } from '@/components/InstallHint';
import { Logo } from '@/components/Logo';
import { Spinner } from '@/components/Button';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';

/** Крутилка, пока подгружается код страницы (навигация при этом остаётся на месте). */
export function PageFallback() {
  return (
    <div className="flex justify-center py-16 text-muted" role="status" aria-label="Загрузка">
      <Spinner size={28} />
    </div>
  );
}

export interface AppShellProps {
  /** Индикаторы состояния (синхронизация, сеть): в шапке телефона и внизу боковой панели ПК. */
  status?: ReactNode;
}

/**
 * Каркас экрана. Телефон: шапка сверху + контент + нижняя панель.
 * ПК (≥ 1024px): боковая панель слева, контент по центру шириной до 48rem (не растягивается на весь экран).
 */
export function AppShell({ status }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <SideNav status={status} />
      <div className="lg:pl-64">
        <div className="sticky top-0 z-20 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <div className="flex min-h-[52px] items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-2">
              <Logo size={28} />
              <span className="text-lg font-bold tracking-tight">Finora</span>
            </div>
            {status && <div className="flex flex-wrap justify-end gap-2">{status}</div>}
          </div>
        </div>
        <main
          id="main"
          className="mx-auto w-full max-w-3xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-2 lg:px-8 lg:pb-12 lg:pt-8"
        >
          <InstallHint className="mb-4" />
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
