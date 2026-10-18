import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/cn';
import { GROUP_ORDER, GROUP_TITLE, type SectionGroup } from '@/app/sections';
import { ADD_LABEL, isNavActive, SIDE_ITEMS, useAddLink, type NavItem } from './nav';

function SideLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const isActive = isNavActive(item, pathname, 'side');
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-[40px] items-center gap-3 rounded-2xl px-3 py-1 text-base font-semibold leading-tight transition duration-200 active:scale-[0.97]',
        isActive ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon name={item.icon} size={22} />
      {item.label}
    </Link>
  );
}

/** Группа пунктов с маленьким заголовком (у основной группы заголовка нет). */
function SideGroup({ group }: { group: SectionGroup }) {
  const items = SIDE_ITEMS.filter((item) => item.group === group);
  if (items.length === 0) return null;
  const title = GROUP_TITLE[group];
  return (
    <div className={cn('flex flex-col gap-0.5', title !== '' && 'mt-3')}>
      {title !== '' && <p className="px-3 pb-0.5 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>}
      {items.map((item) => (
        <SideLink key={item.to} item={item} />
      ))}
    </div>
  );
}

/**
 * Боковая панель планшета и ПК (≥ 768px): знак, «Добавить операцию», группы разделов из реестра, внизу «Настройки»
 * (отделены чертой) и место для индикатора синхронизации.
 */
export function SideNav({ status }: { status?: ReactNode }) {
  const addLink = useAddLink();
  return (
    <aside className="fixed bottom-3 left-3 top-3 z-30 hidden w-56 flex-col gap-3 overflow-y-auto rounded-3xl border border-border/70 bg-surface/70 px-3 py-4 shadow-card backdrop-blur-xl md:flex">
      <div className="flex items-center gap-3 px-3">
        <Logo size={36} />
        <Wordmark className="text-xl" />
      </div>
      <Link {...addLink} className={cn(buttonClasses('primary', 'md', true), 'whitespace-nowrap')}>
        <Icon name="plus" size={22} strokeWidth={2.5} />
        {ADD_LABEL}
      </Link>
      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1">
        {GROUP_ORDER.filter((g) => g !== 'app').map((group) => (
          <SideGroup key={group} group={group} />
        ))}
        <div className="mt-auto flex flex-col gap-1 border-t border-border/70 pt-3">
          {SIDE_ITEMS.filter((item) => item.group === 'app').map((item) => (
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
