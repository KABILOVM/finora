import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<NoticeTone, string> = {
  info: 'bg-brand/10 text-text',
  success: 'bg-income/10 text-income',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 font-medium text-danger',
};

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** Значок слева (по желанию). */
  icon?: IconName;
  /** Кнопка или ссылка под текстом («Повторить», «Открыть настройки»). */
  action?: ReactNode;
  /** По умолчанию: ошибка — «alert» (читается сразу), остальное — «status» (вежливо, не перебивая). */
  role?: 'status' | 'alert' | 'note';
  className?: string;
}

/** Плашка с пояснением или ошибкой: один вид вместо россыпи «rounded-xl bg-warning/10 p-3». */
export function Notice({ tone = 'info', children, icon, action, role, className }: NoticeProps) {
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={cn('rounded-control p-3', TONES[tone], className)}>
      <div className={cn(icon && 'flex items-start gap-2')}>
        {icon && <Icon name={icon} size={18} className="mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
