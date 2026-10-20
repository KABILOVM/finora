import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Sheet } from './Sheet';

export interface ActionMenuItem {
  key: string;
  label: string;
  /** Одна строка пояснения под названием. */
  hint?: string;
  icon?: IconName;
  /** 'danger' — необратимое или разрушительное действие (красным, в конце списка). */
  tone?: 'danger';
  onSelect: () => void;
}

export interface ActionMenuProps {
  items: readonly ActionMenuItem[];
  /** Подпись кнопки «⋯» для скринридера. */
  label?: string;
  /** Заголовок окна с действиями. */
  title?: string;
}

/**
 * Меню «⋯»: кнопка в шапке страницы открывает окно со списком редких действий. Выбор действия закрывает окно и запускает действие;
 * действие, которое открывает другое окно, делает это само (стопка окон переживёт смену без прыжков по истории браузера).
 */
export function ActionMenu({ items, label = 'Ещё действия', title = 'Действия' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (items.length === 0) return null;
  return (
    <>
      <IconButton icon="more" label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <ul className="-mx-2 flex flex-col">
          {items.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                // имя кнопки — само действие; пояснение читается как описание
                aria-label={it.label}
                aria-describedby={it.hint ? `${id}-${it.key}` : undefined}
                onClick={() => {
                  it.onSelect();
                  setOpen(false);
                }}
                className={cn(
                  'flex min-h-[56px] w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-surface-2 active:bg-border/60',
                  it.tone === 'danger' ? 'text-danger' : 'text-text',
                )}
              >
                {it.icon && <Icon name={it.icon} size={22} className={it.tone === 'danger' ? 'shrink-0' : 'shrink-0 text-muted'} />}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{it.label}</span>
                  {it.hint && <span id={`${id}-${it.key}`} className={cn('block text-sm', it.tone === 'danger' ? 'text-danger/80' : 'text-muted')}>{it.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
