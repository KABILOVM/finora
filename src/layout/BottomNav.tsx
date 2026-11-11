import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { ADD_LABEL, isNavActive, PHONE_ITEMS, useAddLink, type NavItem } from './nav';

function Item({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const isActive = isNavActive(item, pathname, 'phone');
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'nav-item flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition duration-200 active:scale-95',
        isActive ? 'text-brand' : 'text-muted hover:text-text',
      )}
    >
      {/* Подложка под значком выбранного пункта: у парящей панели — «таблетка», у других видов меню её рисует или прячет look.css */}
      <span className="nav-ico flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200">
        <Icon name={item.icon} size={24} />
      </span>
      <span className="nav-label leading-none">{item.label}</span>
    </Link>
  );
}

/**
 * Нижняя панель телефона (< 768px): 2 пункта, большая «+», 2 пункта. Уважает «чёлку» снизу (safe-area).
 * Вид панели — черта образа data-nav (src/styles/look.css): парящая панель, полоса от края до края, узкий «остров» или плоские вкладки.
 * Разметка у всех видов одна, меняется только оформление.
 */
export function BottomNav() {
  const addLink = useAddLink();
  const [first, second, third, fourth] = PHONE_ITEMS;
  return (
    <nav
      aria-label="Основная навигация"
      className="bottom-nav fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-[1.75rem] border border-border/70 bg-surface/80 shadow-float backdrop-blur-xl md:hidden"
    >
      <div className="bottom-nav-inner mx-auto grid max-w-xl grid-cols-5 items-center px-1.5">
        {first && <Item item={first} />}
        {second && <Item item={second} />}
        <div className="flex justify-center">
          <Link
            {...addLink}
            aria-label={ADD_LABEL}
            className="nav-fab -mt-7 flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full bg-gradient-to-br from-brand to-accent text-brand-fg shadow-[0_14px_28px_-8px_rgb(var(--brand)/0.8)] transition duration-200 ease-spring hover:brightness-110 active:scale-90"
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
