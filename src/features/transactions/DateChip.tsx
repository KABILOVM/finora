import { useRef, useState } from 'react';
import { Floating, useDismiss } from '@/components/Floating';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { formatDayLabel, isValidIsoDate, todayLocal } from '@/lib/dates';
import { DateChips } from './DateChips';
import { resolveDate } from './txForm';
import type { TxFormController } from './useTxFormController';

/**
 * Дата операции в шапке окна, рядом с названием: «Сегодня ▾». Нажатие открывает короткий список (Сегодня / Вчера / Другая дата)
 * поверх формы. Ошибка даты раскрывает список сама.
 */
export function DateChip({ c }: { c: TxFormController }) {
  const { form, errors } = c;
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = open || !!errors.date;
  useDismiss(open && !errors.date, () => setOpen(false), boxRef);

  const resolved = resolveDate(form.date);
  const dateText = isValidIsoDate(resolved) ? formatDayLabel(resolved, todayLocal()) : 'Дата не указана';

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-label={`Дата: ${dateText}`}
        aria-expanded={shown}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors',
          errors.date
            ? 'border-danger text-danger'
            : shown
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-surface text-text active:bg-surface-2',
        )}
      >
        <Icon name="calendar" size={18} className="shrink-0 text-muted" />
        <span className="whitespace-nowrap">{dateText}</span>
        <Icon name="chevron" size={12} className={cn('shrink-0 text-muted transition-transform', shown ? '-rotate-90' : 'rotate-90')} />
      </button>
      {shown && (
        <Floating className="inset-x-auto right-0 w-[min(22rem,calc(100vw-2.5rem))]">
          <DateChips value={form.date} onChange={(date) => c.set({ date })} onDone={() => setOpen(false)} error={errors.date} hideLabel />
        </Floating>
      )}
    </div>
  );
}
