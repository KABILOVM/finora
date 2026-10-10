import { useEffect, useRef, useState } from 'react';
import { inputClasses } from '@/components/Field';
import { Icon } from '@/components/Icon';
import type { Category, LocalRow, Wallet } from '@/domain/types';
import { cn } from '@/lib/cn';
import { FiltersSheet } from './FiltersSheet';
import { MonthSwitcher } from './MonthSwitcher';
import {
  activeFilterCount,
  activeFilterLabels,
  EMPTY_SHEET_FILTERS,
  type ListFilters,
  type PeriodKind,
  type SheetFilters,
} from './txFilters';

const PERIODS = [
  { value: 'this', label: 'Этот месяц' },
  { value: 'prev', label: 'Прошлый' },
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Другой месяц' },
] as const;

/** Значок «фильтры» (ползунки): в общем наборе иконок такого нет. */
function FiltersIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

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
  /** Текущий месяц 'ГГГГ-ММ': дальше него листать вперёд не нужно. */
  currentMonth: string;
}

/**
 * Панель над списком, максимально плотная: в первой строке чипы периода и кнопка «Фильтры» (с числом включённых),
 * ниже — поиск по заметке. Кошелёк, вид и категория спрятаны в шит «Фильтры»; что из них включено, видно в строке под поиском.
 */
export function TransactionFilters({ filters, onChange, wallets, categories, currentMonth }: TransactionFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const inSheet: SheetFilters = { walletId: filters.walletId, kind: filters.kind, categoryId: filters.categoryId };
  const count = activeFilterCount(inSheet);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PeriodChips value={filters.period} onChange={(period) => onChange({ period })} />
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={count > 0 ? `Фильтры, включено: ${count}` : 'Фильтры'}
          onClick={() => setSheetOpen(true)}
          className={cn(
            'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors',
            count > 0 ? 'border-brand bg-brand/10 text-brand' : 'border-border-strong bg-surface text-text hover:bg-surface-2',
          )}
        >
          <FiltersIcon />
          <span aria-hidden="true">Фильтры</span>
          {count > 0 && (
            <span
              aria-hidden="true"
              className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-xs font-bold text-brand-fg"
            >
              {count}
            </span>
          )}
        </button>
      </div>

      {filters.period === 'month' && (
        <MonthSwitcher month={filters.month} max={currentMonth} onChange={(month) => onChange({ month })} />
      )}

      <div className="relative">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          aria-label="Поиск по заметке"
          placeholder="Поиск по заметке"
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
            {activeFilterLabels(inSheet, wallets, categories).join(' · ')}
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
          onApply={(next) => {
            onChange(next);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
