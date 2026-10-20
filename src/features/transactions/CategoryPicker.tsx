import { useMemo, useState } from 'react';
import { type ChipOption } from '@/components/ChipPicker';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import type { CategoryKind } from '@/domain/types';
import { cn } from '@/lib/cn';
import { FieldGroup } from './FieldGroup';
import { NewCategoryForm } from './NewCategoryForm';

/** Сколько категорий видно сразу (самые частые); остальные — под «Ещё». */
export const MAIN_COUNT = 6;

export interface CategoryPickerProps {
  /** Уже упорядочены: самые частые первыми. */
  options: readonly ChipOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string | null;
  /** Вид операции: новая категория создаётся для него. */
  kind: CategoryKind;
  /** Все категории сразу, с переносом строк (во всплывающем списке); без «Ещё». */
  expanded?: boolean;
}

const chipClass = (selected: boolean) =>
  cn(
    'inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-base font-medium transition duration-200 ease-spring active:scale-95',
    selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
  );

/**
 * Выбор категории чипами. Сразу видны основные (самые частые); «Ещё» раскрывает остальные, а «Новая» создаёт категорию
 * прямо здесь: достаточно написать название, значок и цвет подберутся сами. Касание выбранной категории снимает выбор.
 */
export function CategoryPicker({ options, value, onChange, error, kind, expanded: alwaysExpanded = false }: CategoryPickerProps) {
  const [expandedState, setExpanded] = useState(false);
  const expanded = alwaysExpanded || expandedState;
  const [adding, setAdding] = useState(false);

  const collapsible = options.length > MAIN_COUNT + 1;
  const shown = useMemo(() => {
    if (!collapsible || expanded) return options;
    const main = options.slice(0, MAIN_COUNT);
    const picked = value !== null && !main.some((o) => o.value === value) ? options.find((o) => o.value === value) : undefined;
    return picked ? [...main, picked] : main;
  }, [options, value, collapsible, expanded]);
  const hidden = options.length - shown.length;

  const chips = (
    <div
      role="group"
      aria-label="Категория"
      // Свёрнуто — одна строка с прокруткой вбок (всё окно без прокрутки вниз); раскрыто — строки с переносом
      className={cn(
        'flex gap-2',
        expanded || adding ? 'flex-wrap' : '-mx-5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:-mx-0 md:px-0',
      )}
    >
      {!adding && (
        <button
          type="button"
          aria-label="Новая категория"
          title="Новая категория"
          onClick={() => setAdding(true)}
          className={cn(chipClass(false), 'border-dashed px-3 text-brand')}
        >
          <Icon name="plus" size={20} />
          <span className="sr-only">Новая</span>
        </button>
      )}
      {shown.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : opt.value)}
            className={chipClass(selected)}
          >
            {opt.icon && <Glyph value={opt.icon} color={opt.color} size={26} />}
            <span className="whitespace-nowrap">{opt.label}</span>
          </button>
        );
      })}
      {collapsible && !expanded && (
        <button type="button" aria-expanded="false" onClick={() => setExpanded(true)} className={chipClass(false)}>
          <span>Ещё {hidden}</span>
          <Icon name="chevron" size={16} className="rotate-90 text-muted" />
        </button>
      )}
    </div>
  );

  return (
    <FieldGroup label="Категория" error={error} className="[&>div:first-child]:sr-only">
      {chips}
      {adding && (
        <NewCategoryForm
          options={options}
          kind={kind}
          onPick={onChange}
          onClose={(created) => {
            setAdding(false);
            if (created) setExpanded(true);
          }}
        />
      )}
      {options.length === 0 && !adding && (
        <p className="mt-2 text-sm text-muted">Категорий пока нет — операция сохранится и без категории.</p>
      )}
    </FieldGroup>
  );
}
