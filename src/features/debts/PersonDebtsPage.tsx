import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, DebtDirection } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { mergeCandidates } from './debtMatch';
import type { DebtItem } from './debtSummary';
import { DIRECTION_LABEL } from './debtText';
import { DebtList, Fold } from './DebtLists';
import { MergeDebtsSheet } from './MergeDebtsSheet';
import { NettingSheet } from './NettingSheet';
import { nettableCurrencies, planNetting } from './netting';
import { canNet, groupByPerson, personKey, reminderText, type PersonTotals } from './people';
import { ReminderSheet } from './ReminderSheet';
import { useDebtsData } from './useDebtsData';

type Dialog = { kind: 'remind' } | { kind: 'merge'; target: DebtItem } | { kind: 'net'; currency: CurrencyCode } | null;

const BACK = { to: '/debts?dir=people', label: 'Долги' } as const;

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title="Человек" back={BACK} />
      <EmptyState
        icon="alert"
        title={title}
        text={text}
        action={
          <Link to="/debts" className={buttonClasses('primary', 'lg')}>
            К списку долгов
          </Link>
        }
      />
    </>
  );
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t border-border pt-1 font-semibold' : ''}`}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TotalsBlock({ t }: { t: PersonTotals }) {
  return (
    <section aria-label={`Итого в ${t.currency}`} data-testid={`person-total-${t.currency}`}>
      <h3 className="mb-1 text-sm font-semibold text-muted">{t.currency}</h3>
      <dl className="flex flex-col gap-1">
        {t.lentMinor > 0 && (
          <Row label="Вам должны">
            <MoneyText minor={t.lentMinor} currency={t.currency} tone="none" className="font-semibold" />
          </Row>
        )}
        {t.borrowedMinor > 0 && (
          <Row label="Вы должны">
            <MoneyText minor={t.borrowedMinor} currency={t.currency} tone="none" className="font-semibold" />
          </Row>
        )}
        {canNet(t) && (
          <Row label={t.netMinor >= 0 ? 'Итого вам должны' : 'Итого вы должны'} strong>
            <MoneyText minor={Math.abs(t.netMinor)} currency={t.currency} tone="none" className="font-bold" />
          </Row>
        )}
      </dl>
    </section>
  );
}

const DIRECTIONS: readonly DebtDirection[] = ['lent', 'borrowed'];

/**
 * Страница человека: все его долги вместе — сколько он должен мне и сколько я ему (по каждой валюте отдельно), напоминание о долге,
 * объединение долгов-дублей. Остаток и платежи — на страницах самих долгов.
 */
export default function PersonDebtsPage() {
  const { key = '' } = useParams();
  const data = useDebtsData();
  const today = useToday();
  const [dialog, setDialog] = useState<Dialog>(null);
  const people = useMemo(() => (data ? groupByPerson(data.items, data.base ?? undefined) : null), [data]);

  if (data === undefined || people === null) {
    return (
      <>
        <PageHeader title="Человек" back={BACK} />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }
  const person = people.find((p) => p.key === personKey(key));
  if (!person) return <Notice title="Человек не найден" text="Возможно, все его долги удалены или в архиве. Вернитесь к списку долгов." />;

  const remind = reminderText(person, today);
  const nets = nettableCurrencies(person).flatMap((t) => {
    const plan = planNetting(person.open, t.currency);
    return plan ? [{ currency: t.currency, totalMinor: plan.totalMinor }] : [];
  });
  const lentOpen = person.open.filter((it) => it.debt.direction === 'lent');
  const borrowedOpen = person.open.filter((it) => it.debt.direction === 'borrowed');
  // Дубли: несколько открытых долгов одного направления и валюты — их можно объединить в один
  const dupGroups = DIRECTIONS.flatMap((direction) => {
    const byCurrency = new Map<string, DebtItem[]>();
    for (const it of person.open) {
      if (it.debt.direction !== direction || it.state === null) continue;
      const list = byCurrency.get(it.debt.currency);
      if (list) list.push(it);
      else byCurrency.set(it.debt.currency, [it]);
    }
    return [...byCurrency.values()].filter((g) => g.length > 1 && mergeCandidates(data.items, g[0]!.debt).length > 0).map((g) => ({ direction, items: g }));
  });

  return (
    <>
      <PageHeader back={BACK} title={person.name} subtitle={`${person.open.length} ${pluralRu(person.open.length, 'открытый долг', 'открытых долга', 'открытых долгов')}`} />

      {person.overflow ? (
        <p role="alert" className="mb-4 font-medium text-danger">
          {DEBT_OVERFLOW_MESSAGE}
        </p>
      ) : person.totals.length > 0 ? (
        <Card aria-label={`Итоги: ${person.name}`} data-testid="person-totals" className="mb-4 flex flex-col gap-3">
          {person.totals.map((t) => (
            <TotalsBlock key={t.currency} t={t} />
          ))}
        </Card>
      ) : null}

      {(remind !== null || dupGroups.length > 0 || nets.length > 0) && (
        <div className="mb-4 flex flex-col gap-2">
          {nets.map((n) => (
            <Button key={n.currency} variant="secondary" onClick={() => setDialog({ kind: 'net', currency: n.currency })}>
              Взаимозачёт: {formatMinor(n.totalMinor, n.currency)}
            </Button>
          ))}
          {remind !== null && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'remind' })}>
              Напомнить о долге
            </Button>
          )}
          {dupGroups.map((g) => (
            <Button key={`${g.direction}-${g.items[0]!.debt.currency}`} variant="secondary" onClick={() => setDialog({ kind: 'merge', target: g.items[0]! })}>
              Объединить: {DIRECTION_LABEL[g.direction].toLowerCase()}, {g.items[0]!.debt.currency} ({g.items.length})
            </Button>
          ))}
        </div>
      )}

      {lentOpen.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1 px-1 text-sm font-semibold text-muted">{DIRECTION_LABEL.lent}</h2>
          <DebtList items={lentOpen} today={today} label={DIRECTION_LABEL.lent} />
        </section>
      )}
      {borrowedOpen.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1 px-1 text-sm font-semibold text-muted">{DIRECTION_LABEL.borrowed}</h2>
          <DebtList items={borrowedOpen} today={today} label={DIRECTION_LABEL.borrowed} />
        </section>
      )}
      {person.open.length === 0 && <p className="px-1 text-muted">Открытых долгов нет.</p>}
      {person.closed.length > 0 && (
        <Fold title="Закрытые" count={person.closed.length}>
          <DebtList items={person.closed} today={today} label="Закрытые долги" />
        </Fold>
      )}

      {dialog?.kind === 'remind' && remind !== null && <ReminderSheet name={person.name} text={remind} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'net' && data.base !== null && (
        <NettingSheet items={person.open} currency={dialog.currency} base={data.base} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'merge' && <MergeDebtsSheet target={dialog.target} items={data.items} onClose={() => setDialog(null)} />}
    </>
  );
}
