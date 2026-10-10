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
          'flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors',
          isActive ? 'text-brand' : 'text-muted hover:text-text',
        )
      }
    >
      <Icon name={item.icon} size={24} />
      <span>{item.label}</span>
    </NavLink>
  );
}

/** Нижняя панель телефона и планшета (< 1024px): 2 пункта, большая «+», 2 пункта. Уважает «чёлку» снизу (safe-area). */
export function BottomNav() {
  const addLink = useAddLink();
  const [first, second, third, fourth] = NAV_ITEMS;
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5 items-center px-2">
        {first && <Item item={first} />}
        {second && <Item item={second} />}
        <div className="flex justify-center">
          <Link
            {...addLink}
            aria-label={ADD_LABEL}
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-fg shadow-float transition-transform active:scale-95"
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
