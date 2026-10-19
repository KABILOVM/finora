import { cn } from '@/lib/cn';

/**
 * Дорожка переключателя: только картинка (aria-hidden). Её рисуют внутри кнопки, у которой уже есть role="switch"
 * (строка-переключатель целиком), а сам Switch — когда кнопка и есть переключатель.
 * Дорожка 48×28, ручка 24: цвет ручки берётся из токена «текст на brand» (белая в светлой теме, тёмная в тёмной).
 */
export function SwitchTrack({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border transition-colors',
        checked ? 'border-brand bg-brand' : 'border-border-strong bg-surface-2',
        className,
      )}
    >
      <span className={cn('absolute left-0.5 h-6 w-6 rounded-pill bg-brand-fg shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0')} />
    </span>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Название для скринридера, если рядом нет видимой подписи. */
  label?: string;
  /** id видимой подписи (aria-labelledby). */
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  /** Идёт действие (запрос Face ID и т. п.): переключатель ждёт. */
  busy?: boolean;
  className?: string;
}

/** Переключатель «включено / выключено». Область касания 44×56 при дорожке 48×28 — на телефоне попасть легко. */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled = false, busy = false, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-pill disabled:cursor-not-allowed disabled:opacity-50', className)}
    >
      <SwitchTrack checked={checked} />
    </button>
  );
}
