import { useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { SKIN_THUMBS } from '@/skinThumbs';
import { SKIN_GROUPS, SKINS, type SkinId } from '@/skins';

export interface SkinPickerProps {
  value: SkinId;
  onChange: (id: SkinId) => void;
}

/**
 * Выбор образа: «Классика» и готовые образы, по разделам (футбол, кино и аниме, национальные, стили). Одна радиогруппа, как у выбора
 * цвета: в группу заходят одним Tab, внутри — стрелками по всему списку (разделы — только заголовки над карточками).
 * Слева на карточке: значок образа (герб, флаг, герой или иллюстрация; src/skinThumbs.ts). Он просто показывает, о чём образ, на сам образ не влияет.
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
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-3">
        {SKIN_GROUPS.map((group) => {
          const items = SKINS.filter((skin) => skin.group === group.id);
          return (
            <div key={group.id} data-skin-group={group.id} className="flex flex-col gap-2">
              {group.id !== 'classic' && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((skin) => {
                  const i = SKINS.indexOf(skin);
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
                      <img
                        src={SKIN_THUMBS[skin.id]}
                        alt=""
                        width={44}
                        height={44}
                        loading="lazy"
                        decoding="async"
                        data-skin-thumb={skin.id}
                        className="h-11 w-11 shrink-0 rounded-xl border border-border bg-surface-2 object-contain p-0.5"
                      />
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
        })}
      </div>
    </div>
  );
}
