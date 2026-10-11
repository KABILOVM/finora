import { Link, NavLink } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { ADD_LABEL, NAV_ITEMS, useAddLink, type NavItem } from './nav';

function Item({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold transition duration-200 active:scale-95',
          isActive ? 'text-brand' : 'text-muted hover:text-text',
        )
      }
    >
      <Icon name={item.icon} size={24} />
      <span>{item.label}</span>
    </NavLink>
  );
}

/** Нижняя панель телефона (< 768px): 2 пункта, большая «+», 2 пункта. Уважает «чёлку» снизу (safe-area). */
export function BottomNav() {
  const addLink = useAddLink();
  const [first, second, third, fourth] = NAV_ITEMS;
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-3xl border border-border/70 bg-surface/80 shadow-float backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5 items-center px-2">
        {first && <Item item={first} />}
        {second && <Item item={second} />}
        <div className="flex justify-center">
          <Link
            {...addLink}
            aria-label={ADD_LABEL}
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-accent text-brand-fg shadow-[0_14px_28px_-8px_rgb(var(--brand)/0.8)] transition duration-200 ease-spring hover:brightness-110 active:scale-90"
          >
            <Icon name="plus" size={30} strokeWidth={2.5} />
          </Link>
        </div>
        {third && <Item item={third} />}
        {fourth && <Item item={fourth} />}
      </div>
    </nav>
  );
}
