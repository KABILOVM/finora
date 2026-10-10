import { IconButton } from '@/components/IconButton';
import { monthTitle } from '@/lib/dates';
import { canShiftMonth, shiftMonth } from './txFilters';

export interface MonthSwitcherProps {
  /** 'ГГГГ-ММ' */
  month: string;
  onChange: (month: string) => void;
  /** Не пускать дальше этого месяца вперёд ('ГГГГ-ММ'). */
  max?: string;
  className?: string;
}

/** Переключатель месяца со стрелками. */
export function MonthSwitcher({ month, onChange, max, className }: MonthSwitcherProps) {
  const next = shiftMonth(month, 1);
  const canNext = canShiftMonth(month, 1) && (max === undefined || next <= max);
  const canPrev = canShiftMonth(month, -1);
  return (
    <div className={`flex items-center justify-between gap-2 ${className ?? ''}`}>
      <IconButton
        icon="chevron"
        label="Предыдущий месяц"
        className="rotate-180"
        disabled={!canPrev}
        onClick={() => onChange(shiftMonth(month, -1))}
      />
      <span className="text-base font-semibold" aria-live="polite">
        {monthTitle(month)}
      </span>
      <IconButton icon="chevron" label="Следующий месяц" disabled={!canNext} onClick={() => onChange(next)} />
    </div>
  );
}
