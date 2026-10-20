import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { DebtRow } from './DebtRow';
import type { DebtItem } from './debtSummary';

export function DebtList({ items, today, label, onRestore, busy }: { items: readonly DebtItem[]; today: string; label: string; onRestore?: (it: DebtItem) => void; busy?: boolean }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <ul aria-label={label} className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.debt.id} className={cn('flex items-center', onRestore && 'pr-2')}>
            <div className="min-w-0 flex-1">
              <DebtRow item={it} today={today} />
            </div>
            {onRestore && (
              <Button variant="secondary" className="shrink-0" disabled={busy} aria-label={`Вернуть из архива: ${it.debt.counterparty}`} onClick={() => onRestore(it)}>
                Вернуть
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Fold({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
      >
        <span>
          {title} · {count}
        </span>
        <Icon name="chevron" size={18} className={open ? 'rotate-90' : ''} />
      </button>
      {open && <div className="mt-1">{children}</div>}
    </section>
  );
}

/** «Погашены»: выплачены полностью, но не закрыты. Показываем отдельно от открытых и предлагаем закрыть разом. */
export function SettledSection({ items, today, busy, onCloseAll }: { items: readonly DebtItem[]; today: string; busy: boolean; onCloseAll: () => void }) {
  return (
    <section className="mt-6" aria-labelledby="debts-settled-title" data-testid="debts-settled">
      <div className="flex items-center justify-between gap-2">
        <h2 id="debts-settled-title" className="font-semibold text-muted">
          Погашены · {items.length}
        </h2>
        <Button variant="secondary" disabled={busy} aria-label={items.length > 1 ? `Закрыть все погашенные долги: ${items.length}` : 'Закрыть погашенный долг'} onClick={onCloseAll}>
          {items.length > 1 ? 'Закрыть все' : 'Закрыть'}
        </Button>
      </div>
      <p className="mb-2 mt-1 text-sm text-muted">Выплачены полностью. Закройте их, чтобы не висели среди открытых.</p>
      <DebtList items={items} today={today} label="Погашенные долги" />
    </section>
  );
}
