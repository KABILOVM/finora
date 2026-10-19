import { useId } from 'react';
import { SwitchTrack } from '@/components/Switch';
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
      <SwitchTrack checked={checked} />
    </button>
  );
}
