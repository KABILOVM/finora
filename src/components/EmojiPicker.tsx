import { cn } from '@/lib/cn';

/** Набор для значков категорий и кошельков: еда, дом, транспорт, здоровье, досуг, работа, деньги. */
export const DEFAULT_EMOJIS: readonly string[] = [
  '🛒', '🍔', '☕', '🍽️', '🥩', '🍞', '🍎', '🥤',
  '🏠', '💡', '🔧', '🛋️', '🧴', '🧺', '📱', '💻',
  '🚌', '🚕', '🚗', '⛽', '✈️', '🚆', '🛵', '🅿️',
  '💊', '🏥', '🦷', '💇', '👕', '👟', '🎓', '📚',
  '🎬', '🎮', '🎁', '🎉', '🏖️', '⚽', '🐾', '👶',
  '💼', '💰', '💵', '💳', '🏦', '📈', '🧾', '🪙',
  '🤝', '🕌', '📦', '⭐', '❤️', '🔒', '💸', '❓',
];

export interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  emojis?: readonly string[];
  /** Название группы для скринридера. */
  ariaLabel?: string;
  className?: string;
}

/** Сетка эмодзи для выбора значка. Каждая ячейка — 44×44 и больше. */
export function EmojiPicker({ value, onChange, emojis = DEFAULT_EMOJIS, ariaLabel = 'Значок', className }: EmojiPickerProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid gap-1', className)}
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))' }}
    >
      {emojis.map((e) => {
        const selected = e === value;
        return (
          <button
            key={e}
            type="button"
            aria-label={e}
            aria-pressed={selected}
            onClick={() => onChange(e)}
            className={cn(
              'flex h-11 items-center justify-center rounded-xl text-2xl transition-colors',
              selected ? 'bg-brand/15 ring-2 ring-brand' : 'hover:bg-surface-2',
            )}
          >
            <span aria-hidden="true">{e}</span>
          </button>
        );
      })}
    </div>
  );
}
