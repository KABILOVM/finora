import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Spinner } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { useOnline } from '@/components/OnlineBadge';
import { cn } from '@/lib/cn';
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
 * Каркас экрана. Телефон (< 768px): шапка сверху + контент + нижняя панель.
 * Планшет и ПК (≥ 768px): боковая панель слева, контент по центру шириной до 48rem (не растягивается на весь экран).
 * Подсказка «как установить» показывается не здесь, а только на «Главной» (см. features/home).
 */
export function AppShell({ status }: AppShellProps) {
  const online = useOnline();
  return (
    <div className="min-h-dvh">
      <SideNav status={status} />
      <div className="md:pl-60">
        <div className="sticky top-0 z-20 bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex min-h-[52px] items-center justify-between gap-2 px-4">
            <div className="flex shrink-0 items-center gap-2">
              <Logo size={28} />
              {/* Без сети на узком экране слово «Finora» уступает место индикаторам: они должны уместиться в одну строку. */}
              <span className={cn('text-lg font-bold tracking-tight', !online && 'max-[419px]:sr-only')}>Finora</span>
            </div>
            {status && <div className="header-status">{status}</div>}
          </div>
        </div>
        <main
          id="main"
          className="mx-auto w-full max-w-3xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-2 md:px-8 md:pb-12 md:pt-8"
        >
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
