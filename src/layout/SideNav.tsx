import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
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
        'flex min-h-[44px] items-center gap-3 rounded-2xl px-3 text-base font-semibold transition duration-200 active:scale-[0.97]',
        isActive ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon name={item.icon} size={22} />
      {item.sideLabel}
    </Link>
  );
}

/**
 * Боковая панель планшета и ПК (≥ 768px): знак, «Добавить операцию», основные пункты, внизу «Настройки»
 * (отделены чертой) и место для индикатора синхронизации.
 */
export function SideNav({ status }: { status?: ReactNode }) {
  const addLink = useAddLink();
  return (
    <aside className="fixed bottom-3 left-3 top-3 z-30 hidden w-56 flex-col gap-4 overflow-y-auto rounded-3xl border border-border/70 bg-surface/70 px-3 py-5 shadow-card backdrop-blur-xl md:flex">
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
        <div className="mt-auto flex flex-col gap-1 border-t border-border/70 pt-3">
          {NAV_ITEMS.filter((item) => item.side === 'bottom').map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <ThemeToggle />
        {status}
      </div>
    </aside>
  );
}
