import { cn } from '@/lib/cn';
import { Glyph } from './Glyph';
import { GLYPH_CHOICES, GLYPH_LABELS, glyphValue, resolveGlyph } from './glyphs';

export interface GlyphPickerProps {
  /** Текущее значение поля icon («i:cup», «b:alif» или эмодзи). */
  value: string;
  onChange: (value: string) => void;
  /** Цвет категории или кошелька: значки показываются в нём. */
  color?: string;
  /** Название группы для скринридера. */
  ariaLabel?: string;
  className?: string;
}

/** Сетка значков для категории или кошелька. Каждая ячейка — не меньше 44×44. Старое эмодзи отмечается подходящей иконкой. */
export function GlyphPicker({ value, onChange, color, ariaLabel = 'Значок', className }: GlyphPickerProps) {
  const current = resolveGlyph(value);
  const currentName = current.kind === 'icon' ? current.name : null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid gap-1', className)}
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))' }}
    >
      {GLYPH_CHOICES.map((name) => {
        const selected = name === currentName;
        return (
          <button
            key={name}
            type="button"
            aria-label={GLYPH_LABELS[name] ?? name}
            aria-pressed={selected}
            onClick={() => onChange(glyphValue(name))}
            className={cn(
              'flex h-12 items-center justify-center rounded-2xl transition duration-200 ease-spring active:scale-90',
              selected ? 'bg-brand/15 ring-2 ring-brand' : 'hover:bg-surface-2',
            )}
          >
            <Glyph value={glyphValue(name)} color={color} size={36} />
          </button>
        );
      })}
    </div>
  );
}
