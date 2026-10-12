import { useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { ACCENTS, type AccentId } from '@/theme';

export interface AccentPickerProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
}

/**
 * Выбор цвета акцента: образцы с подписями. Устроен как Segmented — одна группа radio: внутрь заходят одним Tab,
 * дальше стрелки. Образец показывает кнопку этого акцента в текущей теме (стили .accent-swatch в index.css);
 * выбранный отмечен галочкой и кольцом, чтобы выбор был виден не только по цвету.
 */
export function AccentPicker({ value, onChange }: AccentPickerProps) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const n = ACCENTS.length;
    const to = (from + delta + n) % n;
    const next = ACCENTS[to];
    if (!next) return;
    onChange(next.id);
    refs.current[to]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, -1);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-semibold text-text">
        Цвет акцента
      </span>
      {/* Семь образцов: на телефоне 4 + 3, в один ряд — только от lg (с боковой панелью карточка уже, и подписи не помещаются). */}
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-4 gap-1 lg:grid-cols-7">
        {ACCENTS.map((accent, i) => {
          const selected = accent.id === value;
          return (
            <button
              key={accent.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex, как в Segmented: в группу заходим одним Tab, внутри — стрелками.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(accent.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'flex min-h-[44px] flex-col items-center gap-1.5 rounded-2xl px-0 py-2 transition duration-200 ease-spring active:scale-95',
                selected ? 'bg-brand/10' : 'hover:bg-surface-2',
              )}
            >
              <span
                aria-hidden="true"
                data-accent={accent.id}
                className={cn(
                  'accent-swatch flex h-10 w-10 items-center justify-center rounded-full text-brand-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
                  selected && 'ring-2 ring-brand ring-offset-2 ring-offset-transparent',
                )}
              >
                {selected && <Icon name="check" size={20} />}
              </span>
              <span className={cn('text-[11px] font-semibold sm:text-xs', selected ? 'text-text' : 'text-muted')}>{accent.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
