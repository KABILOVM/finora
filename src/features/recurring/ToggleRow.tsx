import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Плотная строка (48 px, мелкое пояснение) для длинных окон. */
  compact?: boolean;
}

/** Переключатель «включено / выключено» на всю строку (≥ 56 px, compact — 48): подпись и пояснение слева, ползунок справа. */
export function ToggleRow({ label, hint, checked, onChange, disabled = false, compact = false }: ToggleRowProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={hint ? `${id}-h` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface text-left transition-colors hover:bg-surface-2 disabled:opacity-60',
        compact ? 'min-h-[48px] px-3 py-1.5' : 'min-h-[56px] px-4 py-2',
      )}
    >
      <span className="min-w-0 flex-1">
        <span id={`${id}-l`} className={cn('block font-medium text-text', compact ? 'text-base leading-tight' : 'text-base')}>
          {label}
        </span>
        {hint && (
          <span id={`${id}-h`} className={cn('block text-muted', compact ? 'text-xs leading-tight' : 'text-sm')}>
            {hint}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-brand bg-brand' : 'border-border-strong bg-surface-2',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}
