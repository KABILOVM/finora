import { useMemo, useState } from 'react';
import { isCoarsePointer } from '@/components/AmountInput';
import type { ChipOption } from '@/components/ChipPicker';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { SearchField } from '@/components/SearchField';
import type { CategoryKind } from '@/domain/types';
import { searchOptions } from '@/features/categories/categoryTree';
import { cn } from '@/lib/cn';
import { isSearching, showsSearch } from '@/lib/search';
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
  /** «Сохранить как шаблон» в строке частых (только «Новая операция», когда набрана сумма). */
  onSaveTemplate?: () => void;
}

const cellClass = (selected: boolean) =>
  cn(
    'flex min-h-[76px] min-w-0 flex-col items-center justify-start gap-1 rounded-2xl border px-0.5 py-2 text-center transition duration-200 ease-spring active:scale-95',
    selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
  );

/**
 * Категории сеткой (3 в ряд на узком телефоне, 4 — от 420 px): значок крупно, название под ним, чтобы слова не рвались. Видно сразу много, выбор — одно касание. «Новая» создаёт категорию
 * прямо здесь, «Без категории» — кнопка над сеткой (не прячется при прокрутке длинного списка).
 * Когда категорий много, над сеткой — поиск: лучшие совпадения первыми, Enter выбирает первое найденное, а не найденное можно тут же создать
 * («Новая» подставит набранное название). На ПК курсор в поле сразу; на телефоне — нет, чтобы экранная клавиатура не закрыла сетку.
 */
export function CategoryGrid({ options, value, onPick, onSkip, kind, hint, frequent = [], onPickFrequent, onSaveTemplate }: CategoryGridProps) {
  const [adding, setAdding] = useState(false);
  // название для «Новой»: то, что искали и не нашли
  const [seed, setSeed] = useState('');
  const [query, setQuery] = useState('');
  const [focusSearch] = useState(() => !isCoarsePointer());
  const searching = isSearching(query);
  const found = useMemo(() => searchOptions(options, query), [options, query]);
  const withSearch = showsSearch(options.length, query);
  const hasFrequent = frequent.length > 0 && onPickFrequent !== undefined;
  // при поиске полоса частых мешает: ищут конкретную категорию
  const hasStrip = !searching && (hasFrequent || onSaveTemplate !== undefined);

  return (
    <div className="flex flex-col gap-2">
      {hasStrip && <FrequentStrip items={hasFrequent ? frequent : []} onPick={onPickFrequent ?? (() => undefined)} {...(onSaveTemplate ? { onSaveTemplate } : {})} />}
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
      {withSearch && (
        <SearchField
          value={query}
          onChange={setQuery}
          label="Поиск категории"
          placeholder="Найти категорию"
          autoFocus={focusSearch}
          onKeyDown={(e) => {
            // Enter в поиске выбирает лучшее совпадение (при пустом запросе — ничего) и не отправляет форму
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const first = searching ? found[0] : undefined;
            if (first) onPick(first.value);
          }}
        />
      )}
      {searching && (
        <p role="status" className={found.length === 0 ? 'px-1 text-sm text-muted' : 'sr-only'}>
          {found.length === 0 ? 'Такой категории нет. Нажмите «Новая», чтобы добавить её.' : `Найдено: ${found.length}`}
        </p>
      )}
      <div
        role="group"
        aria-label="Категория"
        className={cn(
          'grid grid-cols-3 gap-1.5 min-[420px]:grid-cols-4 overflow-y-auto overscroll-contain p-0.5 [scrollbar-width:thin]',
          // полоса «Частые» и поле поиска занимают место сверху: сетке остаётся чуть меньше, чтобы панель не вылезала за экран
          hasStrip ? (withSearch ? 'max-h-[min(24vh,192px)]' : 'max-h-[min(30vh,240px)]') : withSearch ? 'max-h-[min(32vh,252px)]' : 'max-h-[min(40vh,300px)]',
        )}
      >
        <button
          type="button"
          aria-label="Новая категория"
          title="Новая категория"
          aria-expanded={adding}
          onClick={() => {
            setSeed(searching ? query.trim() : '');
            setAdding((a) => !a);
          }}
          className={cn(cellClass(false), 'border-dashed text-brand')}
        >
          <Icon name="plus" size={32} />
          <span className="text-caption font-medium leading-tight">Новая</span>
        </button>
        {found.map((opt) => {
          const selected = opt.value === value;
          return (
            <button key={opt.value} type="button" aria-pressed={selected} onClick={() => onPick(opt.value)} className={cellClass(selected)}>
              {opt.icon ? <Glyph value={opt.icon} color={opt.color} size={32} /> : <span className="h-8 w-8" aria-hidden="true" />}
              {opt.sub && <span className="-mb-0.5 line-clamp-1 w-full break-words text-[10px] leading-tight text-muted">{opt.sub}</span>}
              <span lang="ru" className="line-clamp-2 w-full break-words text-caption font-medium leading-tight [hyphens:auto]">
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
      {adding && <NewCategoryForm options={options} kind={kind} initialName={seed} onPick={onPick} onClose={() => setAdding(false)} />}
      {options.length === 0 && !adding && <p className="px-1 text-sm text-muted">Категорий пока нет — создайте первую или сохраните без категории.</p>}
    </div>
  );
}
