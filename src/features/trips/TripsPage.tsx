import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { TextInput } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { percentOf } from '@/domain/budgetLevels';
import type { Category, CurrencyCode, IsoDate, LocalRow, Transaction } from '@/domain/types';
import { budgetLabel, excludedText } from '@/features/budgets/budgetText';
import { useCategoryIndex } from '@/features/transactions/txData';
import { formatDayLabel } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { useActiveTrip } from './activeTrip';
import { tagFromName, tagKey, tagsOf, withoutTags, TAG_MAX, TAG_MIN, type TripInfo, type TripReport, type TripTx } from './trips';
import { useTripReport, useTrips } from './useTrips';

const dayCount = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
const opsCount = (n: number): string => `${n} ${pluralRu(n, 'операция', 'операции', 'операций')}`;

/** Один день — «Сегодня» или «пн, 5 окт»; несколько — «пн, 5 окт — ср, 7 окт». */
function periodText(first: IsoDate, last: IsoDate, today: IsoDate): string {
  return first === last ? formatDayLabel(first, today) : `${formatDayLabel(first, today)} — ${formatDayLabel(last, today)}`;
}

function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Загружаем…</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-24 !rounded-card" />
        <Skeleton className="h-40 !rounded-card" />
      </div>
    </div>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id} className="!py-4 md:!p-5">
      <h2 id={id} className="mb-2 text-base font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}

interface LookupRow {
  glyph: string;
  color: string | null;
  name: string;
}

/** Значок и название операции в списке: категория, «Перевод» или «Без категории». */
function lookup(t: Pick<Transaction, 'kind' | 'categoryId'>, categories: ReadonlyMap<string, LocalRow<Category>>): LookupRow {
  if (t.kind === 'transfer') return { glyph: '🔁', color: null, name: 'Перевод' };
  if (t.categoryId === null) return { glyph: '➖', color: null, name: 'Без категории' };
  const c = budgetLabel(t.categoryId, categories);
  return { glyph: c.icon, color: c.color, name: c.name };
}

function Summary({ report, base, today }: { report: TripReport; base: CurrencyCode; today: IsoDate }) {
  return (
    <Card aria-labelledby="trip-total-title" className="!py-4 md:!p-5" data-testid="trip-summary">
      <p id="trip-total-title" className="text-sm text-muted">
        Потрачено · {periodText(report.firstOn, report.lastOn, today)}
      </p>
      <p className="mt-1 text-3xl font-bold tracking-tight">
        <MoneyText minor={report.expenseMinor} currency={base} tone="none" />
      </p>
      <p className="mt-1 text-sm text-muted">
        {dayCount(report.days)} · в день около <MoneyText minor={report.perDayMinor} currency={base} tone="none" className="font-semibold text-text" /> ·{' '}
        {opsCount(report.count)}
      </p>
      {report.excludedCount > 0 && <p className="mt-2 text-sm text-warning">{excludedText(report.excludedCount, base)}</p>}
    </Card>
  );
}

function ByCategory({ report, categories, base }: { report: TripReport; categories: ReadonlyMap<string, LocalRow<Category>>; base: CurrencyCode }) {
  if (report.byCategory.length === 0) return null;
  return (
    <Block id="trip-cats" title="По категориям">
      <ul className="flex flex-col divide-y divide-border">
        {report.byCategory.map((c) => {
          const fee = c.kind === 'fee';
          const cat = c.categoryId === null ? null : budgetLabel(c.categoryId, categories);
          const share = percentOf(c.totalMinor, report.expenseMinor);
          return (
            <li key={fee ? 'fee' : (c.categoryId ?? 'none')} className="flex min-h-[56px] items-center gap-3 py-2" data-testid="trip-cat">
              <Glyph value={fee ? '🏦' : (cat?.icon ?? '➖')} color={fee ? undefined : (cat?.color ?? undefined)} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{fee ? 'Комиссии' : (cat?.name ?? 'Без категории')}</span>
                  <span className="shrink-0 text-xs text-muted">{share === 0 ? '<1%' : `${share}%`}</span>
                </span>
                <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-2">
                  <span className="block h-full rounded-pill bg-brand/70" style={{ width: `${Math.max(share, 2)}%` }} />
                </span>
              </span>
              <MoneyText minor={c.totalMinor} currency={base} tone="none" className="shrink-0 font-semibold" />
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function ByDay({ report, base, today }: { report: TripReport; base: CurrencyCode; today: IsoDate }) {
  if (report.byDay.length < 2) return null;
  const max = Math.max(...report.byDay.map((d) => d.expenseMinor), 1);
  return (
    <Block id="trip-days" title="По дням">
      <ul className="flex flex-col gap-2">
        {report.byDay.map((d) => (
          <li key={d.date} className="flex items-center gap-3 text-sm" data-testid="trip-day">
            <span className="w-24 shrink-0 text-muted">{formatDayLabel(d.date, today)}</span>
            <span aria-hidden="true" className="h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2">
              <span className="block h-full rounded-pill bg-brand/70" style={{ width: `${Math.max(Math.round((d.expenseMinor / max) * 100), 2)}%` }} />
            </span>
            <MoneyText minor={d.expenseMinor} currency={base} tone="none" className="shrink-0 font-medium" />
          </li>
        ))}
      </ul>
    </Block>
  );
}

function ByCurrency({ report }: { report: TripReport }) {
  if (report.byCurrency.length < 2) return null;
  return (
    <Block id="trip-currencies" title="Чем платили">
      <ul className="flex flex-col divide-y divide-border">
        {report.byCurrency.map((c) => (
          <li key={c.currency} className="flex min-h-[44px] items-center justify-between gap-3 py-2" data-testid="trip-currency">
            <span className="text-muted">{c.currency}</span>
            <MoneyText minor={c.minor} currency={c.currency} tone="none" className="font-semibold" />
          </li>
        ))}
      </ul>
    </Block>
  );
}

function OperationRow({ t, categories, base, today, currencyOf }: { t: TripTx; categories: ReadonlyMap<string, LocalRow<Category>>; base: CurrencyCode; today: IsoDate; currencyOf: ReadonlyMap<string, CurrencyCode> }) {
  const location = useLocation();
  const look = lookup(t, categories);
  const note = withoutTags(t.note);
  const currency = currencyOf.get(t.walletId) ?? base;
  return (
    <li data-testid="trip-op">
      <Link
        to={`/edit/${t.id}`}
        state={{ background: location }}
        className="flex min-h-[56px] items-center gap-3 rounded-lg py-2 outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
      >
        <Glyph value={look.glyph} color={look.color ?? undefined} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{note !== '' ? note : look.name}</span>
          <span className="block truncate text-sm text-muted">
            {formatDayLabel(t.occurredOn, today)} · {look.name}
          </span>
        </span>
        <MoneyText
          minor={t.kind === 'expense' ? -t.amountMinor : t.amountMinor}
          currency={currency}
          tone={t.kind === 'income' ? 'income' : t.kind === 'expense' ? 'expense' : 'none'}
          sign={t.kind === 'income' ? 'always' : t.kind === 'transfer' ? 'never' : 'auto'}
          className="shrink-0 font-semibold"
        />
      </Link>
    </li>
  );
}

interface DetailProps {
  report: TripReport;
  txs: readonly TripTx[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
  today: IsoDate;
  currencyOf: ReadonlyMap<string, CurrencyCode>;
  active: boolean;
  onStart: () => void;
  onEnd: () => void;
  onBack: () => void;
}

function TripDetail({ report, txs, categories, base, today, currencyOf, active, onStart, onEnd, onBack }: DetailProps) {
  const location = useLocation();
  const ops = useMemo(
    () =>
      txs
        .filter((t) => tagsOf(t.note).some((x) => tagKey(x) === report.key))
        .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : a.createdAt < b.createdAt ? 1 : -1)),
    [txs, report.key],
  );
  return (
    <>
      <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg pr-3 text-base font-semibold text-brand">
        <Icon name="chevron" size={18} className="rotate-180" />
        Все поездки
      </button>
      <PageHeader title={report.label} subtitle={`#${report.tag}`} className="!pt-0" />
      <div className="flex flex-col gap-4">
        <Summary report={report} base={base} today={today} />
        <div>
          {active ? (
            <Button variant="secondary" fullWidth onClick={onEnd}>
              Завершить поездку
            </Button>
          ) : (
            <Button variant="primary" fullWidth icon="plane" onClick={onStart}>
              Вести эту поездку
            </Button>
          )}
        </div>
        <ByCategory report={report} categories={categories} base={base} />
        <ByDay report={report} base={base} today={today} />
        <ByCurrency report={report} />
        {report.biggest.length > 0 && (
          <Block id="trip-biggest" title="Самые крупные траты">
            <ul className="flex flex-col divide-y divide-border">
              {report.biggest.map((b) => {
                const cat = b.categoryId === null ? null : budgetLabel(b.categoryId, categories);
                return (
                  <li key={b.txId} data-testid="trip-big">
                    <Link
                      to={`/edit/${b.txId}`}
                      state={{ background: location }}
                      className="flex min-h-[56px] items-center gap-3 py-2 outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
                    >
                      <Glyph value={cat?.icon ?? '➖'} color={cat?.color ?? undefined} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{b.note !== '' ? b.note : (cat?.name ?? 'Без категории')}</span>
                        <span className="block truncate text-sm text-muted">{formatDayLabel(b.occurredOn, today)}</span>
                      </span>
                      <MoneyText minor={b.amountMinor} currency={base} tone="expense" className="shrink-0 font-semibold" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Block>
        )}
        <Block id="trip-ops" title={`Операции (${ops.length})`}>
          <ul className="flex flex-col divide-y divide-border">
            {ops.map((t) => (
              <OperationRow key={t.id} t={t} categories={categories} base={base} today={today} currencyOf={currencyOf} />
            ))}
          </ul>
        </Block>
      </div>
    </>
  );
}

function StartForm({ trips, onStart }: { trips: readonly TripInfo[]; onStart: (tag: string) => void }) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const tag = tagFromName(name);
  const error = touched && name.trim() !== '' && tag === null ? `Название — от ${TAG_MIN} до ${TAG_MAX} букв или цифр` : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (tag === null) return;
    // та же поездка, записанная иначе (#самарканд и #Самарканд), остаётся одной: берём уже принятое написание
    const known = trips.find((t) => t.key === tagKey(tag));
    onStart(known?.tag ?? tag);
    setName('');
    setTouched(false);
  };
  return (
    <Card aria-labelledby="trip-start-title" className="!py-4 md:!p-5">
      <h2 id="trip-start-title" className="mb-2 text-base font-semibold">
        Начать поездку
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <TextInput
          label="Название поездки"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Например, Самарканд"
          maxLength={80}
          autoComplete="off"
          error={error}
          hint={tag ? `Новые операции получат метку #${tag}` : 'Пока поездка идёт, новые операции получают её метку в заметке'}
        />
        <Button type="submit" icon="plane" disabled={name.trim() === ''}>
          Начать
        </Button>
      </form>
    </Card>
  );
}

/**
 * «Поездки»: отчёт «сколько мы потратили на поездку» по меткам в заметках операций (trips.ts). «Начать поездку» включает режим этого
 * устройства: пока он включён, форма «Новая операция» дописывает метку в заметку сама. Поездка открывается по `?trip=метка`.
 */
export default function TripsPage() {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const data = useTrips();
  const categories = useCategoryIndex();
  const active = useActiveTrip(store.userId);
  const [params, setParams] = useSearchParams();
  const key = params.get('trip');
  const report = useTripReport(data, key);

  const open = (k: string | null) => setParams(k === null ? {} : { trip: k });
  const start = (tag: string) => {
    active.start(tag);
    toast.success(`Поездка «${tag.replace(/_/g, ' ')}» идёт: новые операции получат метку #${tag}`);
  };
  const end = () => {
    active.end();
    toast.show('Поездка завершена: новые операции без метки');
  };

  if (data === undefined || categories === undefined) {
    return (
      <>
        <PageHeader title="Поездки" />
        <Loading />
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <PageHeader title="Поездки" />
        <EmptyState icon="plane" title="Сначала настройте приложение" text="Выберите основную валюту, и здесь появятся поездки." />
      </>
    );
  }

  if (report) {
    return (
      <TripDetail
        report={report}
        txs={data.txs}
        categories={categories}
        base={data.base}
        today={today}
        currencyOf={data.currencyOf}
        active={active.tag !== null && tagKey(active.tag) === report.key}
        onStart={() => start(report.tag)}
        onEnd={end}
        onBack={() => open(null)}
      />
    );
  }

  const current = active.tag === null ? null : (data.trips.find((t) => t.key === tagKey(active.tag!)) ?? null);
  return (
    <>
      <PageHeader title="Поездки" subtitle="Сколько ушло на поездку: по меткам в заметках операций" />
      <div className="flex flex-col gap-4">
        {active.tag !== null ? (
          <Card aria-labelledby="trip-active-title" className="!py-4 md:!p-5" data-testid="trip-active">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Icon name="plane" size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="trip-active-title" className="text-base font-semibold">
                  Идёт поездка: {active.tag.replace(/_/g, ' ')}
                </h2>
                <p className="text-sm text-muted">Новые операции на этом устройстве получают метку #{active.tag}.</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {current && (
                <Button variant="secondary" onClick={() => open(current.key)}>
                  Отчёт
                </Button>
              )}
              <Button variant="secondary" onClick={end}>
                Завершить
              </Button>
            </div>
          </Card>
        ) : (
          <StartForm trips={data.trips} onStart={start} />
        )}
        {data.trips.length === 0 ? (
          <EmptyState icon="plane" title="Поездок пока нет" text="Начните поездку, и все новые операции получат её метку. Или допишите #метку в заметку любой операции." />
        ) : (
          <Card padding="none" aria-labelledby="trip-list-title" className="px-4 py-2">
            <h2 id="trip-list-title" className="sr-only">
              Прошлые поездки
            </h2>
            <ul className="flex flex-col divide-y divide-border">
              {data.trips.map((t) => (
                <li key={t.key} data-testid="trip-row">
                  <ListRow
                    leading={<Icon name="plane" size={22} className="text-brand" />}
                    title={t.label}
                    subtitle={`${periodText(t.firstOn, t.lastOn, today)} · ${opsCount(t.count)}`}
                    trailing={<MoneyText minor={t.expenseMinor} currency={data.base} tone="none" className="font-semibold" />}
                    chevron
                    onClick={() => open(t.key)}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
