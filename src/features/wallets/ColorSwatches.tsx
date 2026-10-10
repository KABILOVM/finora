import { cn } from '@/lib/cn';
import { COLOR_CHOICES } from './walletUi';

export interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  ariaLabel?: string;
}

/** Выбор цвета из готового набора. Каждая кнопка ≥ 44 px. */
export function ColorSwatches({ value, onChange, ariaLabel = 'Цвет' }: ColorSwatchesProps) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {COLOR_CHOICES.map((c) => {
        const selected = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            aria-label={c.name}
            aria-pressed={selected}
            onClick={() => onChange(c.value)}
            className="flex h-11 w-11 items-center justify-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface', selected && 'ring-2 ring-text')}
              style={{ backgroundColor: c.value }}
            />
          </button>
        );
      })}
    </div>
  );
}
