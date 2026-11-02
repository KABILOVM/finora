import { useEffect, useRef, useState } from 'react';
import { inputClasses, TextInput } from '@/components/Field';
import { FiltersButton } from '@/components/filters/FilterBar';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { Icon } from '@/components/Icon';
import type { Category, IsoDate, LocalRow, Wallet } from '@/domain/types';
import { monthKey } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { FiltersSheet } from './FiltersSheet';
import { useKnownTags } from './knownTags';
import { MonthSwitcher } from './MonthSwitcher';
import {
  activeFilterCount,
  activeFilterLabels,
  EMPTY_SHEET_FILTERS,
  MAX_DATE,
  MIN_DATE,
  type ListFilters,
  type PeriodKind,
  type SheetFilters,
  withPeriod,
  withRangeDate,
} from './txFilters';

const PERIODS = [
  { value: 'this', label: 'Этот месяц' },
  { value: 'prev', label: 'Прошлый' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Другой месяц' },
  { value: 'range', label: 'Свои даты' },
] as const;

/**
 * Чипы периода: одна строка, листается пальцем; выбранный чип сам прокручивается в видимую часть.
 * Отступ p-1 (с компенсацией -m-1) оставляет место для рамки фокуса: прокручиваемый блок иначе её обрезал бы.
 */
function PeriodChips({ value, onChange }: { value: PeriodKind; onChange: (v: PeriodKind) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Пока справа есть непоказанные чипы, правый край растворяется: видно, что строку можно листать.
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = ref.current;
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  };
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    measure();
  }, [value]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const fade = more ? 'linear-gradient(to right, #000 calc(100% - 24px), transparent)' : undefined;
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Период"
      onScroll={measure}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
      className="scroll-x-quiet -m-1 flex min-w-0 flex-1 gap-2 p-1"
    >
      {PERIODS.map((p) => {
        const selected = p.value === value;
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(p.value)}
            className={cn(
              'inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[15px] font-medium transition-colors',
              selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TransactionFiltersProps {
  filters: ListFilters;
  onChange: (patch: Partial<ListFilters>) => void;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly LocalRow<Category>[];
  /** Сегодня: дальше текущего месяца листать вперёд не нужно, а «Свои даты» впервые открываются «с начала месяца по сегодня». */
  today: IsoDate;
}

/**
 * Панель над списком, максимально плотная: в первой строке чипы периода и кнопка «Фильтры» (с числом включённых),
 * при «Другой месяц» ниже переключатель месяца, при «Свои даты» — поля «С» и «По»; затем поиск (заметка, категория, кошелёк, сумма). Кошелёк, вид и категория спрятаны в шит «Фильтры»; что из них включено, видно в строке под поиском.
 */
export function TransactionFilters({ filters, onChange, wallets, categories, today }: TransactionFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const inSheet: SheetFilters = {
    walletId: filters.walletId,
    kind: filters.kind,
    categoryId: filters.categoryId,
    amountFrom: filters.amountFrom,
    amountTo: filters.amountTo,
    source: filters.source,
    tag: filters.tag,
  };
  const tags = useKnownTags() ?? [];
  const count = activeFilterCount(inSheet);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PeriodChips value={filters.period} onChange={(period) => onChange(withPeriod(filters, period, today))} />
        <FiltersButton count={count} onClick={() => setSheetOpen(true)} />
      </div>

      {filters.period === 'month' && (
        <MonthSwitcher month={filters.month} max={monthKey(today)} onChange={(month) => onChange({ month })} />
      )}

      {filters.period === 'range' && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Свои даты">
          <TextInput
            label="С"
            type="date"
            value={filters.from}
            min={MIN_DATE}
            max={MAX_DATE}
            onChange={(e) => {
              const patch = withRangeDate(filters, 'from', e.target.value);
              if (patch) onChange(patch);
            }}
            wrapperClassName="min-w-0"
          />
          <TextInput
            label="По"
            type="date"
            value={filters.to}
            min={MIN_DATE}
            max={MAX_DATE}
            onChange={(e) => {
              const patch = withRangeDate(filters, 'to', e.target.value);
              if (patch) onChange(patch);
            }}
            wrapperClassName="min-w-0"
          />
        </div>
      )}

      <div className="relative">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          aria-label="Поиск по операциям"
          placeholder="Заметка, категория, сумма"
          value={filters.search}
          autoComplete="off"
          onChange={(e) => onChange({ search: e.target.value })}
          className={cn(inputClasses(false), 'min-h-[44px] py-2 pl-10')}
        />
      </div>

      {count > 0 && (
        <div className="flex items-center gap-2 pl-1" data-testid="active-filters">
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            <span className="sr-only">Включены фильтры: </span>
            {activeFilterLabels(inSheet, wallets, categories, tags).join(' · ')}
          </p>
          <button
            type="button"
            onClick={() => onChange(EMPTY_SHEET_FILTERS)}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-brand"
          >
            Сбросить
          </button>
        </div>
      )}

      {sheetOpen && (
        <FiltersSheet
          initial={inSheet}
          wallets={wallets}
          categories={categories}
          tags={tags}
          onApply={(next) => {
            setSheetOpen(false);
            // фильтры лежат в адресе: правим его, когда запись окна в истории уже снята (иначе replace затёр бы её)
            runWithoutModalAnchor(() => onChange(next));
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
