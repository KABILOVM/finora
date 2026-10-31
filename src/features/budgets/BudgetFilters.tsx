import { FilterBar } from '@/components/filters/FilterBar';
import type { FilterField, FilterValues } from '@/components/filters/filterState';

export interface BudgetFiltersProps {
  fields: readonly FilterField[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
}

/** Панель фильтров над списком лимитов: кнопка «Фильтры» и что включено. Полей нет (лимитов меньше двух) — панели нет. */
export function BudgetFilters({ fields, values, onChange }: BudgetFiltersProps) {
  if (fields.length === 0) return null;
  return <FilterBar title="Фильтры лимитов" fields={fields} values={values} onChange={onChange} className="mb-2" />;
}
