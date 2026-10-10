import type { ReactNode } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { inputClasses } from '@/components/Field';
import { Icon } from '@/components/Icon';
import type { Category, LocalRow, TxKind, Wallet } from '@/domain/types';
import { cn } from '@/lib/cn';
import { MonthSwitcher } from './MonthSwitcher';
import { NO_CATEGORY, type ListFilters, type PeriodKind } from './txFilters';

const PERIODS = [
  { value: 'this', label: 'Этот месяц' },
  { value: 'prev', label: 'Прошлый' },
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Другой месяц' },
] as const;

const KIND_OPTIONS: readonly { value: '' | TxKind; label: string }[] = [
  { value: '', label: 'Все виды' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
  { value: 'transfer', label: 'Переводы' },
];

function FilterSelect({
  label,
  value,
  onChange,
  disabled,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClasses(false), 'min-h-[44px] py-2', className)}
    >
      {children}
    </select>
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

/** Период, поиск по заметке, кошелёк, вид и категория. */
export function TransactionFilters({ filters, onChange, wallets, categories, currentMonth }: TransactionFiltersProps) {
  const { kind } = filters;
  const expense = categories.filter((c) => c.kind === 'expense');
  const income = categories.filter((c) => c.kind === 'income');
  const label = (c: LocalRow<Category>) => (c.archivedAt === null ? c.name : `${c.name} (в архиве)`);

  const onKind = (next: string) => {
    const k = next as '' | TxKind;
    const cat = categories.find((c) => c.id === filters.categoryId);
    // категория другого вида (или любая, если смотрим переводы) к новому виду не подходит — сбрасываем
    const drop = k === 'transfer' || (cat !== undefined && k !== '' && cat.kind !== k);
    onChange(drop ? { kind: k, categoryId: '' } : { kind: k });
  };

  return (
    <div className="mb-4 flex flex-col gap-3">
      <ChipPicker
        ariaLabel="Период"
        layout="scroll"
        options={PERIODS}
        value={filters.period}
        onChange={(v) => onChange({ period: v as PeriodKind })}
      />
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
          className={cn(inputClasses(false), 'min-h-[48px] pl-10')}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FilterSelect label="Кошелёк" value={filters.walletId} onChange={(walletId) => onChange({ walletId })}>
          <option value="">Все кошельки</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.archivedAt === null ? w.name : `${w.name} (в архиве)`}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Вид операции" value={kind} onChange={onKind}>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Категория"
          className="col-span-2"
          value={filters.categoryId}
          disabled={kind === 'transfer'}
          onChange={(categoryId) => onChange({ categoryId })}
        >
          <option value="">Все категории</option>
          <option value={NO_CATEGORY}>Без категории</option>
          {kind !== 'income' && expense.length > 0 && (
            <optgroup label="Расходы">
              {expense.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
          )}
          {kind !== 'expense' && income.length > 0 && (
            <optgroup label="Доходы">
              {income.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
          )}
        </FilterSelect>
      </div>
    </div>
  );
}
