import { cn } from '@/lib/cn';

export interface ChipOption {
  value: string;
  label: string;
  /** Эмодзи или короткий символ перед названием. */
  icon?: string;
}

export interface ChipPickerProps {
  options: readonly ChipOption[];
  /** Выбранное значение; null — ничего не выбрано. */
  value: string | null;
  onChange: (value: string) => void;
  /** Название группы для скринридера, например «Категория». */
  ariaLabel: string;
  /** 'wrap' — переносить на новые строки; 'scroll' — одна строка с горизонтальной прокруткой. */
  layout?: 'wrap' | 'scroll';
  className?: string;
}

/** Выбор одного варианта из набора «чипсов» (категория, кошелёк). Каждый чип ≥ 44px по высоте. */
export function ChipPicker({ options, value, onChange, ariaLabel, layout = 'wrap', className }: ChipPickerProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex gap-2',
        layout === 'wrap' ? 'flex-wrap' : '-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]',
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-base font-medium transition-colors',
              selected
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text hover:bg-surface-2',
            )}
          >
            {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
            <span className="whitespace-nowrap">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
