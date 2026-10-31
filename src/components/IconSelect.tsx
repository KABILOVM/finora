import { useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Floating, useDismiss } from './Floating';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import type { ChipOption } from './ChipPicker';

export interface IconSelectProps {
  /** Название поля: «Счёт», «Категория». Читается скринридером и подписывает кнопку. */
  label: string;
  options: readonly ChipOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** Что показать, если ничего не выбрано. */
  placeholder?: string;
  /** Нижняя часть списка (например, «Новая категория»); получает функцию закрытия списка. */
  footer?: (close: () => void) => ReactNode;
  /** 'sm' — компактная кнопка (44 px) для узких мест, например двух полей в строке. */
  size?: 'md' | 'sm';
  /** К какому краю кнопки прижат список; в правой колонке — 'right', чтобы не уходил за экран. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Свой выпадающий список со значками: кнопка с выбранным вариантом (значок, название, стрелка), список открывается под ней поверх формы.
 * Вместо системного <select>, где значков нет. Закрывается выбором, тапом мимо и Esc.
 */
export function IconSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Выбрать',
  footer,
  size = 'md',
  align = 'left',
  className,
}: IconSelectProps) {
  const glyph = size === 'sm' ? 26 : 30;
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, boxRef);
  const current = options.find((o) => o.value === value);

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          size === 'sm' ? 'min-h-[44px] gap-2 px-2' : 'min-h-[52px] gap-3 px-3',
          'flex w-full items-center rounded-xl border bg-surface text-left transition-colors',
          open ? 'border-brand ring-2 ring-brand/15' : 'border-border',
        )}
      >
        {current?.icon ? (
          <Glyph value={current.icon} color={current.color} size={glyph} />
        ) : (
          <span style={{ width: glyph, height: glyph }} className="shrink-0" aria-hidden="true" />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-base font-semibold', !current && 'text-muted')}>
          {current?.sub && <span className="font-normal text-muted">{current.sub} › </span>}
          {current?.label ?? placeholder}
        </span>
        <Icon name="chevron" size={14} className={cn('shrink-0 text-muted transition-transform', open ? '-rotate-90' : 'rotate-90')} />
      </button>
      {open && (
        <Floating
          className={cn(
            'inset-x-auto w-max min-w-full max-w-[calc(100vw-3rem)] max-h-[min(20rem,50vh)] overflow-y-auto p-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div id={listId} role="listbox" aria-label={label} className="flex flex-col">
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                  className={cn(
                    'flex min-h-[48px] items-center gap-3 rounded-xl px-2 text-left active:bg-surface-2',
                    selected ? 'bg-brand/10 text-brand' : 'text-text',
                  )}
                >
                  {o.icon ? (
                    <Glyph value={o.icon} color={o.color} size={30} />
                  ) : (
                    <span className="h-[30px] w-[30px] shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">
                    {o.sub && <span className="font-normal text-muted">{o.sub} › </span>}
                    {o.label}
                  </span>
                  {selected && <Icon name="check" size={18} className="shrink-0" />}
                </button>
              );
            })}
          </div>
          {footer && <div className="mt-1 border-t border-border pt-1">{footer(close)}</div>}
        </Floating>
      )}
    </div>
  );
}
