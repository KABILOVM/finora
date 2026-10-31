import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { FilterBar } from '@/components/filters/FilterBar';
import { countFilters, emptyFilters, pruneFilters, type FilterValues } from '@/components/filters/filterState';
import { Icon } from '@/components/Icon';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { useToast } from '@/components/Toast';
import { DEBT_OVERFLOW_MESSAGE, useStore } from '@/db';
import type { DebtDirection } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { applyDebtFilters, debtFilterFields } from './debtFilters';
import { defaultDirection, groupDebts, overdueCount, remainingByCurrency, type DebtItem } from './debtSummary';
import { DIRECTION_LABEL } from './debtText';
import { DebtList, Fold, SettledSection } from './DebtLists';
import { DebtSheet } from './DebtSheet';
import { SplitBillSheet } from './SplitBillSheet';
import { PeopleList } from './PeopleList';
import { groupByPerson, peopleWithOpenDebts } from './people';
import { useDebtsData } from './useDebtsData';

type View = DebtDirection | 'people';

const OPTIONS = [
  { value: 'lent', label: DIRECTION_LABEL.lent, tone: 'brand' },
  { value: 'borrowed', label: DIRECTION_LABEL.borrowed, tone: 'brand' },
  { value: 'people', label: 'Люди', tone: 'brand' },
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

/**
 * Пометка под итогом, когда включены фильтры: цифры считаны только по подошедшим долгам. Объединённый долг показывается и
 * считается целиком, даже если под фильтры подошла лишь часть его долгов, — об этом тоже сказано, чтобы цифры не расходились с подписью.
 */
function FilteredNote({ partialGroups, className }: { partialGroups: number; className?: string }) {
  return (
    <p data-testid="debts-filtered-note" className={className ?? 'mt-2 text-sm text-muted'}>
      С учётом фильтров.
      {partialGroups > 0 &&
        ` Объединённые долги, где подошла только часть, считаются целиком: ${partialGroups}.`}
    </p>
  );
}

function Totals({
  items,
  direction,
  base,
  today,
  filtered,
  partialGroups,
}: {
  items: readonly DebtItem[];
  direction: DebtDirection;
  base: string | null;
  today: string;
  filtered: boolean;
  partialGroups: number;
}) {
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
      {filtered && <FilteredNote partialGroups={partialGroups} />}
    </Card>
  );
}

/** Фильтры включены, а подходящих долгов нет: говорим об этом словами и даём сбросить, а не рисуем пустой экран «долгов нет». */
function NoMatches({ onReset }: { onReset: () => void }) {
  return (
    <EmptyState
      icon="banknote"
      title="По этим фильтрам долгов нет"
      text="Измените фильтры или сбросьте их, чтобы увидеть все долги."
      action={
        <Button size="lg" variant="secondary" onClick={onReset}>
          Сбросить фильтры
        </Button>
      }
    />
  );
}

/**
 * Долги: переключатель «Мне должны» / «Я должен», итог по каждой валюте отдельно, строки с остатком, полосой и сроком
 * словами, свёрнутые «Закрытые» и «Архив». Остаток каждого долга считается из операций (нигде не хранится).
 */
export default function DebtsPage() {
  const store = useStore();
  const toast = useToast();
  const data = useDebtsData();
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir');
  const [sheet, setSheet] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rawFilters, setFilters] = useState<FilterValues>({});
  const today = useToday();
  // Адрес называет вкладку — берём её. Не называет («Ещё → Долги») — ту, где есть открытые долги: у кого только «Я должен», не видит пустоту.
  const view: View =
    dir === 'lent' || dir === 'borrowed' || dir === 'people' ? dir : defaultDirection(data?.items ?? [], today);
  // вкладка «Люди» не про одно направление: новый долг по умолчанию — «Я дал в долг»
  const direction: DebtDirection = view === 'borrowed' ? 'borrowed' : 'lent';

  // вкладку пишем в адрес всегда, и «Мне должны» тоже: иначе пустая вкладка «Мне должны» тут же переключалась бы сама
  const setView = (v: View) => setParams({ dir: v }, { replace: true });
  // Фильтры живут в состоянии страницы. Поля собираются из долгов; выбранное, чего в списке уже нет (категорию стёрли, человека
  // закрыли), считается «любым». Фильтр действует ДО группировки и итогов: «Вам должны всего» считается по подошедшим долгам.
  const fields = useMemo(() => debtFilterFields(data?.items ?? [], data?.base), [data]);
  const filters = useMemo(() => pruneFilters(fields, rawFilters), [fields, rawFilters]);
  const filterCount = countFilters(fields, filters);
  const filtered = useMemo(() => applyDebtFilters(data?.items ?? [], filters, today), [data, filters, today]);
  const groups = useMemo(() => groupDebts(filtered.items, direction), [filtered, direction]);
  const people = useMemo(() => peopleWithOpenDebts(groupByPerson(filtered.items, data?.base ?? undefined)), [filtered, data]);
  const resetFilters = () => setFilters(emptyFilters(fields));

  const restore = async (it: DebtItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.debts.restore(it.debt.id, { withParts: true });
      toast.success(`Долг «${it.debt.counterparty}» возвращён из архива`);
    } catch (e) {
      console.error('Не удалось вернуть долг из архива:', e);
      toast.error(humanError(e, 'Не удалось вернуть долг из архива'));
    } finally {
      setBusy(false);
    }
  };

  const closeSettled = async () => {
    if (busy || groups.settled.length === 0) return;
    const ids = groups.settled.map((it) => it.debt.id);
    setBusy(true);
    const done: string[] = [];
    try {
      // один сбой не должен оставлять остальные незакрытыми: идём до конца и говорим, сколько получилось
      for (const id of ids) {
        try {
          await store.debts.close(id, { withParts: true });
          done.push(id);
        } catch (e) {
          console.error('Не удалось закрыть погашенный долг:', e);
        }
      }
      if (done.length === 0) {
        toast.error('Не удалось закрыть погашенные долги. Ничего не изменилось — попробуйте ещё раз.');
        return;
      }
      const partial = done.length < ids.length;
      toastWithUndo(
        toast,
        partial ? `Закрыто долгов: ${done.length} из ${ids.length}. Остальные закрыть не удалось.` : `Закрыто долгов: ${done.length}`,
        async () => {
          let failed = 0;
          for (const id of done) {
            try {
              await store.debts.reopen(id, { withParts: true });
            } catch (e) {
              failed++;
              console.error('Не удалось открыть долг снова:', e);
            }
          }
          if (failed > 0) throw new Error(`Не открыто снова: ${failed} из ${done.length}`);
        },
        'Долги открыты снова',
      );
    } finally {
      setBusy(false);
    }
  };

  const base = data?.base ?? null;
  const header = (
    <PageHeader
      title="Долги"
      actions={
        // на телефоне — только «+»: заголовок рядом с кнопкой тесен; имя кнопки для скринридера остаётся
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

  const noOpen = groups.active.length === 0 && groups.settled.length === 0;
  const empty = noOpen && groups.closed.length === 0;
  return (
    <>
      {header}
      <Segmented ariaLabel="Чьи долги" options={OPTIONS} value={view} onChange={setView} compact className="mb-2" />
      {data.items.length > 0 && <FilterBar fields={fields} values={filters} onChange={setFilters} title="Фильтры долгов" className="mb-2" />}
      <Button variant="ghost" icon="transfer" disabled={base === null} onClick={() => setSplitting(true)} className="mb-3">
        Разделить счёт
      </Button>
      {view === 'people' ? (
        people.length === 0 ? (
          filterCount > 0 ? (
            <NoMatches onReset={resetFilters} />
          ) : (
            <EmptyState icon="banknote" title="Открытых долгов нет" text="Здесь появятся люди, с которыми у вас есть долги: сколько они должны вам и сколько вы им." />
          )
        ) : (
          <>
            {filterCount > 0 && <FilteredNote partialGroups={filtered.partialGroups} className="mb-2 px-1 text-sm text-muted" />}
            <PeopleList people={people} today={today} />
          </>
        )
      ) : (
        <>
          <Totals items={groups.active} direction={direction} base={base} today={today} filtered={filterCount > 0} partialGroups={filtered.partialGroups} />

          {empty && filterCount > 0 ? (
            <NoMatches onReset={resetFilters} />
          ) : empty ? (
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
            groups.active.length > 0 && <DebtList items={groups.active} today={today} label={DIRECTION_LABEL[direction]} />
          )}
          {groups.settled.length > 0 && <SettledSection items={groups.settled} today={today} busy={busy} onCloseAll={() => void closeSettled()} />}
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
        </>
      )}

      {splitting && base !== null && <SplitBillSheet base={base} onClose={() => setSplitting(false)} />}

      {sheet && base !== null && (
        <DebtSheet
          debt={null}
          existing={data.items}
          defaultDirection={direction}
          base={base}
          onClose={() => setSheet(false)}
          onCreated={(d) => runWithoutModalAnchor(() => setView(d.direction))}
        />
      )}
    </>
  );
}
