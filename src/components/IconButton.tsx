import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** Обязательная подпись для скринридера (у кнопки без текста иначе нет имени). */
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  iconSize?: number;
}

const VARIANTS = {
  ghost: 'text-muted hover:bg-surface-2 hover:text-text active:bg-border',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-border/60',
  danger: 'text-danger hover:bg-danger/10 active:bg-danger/15',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', iconSize = 22, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        // 44×44 — минимальная область касания.
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
});
