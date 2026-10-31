import { useState } from 'react';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { Field, inputClasses } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { cn } from '@/lib/cn';
import { countFilters, emptyFilters, filterLabels, pruneFilters, valueOf, type FilterField, type FilterValues } from './filterState';

/** Значок «фильтры» (ползунки): в общем наборе иконок такого нет. */
export function FiltersIcon() {
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

export interface FiltersButtonProps {
  /** Сколько фильтров включено; число показывает значок рядом с названием. */
  count: number;
  onClick: () => void;
  className?: string;
}

/** Кнопка «Фильтры» с числом включённых: тот же вид, что над списком операций. */
export function FiltersButton({ count, onClick, className }: FiltersButtonProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={count > 0 ? `Фильтры, включено: ${count}` : 'Фильтры'}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors',
        count > 0 ? 'border-brand bg-brand/10 text-brand' : 'border-border-strong bg-surface text-text hover:bg-surface-2',
        className,
      )}
    >
      <FiltersIcon />
      <span aria-hidden="true">Фильтры</span>
      {count > 0 && (
        <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-xs font-bold text-brand-fg">
          {count}
        </span>
      )}
    </button>
  );
}

export interface ActiveFiltersProps {
  labels: readonly string[];
  onReset: () => void;
  className?: string;
}

/** Строка «что включено» под кнопкой: «Еда · Просрочено» и «Сбросить». Пока ничего не включено — не рисуется. */
export function ActiveFilters({ labels, onReset, className }: ActiveFiltersProps) {
  if (labels.length === 0) return null;
  return (
    <div className={cn('flex items-center gap-2 pl-1', className)} data-testid="active-filters">
      <p className="min-w-0 flex-1 truncate text-sm text-muted">
        <span className="sr-only">Включены фильтры: </span>
        {labels.join(' · ')}
      </p>
      <button type="button" onClick={onReset} className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-brand">
        Сбросить
      </button>
    </div>
  );
}

export interface FiltersSheetProps {
  title?: string;
  fields: readonly FilterField[];
  /** Что включено сейчас: шит начинает с этого. */
  initial: FilterValues;
  /** «Применить»: выбранное попадает в список. Закрытие без «Применить» ничего не меняет. */
  onApply: (next: FilterValues) => void;
  onClose: () => void;
}

/**
 * Шит «Фильтры» для любого списка. Выбор копится здесь и попадает в список только по «Применить»;
 * «Сбросить» очищает выбор в шите (список обновится после «Применить»).
 */
export function FiltersSheet({ title = 'Фильтры', fields, initial, onApply, onClose }: FiltersSheetProps) {
  const [draft, setDraft] = useState<FilterValues>(() => pruneFilters(fields, initial));
  const set = (key: string, value: string) => setDraft((cur) => ({ ...cur, [key]: value }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          {/* Пока сбрасывать нечего, кнопка неактивна, но читается (контраст не падает от «затемнения» disabled). */}
          <Button
            variant="secondary"
            size="lg"
            className="disabled:!opacity-100 disabled:!text-muted"
            disabled={countFilters(fields, draft) === 0}
            onClick={() => setDraft(emptyFilters(fields))}
          >
            Сбросить
          </Button>
          <Button size="lg" onClick={() => onApply(draft)}>
            Применить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {fields.map((f) => {
          const id = `filter-${f.key}`;
          const value = valueOf(draft, f.key);
          if (f.type === 'select') {
            return (
              <Field key={f.key} id={id} label={f.label} hint={f.hint}>
                <select id={id} value={value} onChange={(e) => set(f.key, e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
                  <option value="">{f.anyLabel}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }
          return (
            <div key={f.key} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-text">{f.label}</span>
                {f.hint && <span className="text-sm text-muted">{f.hint}</span>}
              </div>
              <ChipPicker ariaLabel={f.label} value={value} onChange={(v) => set(f.key, v)} options={[{ value: '', label: f.anyLabel }, ...f.options]} />
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export interface FilterBarProps {
  fields: readonly FilterField[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  /** Заголовок шита; по умолчанию «Фильтры». */
  title?: string;
  className?: string;
}

/**
 * Готовая панель фильтров для списка: кнопка «Фильтры» (с числом включённых), под ней — что включено со ссылкой «Сбросить».
 * Шит открывается по нажатию. Включённых полей нет — под кнопкой пусто.
 */
export function FilterBar({ fields, values, onChange, title, className }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const count = countFilters(fields, values);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-2">
        <FiltersButton count={count} onClick={() => setOpen(true)} />
      </div>
      <ActiveFilters labels={filterLabels(fields, values)} onReset={() => onChange(emptyFilters(fields))} />
      {open && (
        <FiltersSheet
          title={title}
          fields={fields}
          initial={values}
          onApply={(next) => {
            setOpen(false);
            onChange(next);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
