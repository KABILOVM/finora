import type { ReactNode } from 'react';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';

export interface RulePillProps {
  /** Значок слева: «i:…», банк или эмодзи (см. Glyph). */
  icon?: string;
  color?: string;
  label: ReactNode;
  ariaLabel: string;
  /** Список под пилюлей раскрыт. */
  open: boolean;
  invalid?: boolean;
  onClick: () => void;
  className?: string;
}

/** Небольшая кнопка-«пилюля» со списком («Наличные ▾»): как в окне «Новая операция», но не шире строки. */
export function RulePill({ icon, color, label, ariaLabel, open, invalid, onClick, className }: RulePillProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] max-w-full items-center gap-1 rounded-full border px-3 text-base font-medium transition-colors',
        invalid ? 'border-danger text-danger' : open ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
        className,
      )}
    >
      {icon && <Glyph value={icon} color={color} size={26} />}
      <span className="truncate">{label}</span>
      <Icon name="chevron" size={14} className={cn('shrink-0 text-muted transition-transform', open ? '-rotate-90' : 'rotate-90')} />
    </button>
  );
}
