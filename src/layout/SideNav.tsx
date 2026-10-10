import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';
import { ADD_LABEL, NAV_ITEMS, useAddLink } from './nav';

/** Боковая панель ПК (≥ 1024px): знак, пункты меню, «Добавить операцию» и место для индикатора синхронизации. */
export function SideNav({ status }: { status?: ReactNode }) {
  const addLink = useAddLink();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-4 border-r border-border bg-surface px-3 py-5 lg:flex">
      <div className="flex items-center gap-3 px-3">
        <Logo size={36} />
        <span className="text-xl font-bold tracking-tight">Finora</span>
      </div>
      <Link {...addLink} className={cn(buttonClasses('primary', 'md', true), 'whitespace-nowrap')}>
        <Icon name="plus" size={22} strokeWidth={2.5} />
        {ADD_LABEL}
      </Link>
      <nav aria-label="Основная навигация" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-base font-semibold transition-colors',
                isActive ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon name={item.icon} size={22} />
            {item.sideLabel}
          </NavLink>
        ))}
      </nav>
      {status && <div className="mt-auto flex flex-wrap gap-2 px-1">{status}</div>}
    </aside>
  );
}
