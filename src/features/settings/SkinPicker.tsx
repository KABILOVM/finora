import { useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { SKINS, type SkinId } from '@/skins';

export interface SkinPickerProps {
  value: SkinId;
  onChange: (id: SkinId) => void;
}

/**
 * Выбор образа: «Классика» и клубные образы. Радиогруппа, как у выбора цвета: в группу заходят одним Tab, внутри — стрелками.
 * Три цветные точки на карточке — просто образец (фон, главный и второй цвет образа), на сам образ они не влияют.
 */
export function SkinPicker({ value, onChange }: SkinPickerProps) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const to = (from + delta + SKINS.length) % SKINS.length;
    const next = SKINS[to];
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
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-semibold text-text">
        Образ
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-3">
        {SKINS.map((skin, i) => {
          const selected = skin.id === value;
          return (
            <button
              key={skin.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              data-skin-option={skin.id}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(skin.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'flex min-h-[64px] items-center gap-3 rounded-2xl border p-3 text-left transition duration-200 ease-spring active:scale-[0.98]',
                selected ? 'border-brand bg-brand/10' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              <span aria-hidden="true" className="flex shrink-0 -space-x-2">
                {skin.swatch.map((color, k) => (
                  <span key={k} style={{ backgroundColor: color }} className="h-7 w-7 rounded-full border-2 border-surface shadow-sm" />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-text">{skin.label}</span>
                <span className="block text-sm text-muted">{skin.hint}</span>
              </span>
              {selected && <Icon name="check" size={20} className="shrink-0 text-brand" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
