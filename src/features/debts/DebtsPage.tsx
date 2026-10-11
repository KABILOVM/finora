import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { useToast } from '@/components/Toast';
import { DEBT_OVERFLOW_MESSAGE, useStore } from '@/db';
import type { DebtDirection } from '@/domain/types';
import { humanError } from '@/features/transactions/txActions';
import { cn } from '@/lib/cn';
import { todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { groupDebts, overdueCount, remainingByCurrency, type DebtItem } from './debtSummary';
import { DIRECTION_LABEL } from './debtText';
import { DebtRow } from './DebtRow';
import { DebtSheet } from './DebtSheet';
import { useDebtsData } from './useDebtsData';

const OPTIONS = [
  { value: 'lent', label: DIRECTION_LABEL.lent, tone: 'brand' },
  { value: 'borrowed', label: DIRECTION_LABEL.borrowed, tone: 'brand' },
] as const;

const EMPTY: Record<DebtDirection, { title: string; text: string }> = {
  lent: {
    title: 'Вам пока никто не должен',
    text: 'Записывайте, кому вы дали в долг: приложение покажет остаток, срок возврата и предупредит о просрочке.',
  },
  borrowed: {
    title: 'Вы никому не должны',
    text: 'Записывайте, у кого вы взяли в долг или кредит: остаток и сроки всегда будут перед глазами.',
  },
};

function Totals({ items, direction, base, today }: { items: readonly DebtItem[]; direction: DebtDirection; base: string | null; today: string }) {
  const sums = remainingByCurrency(items, base ?? undefined);
  const late = overdueCount(items, today);
  if (sums.ok && sums.totals.length === 0 && late === 0) return null;
  return (
    <Card aria-label={`Итого: ${DIRECTION_LABEL[direction].toLowerCase()}`} data-testid="debts-totals" className="mb-4">
      <p className="text-sm text-muted">{direction === 'lent' ? 'Вам должны всего' : 'Вы должны всего'}</p>
      {sums.ok ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {sums.totals.map((t) => (
            <li key={t.currency}>
              <MoneyText minor={t.minor} currency={t.currency} tone="none" className="text-[clamp(1.5rem,7vw,2rem)] font-bold leading-tight" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 font-medium text-danger">{DEBT_OVERFLOW_MESSAGE}</p>
      )}
      {sums.ok && sums.totals.length > 1 && <p className="mt-1 text-sm text-muted">Валюты не складываем: у каждой свой итог.</p>}
      {late > 0 && (
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" size={18} className="shrink-0" />
          Просрочено: {late} {pluralRu(late, 'долг', 'долга', 'долгов')}
        </p>
      )}
    </Card>
  );
}

function DebtList({ items, today, label, onRestore, busy }: { items: readonly DebtItem[]; today: string; label: string; onRestore?: (it: DebtItem) => void; busy?: boolean }) {
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

function Fold({ title, count, children }: { title: string; count: number; children: ReactNode }) {
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

/**
 * Долги и кредиты: переключатель «Мне должны» / «Я должен», итог по каждой валюте отдельно, строки с остатком, полосой и сроком
 * словами, свёрнутые «Закрытые» и «Архив». Остаток каждого долга считается из операций (нигде не хранится).
 */
export default function DebtsPage() {
  const store = useStore();
  const toast = useToast();
  const data = useDebtsData();
  const [params, setParams] = useSearchParams();
  const direction: DebtDirection = params.get('dir') === 'borrowed' ? 'borrowed' : 'lent';
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayLocal();

  const setDirection = (d: DebtDirection) => setParams(d === 'lent' ? {} : { dir: d }, { replace: true });
  const groups = useMemo(() => groupDebts(data?.items ?? [], direction), [data, direction]);

  const restore = async (it: DebtItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.debts.restore(it.debt.id);
      toast.success(`Долг «${it.debt.counterparty}» возвращён из архива`);
    } catch (e) {
      console.error('Не удалось вернуть долг из архива:', e);
      toast.error(humanError(e, 'Не удалось вернуть долг из архива'));
    } finally {
      setBusy(false);
    }
  };

  const base = data?.base ?? null;
  const header = (
    <PageHeader
      title="Долги и кредиты"
      actions={
        // на телефоне — только «+»: длинный заголовок «Долги и кредиты» иначе обрезается; имя кнопки для скринридера остаётся
        <Button icon="plus" aria-label="Новый долг" disabled={base === null} onClick={() => setSheet(true)}>
          <span className="hidden sm:inline">Новый долг</span>
        </Button>
      }
    />
  );

  if (data === undefined) {
    return (
      <>
        {header}
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }

  const noOpen = groups.active.length === 0;
  const empty = noOpen && groups.closed.length === 0;
  return (
    <>
      {header}
      <Segmented ariaLabel="Чьи долги" options={OPTIONS} value={direction} onChange={setDirection} className="mb-4" />
      <Totals items={groups.active} direction={direction} base={base} today={today} />

      {empty ? (
        <EmptyState
          icon="banknote"
          title={EMPTY[direction].title}
          text={EMPTY[direction].text}
          action={
            base !== null ? (
              <Button size="lg" icon="plus" onClick={() => setSheet(true)}>
                Записать долг
              </Button>
            ) : undefined
          }
        />
      ) : noOpen ? (
        <p className="px-1 text-muted">Открытых долгов нет.</p>
      ) : (
        <DebtList items={groups.active} today={today} label={DIRECTION_LABEL[direction]} />
      )}
      {groups.closed.length > 0 && (
        <Fold title="Закрытые" count={groups.closed.length}>
          <DebtList items={groups.closed} today={today} label="Закрытые долги" />
        </Fold>
      )}
      {groups.archived.length > 0 && (
        <Fold title="Архив" count={groups.archived.length}>
          <DebtList items={groups.archived} today={today} label="Долги в архиве" onRestore={(it) => void restore(it)} busy={busy} />
        </Fold>
      )}

      {sheet && base !== null && (
        <DebtSheet
          debt={null}
          defaultDirection={direction}
          base={base}
          onClose={() => setSheet(false)}
          onCreated={(d) => setDirection(d.direction)}
        />
      )}
    </>
  );
}
