import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { DebtRow } from './DebtRow';
import type { DebtItem } from './debtSummary';
import { dueInfo } from './debtText';

type Bucket = 'overdue' | 'soon' | 'later';

const BUCKET_TITLE: Record<Bucket, string> = { overdue: 'Просрочено', soon: 'Скоро срок', later: 'Остальные' };
const BUCKET_TONE: Record<Bucket, string> = { overdue: 'text-danger', soon: 'text-warning', later: 'text-muted' };

/** В какую «кучку» попадает долг по сроку: просрочен, срок в ближайшие три дня (или сегодня) или всё остальное. */
function bucketOf(it: DebtItem, today: string): Bucket {
  const tone = dueInfo(it.debt.dueOn, today, it.debt.closedAt === null && it.state !== null && !it.state.settled).tone;
  return tone === 'overdue' ? 'overdue' : tone === 'soon' || tone === 'today' ? 'soon' : 'later';
}

export interface DebtListProps {
  items: readonly DebtItem[];
  today: string;
  label: string;
  onRestore?: (it: DebtItem) => void;
  busy?: boolean;
  /** Разложить по срокам («Просрочено», «Скоро срок», «Остальные»), если в списке есть хотя бы две непустые кучки. Порядок внутри — прежний. */
  sections?: boolean;
}

/**
 * Список долгов одной карточкой. С `sections` строки группируются по срокам, а над группами стоят подписи; список остаётся одним
 * (<ul>), подписи — не элементы списка (role="presentation"), поэтому читаются как заголовки группы, а не как лишние строки.
 */
export function DebtList({ items, today, label, onRestore, busy, sections = false }: DebtListProps) {
  const buckets = new Map<Bucket, DebtItem[]>();
  if (sections) for (const it of items) buckets.set(bucketOf(it, today), [...(buckets.get(bucketOf(it, today)) ?? []), it]);
  const grouped = sections && buckets.size >= 2;
  const order: Bucket[] = ['overdue', 'soon', 'later'];
  const row = (it: DebtItem) => (
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
  );
  return (
    <Card padding="none" className="overflow-hidden">
      <ul aria-label={label} className="divide-y divide-border">
        {grouped
          ? order.flatMap((b) => {
              const list = buckets.get(b);
              if (!list) return [];
              return [
                <li key={`h-${b}`} role="presentation" data-testid={`debts-bucket-${b}`} className={cn('bg-surface-2/70 px-4 py-1.5 text-sm font-semibold', BUCKET_TONE[b])}>
                  {BUCKET_TITLE[b]} · {list.length}
                </li>,
                ...list.map(row),
              ];
            })
          : items.map(row)}
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
