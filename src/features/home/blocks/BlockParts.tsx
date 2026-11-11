import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

/** Общие части блоков, которые человек сам выносит на «Главную»: заголовок-ссылка, полоска прогресса и пустое состояние. */

export interface BlockTitleProps {
  id: string;
  to: string;
  icon: IconName;
  /** Классы цвета плитки значка. */
  tone: string;
  /** Имя ссылки для скринридера: что это и куда ведёт. */
  label: string;
  /** Блок в половину ширины: стрелки нет, чтобы название помещалось целиком. */
  half?: boolean;
  children: ReactNode;
}

/** Заголовок блока: значок, название и стрелка; вся строка ведёт в раздел. */
export function BlockTitle({ id, to, icon, tone, label, half = false, children }: BlockTitleProps) {
  return (
    <Link to={to} aria-label={label} className={cn('press -my-1 flex min-h-[44px] items-center', half ? 'gap-2' : 'gap-2.5')}>
      <span aria-hidden="true" className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone)}>
        <Icon name={icon} size={18} />
      </span>
      <h2 id={id} className="section-title min-w-0 flex-1 truncate">
        {children}
      </h2>
      {!half && <Icon name="chevron" size={16} className="shrink-0 text-muted" />}
    </Link>
  );
}

/** Отступы карточки блока: во всю ширину — обычные поля карточки; в половину поля уже, чтобы содержимому хватало места на узком телефоне. */
export const blockCardClass = (half: boolean): string => (half ? '!p-3' : '');

/** Тонкая полоска доли или прогресса (0…100); color (#rrggbb) красит её цветом категории. Сама она украшение: число рядом читает и скринридер. */
export function MiniBar({ percent, className, fill = 'bg-brand', color }: { percent: number; className?: string; fill?: string; color?: string | null }) {
  const shown = Math.min(100, Math.max(0, percent));
  return (
    <span aria-hidden="true" className={cn('block h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <span
        className={cn('bar-grow block h-full rounded-full', !color && fill)}
        style={{ width: `${shown > 0 ? Math.max(shown, 3) : 0}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </span>
  );
}

/** Пустой блок: человек сам вынес его на главную, поэтому вместо пустоты — одна строка и ссылка, что сделать. */
export function BlockEmpty({ text, to, action }: { text: string; to: string; action: string }) {
  return (
    <p className="mt-1.5 text-sm text-muted">
      {text}{' '}
      <Link to={to} className="font-semibold text-brand">
        {action}
      </Link>
    </p>
  );
}

/** Заглушка, пока данные блока читаются: той же высоты, что строка заголовка, без «прыжка» вёрстки. */
export function BlockBusy() {
  return (
    <span role="status" className="mt-2 block text-sm text-muted">
      Загрузка…
    </span>
  );
}
