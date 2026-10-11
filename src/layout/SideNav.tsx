import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';
import { ADD_LABEL, isNavActive, NAV_ITEMS, useAddLink, type NavItem } from './nav';

function SideLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const isActive = isNavActive(item, pathname, 'side');
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-base font-semibold transition-colors',
        isActive ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon name={item.icon} size={22} />
      {item.sideLabel}
    </Link>
  );
}

/**
 * Боковая панель планшета и ПК (≥ 768px): знак, «Добавить операцию», основные пункты, внизу «Ещё» и «Настройки»
 * (отделены чертой) и место для индикатора синхронизации.
 */
export function SideNav({ status }: { status?: ReactNode }) {
  const addLink = useAddLink();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-4 overflow-y-auto border-r border-border bg-surface px-3 py-5 md:flex">
      <div className="flex items-center gap-3 px-3">
        <Logo size={36} />
        <span className="text-xl font-bold tracking-tight">Finora</span>
      </div>
      <Link {...addLink} className={cn(buttonClasses('primary', 'md', true), 'whitespace-nowrap')}>
        <Icon name="plus" size={22} strokeWidth={2.5} />
        {ADD_LABEL}
      </Link>
      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.filter((item) => item.side === 'main').map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          {NAV_ITEMS.filter((item) => item.side === 'bottom').map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
      {status && <div className="flex flex-wrap gap-2 px-1">{status}</div>}
    </aside>
  );
}
