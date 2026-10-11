import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Переключатель «включено / выключено» на всю строку (≥ 56 px): подпись и пояснение слева, ползунок справа. */
export function ToggleRow({ label, hint, checked, onChange, disabled = false }: ToggleRowProps) {
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
      className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span id={`${id}-l`} className="block text-base font-medium text-text">
          {label}
        </span>
        {hint && (
          <span id={`${id}-h`} className="block text-sm text-muted">
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
