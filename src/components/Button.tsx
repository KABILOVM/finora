import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

/** Классы по вариантам — общие для Button и ссылок, выглядящих как кнопка. */
export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-br from-brand to-accent text-brand-fg shadow-[0_10px_24px_-10px_rgb(var(--brand)/0.7)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface/70 text-text border border-border backdrop-blur hover:bg-surface-2 active:bg-border/60',
  ghost: 'bg-transparent text-brand hover:bg-brand/10 active:bg-brand/15',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80 dark:text-bg',
};

export function buttonClasses(variant: ButtonVariant, size: ButtonSize = 'md', fullWidth = false): string {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 rounded-2xl px-4 font-semibold transition duration-200 ease-spring active:scale-[0.97]',
    // Область касания ≥ 44px.
    size === 'lg' ? 'min-h-[52px] text-lg' : 'min-h-[44px] text-base',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
    BUTTON_VARIANTS[variant],
    fullWidth && 'w-full',
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Идёт операция: кнопка блокируется (повторный тап не задвоит действие) и показывает индикатор. */
  loading?: boolean;
  fullWidth?: boolean;
  icon?: IconName;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, fullWidth = false, icon, className, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size, fullWidth), className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
});
