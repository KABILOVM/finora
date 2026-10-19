import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export interface BackLinkProps {
  /** Родительский раздел: «Долги», «Настройки». */
  to: string;
  /** Его название — на кнопке: «‹ Долги». */
  label: string;
}

/** «Назад» на вложенном экране: ведёт на родительский раздел (зона касания ≥ 44 px). Верхние разделы «Назад» не имеют. */
export function BackLink({ to, label }: BackLinkProps) {
  return (
    <Link to={to} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg pr-3 text-base font-semibold text-brand">
      <Icon name="chevron" size={18} className="rotate-180" />
      {label}
    </Link>
  );
}
