import { useState } from 'react';
import type { ChipOption } from '@/components/ChipPicker';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import type { CategoryKind } from '@/domain/types';
import { cn } from '@/lib/cn';
import { FrequentStrip, type FrequentChoice } from './FrequentPanel';
import { NewCategoryForm } from './NewCategoryForm';

export interface CategoryGridProps {
  /** Уже упорядочены: самые частые первыми. */
  options: readonly ChipOption[];
  value: string | null;
  /** Выбрали категорию (панель после этого закрывает родитель). */
  onPick: (id: string) => void;
  /** «Без категории»: осознанный выбор, а не пропуск. */
  onSkip: () => void;
  /** Вид операции: новая категория создаётся для него. */
  kind: CategoryKind;
  /** Подсказка над сеткой (например, напоминание при «Сохранить» без категории). */
  hint?: string | null;
  /** Частые операции этого вида: полоса чипов над сеткой. Пусто или нет — полосы нет. */
  frequent?: readonly FrequentChoice[];
  onPickFrequent?: (key: string) => void;
}

const cellClass = (selected: boolean) =>
  cn(
    'flex min-h-[76px] min-w-0 flex-col items-center justify-start gap-1 rounded-2xl border px-0.5 py-2 text-center transition duration-200 ease-spring active:scale-95',
    selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
  );

/**
 * Категории сеткой (3 в ряд на узком телефоне, 4 — от 420 px): значок крупно, название под ним, чтобы слова не рвались. Видно сразу много, выбор — одно касание. «Новая» создаёт категорию
 * прямо здесь, «Без категории» — кнопка над сеткой (не прячется при прокрутке длинного списка).
 */
export function CategoryGrid({ options, value, onPick, onSkip, kind, hint, frequent = [], onPickFrequent }: CategoryGridProps) {
  const [adding, setAdding] = useState(false);
  const hasFrequent = frequent.length > 0 && onPickFrequent !== undefined;

  return (
    <div className="flex flex-col gap-2">
      {hasFrequent && <FrequentStrip items={frequent} onPick={onPickFrequent} />}
      {/* «Без категории» — наверху, а не под сеткой: при длинном списке до неё не пришлось бы листать */}
      <div className="flex items-center justify-between gap-2 px-1">
        {hint ? (
          <p role="alert" className="min-w-0 text-sm font-medium text-danger">
            {hint}
          </p>
        ) : (
          <p className="min-w-0 text-sm font-semibold text-muted">Выберите категорию</p>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-border bg-surface px-3.5 text-sm font-semibold text-muted hover:bg-surface-2"
        >
          Без категории
        </button>
      </div>
      <div
        role="group"
        aria-label="Категория"
        className={cn(
          'grid grid-cols-3 gap-1.5 min-[420px]:grid-cols-4 overflow-y-auto overscroll-contain p-0.5 [scrollbar-width:thin]',
          // полоса «Частые» занимает место сверху: сетке остаётся чуть меньше, чтобы панель не вылезала за экран
          hasFrequent ? 'max-h-[min(30vh,240px)]' : 'max-h-[min(40vh,300px)]',
        )}
      >
        <button
          type="button"
          aria-label="Новая категория"
          title="Новая категория"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className={cn(cellClass(false), 'border-dashed text-brand')}
        >
          <Icon name="plus" size={32} />
          <span className="text-caption font-medium leading-tight">Новая</span>
        </button>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button key={opt.value} type="button" aria-pressed={selected} onClick={() => onPick(opt.value)} className={cellClass(selected)}>
              {opt.icon ? <Glyph value={opt.icon} color={opt.color} size={32} /> : <span className="h-8 w-8" aria-hidden="true" />}
              <span lang="ru" className="line-clamp-2 w-full break-words text-caption font-medium leading-tight [hyphens:auto]">
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
      {adding && <NewCategoryForm options={options} kind={kind} onPick={onPick} onClose={() => setAdding(false)} />}
      {options.length === 0 && !adding && <p className="px-1 text-sm text-muted">Категорий пока нет — создайте первую или сохраните без категории.</p>}
    </div>
  );
}
