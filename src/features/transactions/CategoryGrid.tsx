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
import { NewCategoryForm } from './NewCategoryForm';

export interface CategoryGridProps {
  /** Уже упорядочены: самые частые первыми, подкатегории сразу за родителем (у них `parent`). */
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
  /** Плитка «В шаблон» (только «Новая операция», когда набрана сумма). */
  onSaveTemplate?: () => void;
}

const cellClass = (selected: boolean) =>
  cn(
    'relative flex min-h-[76px] min-w-0 flex-col items-center justify-start gap-1 rounded-2xl border px-0.5 py-2 text-center transition duration-200 ease-spring active:scale-95',
    selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
  );

const pillClass = (selected = false) =>
  cn(
    'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors',
    selected ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-muted hover:bg-surface-2',
  );

/** Плитка категории: значок крупно, название под ним (слова не рвутся). */
function Cell({ opt, selected, caption, badge, onClick }: { opt: ChipOption; selected: boolean; caption?: string; badge?: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cellClass(selected)}>
      {opt.icon ? <Glyph value={opt.icon} color={opt.color} size={32} /> : <span className="h-8 w-8" aria-hidden="true" />}
      {caption && <span className="-mb-0.5 line-clamp-1 w-full break-words text-[10px] leading-tight text-muted">{caption}</span>}
      <span lang="ru" className="line-clamp-2 w-full break-words text-caption font-medium leading-tight [hyphens:auto]">
        {opt.label}
      </span>
      {badge !== undefined && (
        <>
          {/* «N ›»: у категории есть подкатегории, нажатие откроет их */}
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 inline-flex items-center text-[11px] font-semibold leading-none text-muted">
            {badge}
            <Icon name="chevron" size={12} />
          </span>
          <span className="sr-only">, подкатегорий: {badge}</span>
        </>
      )}
    </button>
  );
}

/**
 * Категории сеткой (3 в ряд на узком телефоне, 4 — от 420 px): значок крупно, название под ним, чтобы слова не рвались. Видно сразу много, выбор — одно касание.
 * В сетке только категории верхнего уровня; у той, где есть подкатегории, в углу «N ›»: нажатие открывает её подкатегории («‹ Продукты», «Без подкатегории» —
 * выбрать саму категорию). Когда категорий много (от 6), сверху поле поиска: он идёт по всем категориям сразу, подкатегории находятся прямо из него
 * (с мелкой подписью родителя), лучшие совпадения первыми, Enter выбирает первое. Не нашлось — «Новая» подставит набранное название. «Без категории» —
 * кнопка над сеткой (не прячется при прокрутке). На ПК курсор в поле сразу; на телефоне — нет, чтобы экранная клавиатура не закрыла сетку.
 */
export function CategoryGrid({ options, value, onPick, onSkip, kind, hint, onSaveTemplate }: CategoryGridProps) {
  // верхний уровень и подкатегории по родителям; родитель считается, только если он среди вариантов, иначе подкатегория показывается как обычная
  const { tops, kids } = useMemo(() => {
    const ids = new Set(options.map((o) => o.value));
    const top: ChipOption[] = [];
    const byParent = new Map<string, ChipOption[]>();
    for (const o of options) {
      if (o.parent !== undefined && ids.has(o.parent)) byParent.set(o.parent, [...(byParent.get(o.parent) ?? []), o]);
      else top.push(o);
    }
    return { tops: top, kids: byParent };
  }, [options]);

  const [adding, setAdding] = useState(false);
  // название для «Новой»: то, что искали и не нашли
  const [seed, setSeed] = useState('');
  const [query, setQuery] = useState('');
  // открытая категория (её подкатегории вместо верхнего уровня); если выбрана подкатегория — сразу её соседи
  const [openId, setOpenId] = useState<string | null>(() => options.find((o) => o.value === value)?.parent ?? null);
  const [focusSearch] = useState(() => !isCoarsePointer());

  const searching = isSearching(query);
  const found = useMemo(() => searchOptions(options, query), [options, query]);
  const withSearch = showsSearch(options.length, query);
  const open = openId === null ? undefined : tops.find((o) => o.value === openId);
  const openKids = open ? (kids.get(open.value) ?? []) : [];
  const drilled = !searching && open !== undefined && openKids.length > 0;
  const shown = searching ? found : drilled ? openKids : tops;
  // «Новая» в открытой категории заводит подкатегорию
  const addingFor = drilled ? open : undefined;

  const closeOpen = () => {
    setOpenId(null);
    setAdding(false);
  };
  const tap = (o: ChipOption) => {
    // верхний уровень: у категории с подкатегориями нажатие открывает их; в результатах поиска и у подкатегорий — выбор сразу
    if (!searching && !drilled && kids.has(o.value)) {
      setOpenId(o.value);
      setAdding(false);
      return;
    }
    onPick(o.value);
  };

  const newTile = (
    <button
      type="button"
      aria-label={addingFor ? 'Новая подкатегория' : 'Новая категория'}
      title={addingFor ? 'Новая подкатегория' : 'Новая категория'}
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
  );

  return (
    <div className="flex flex-col gap-2">
      {hint && (
        <p role="alert" className="px-1 text-sm font-medium text-danger">
          {hint}
        </p>
      )}
      <div className="flex items-center gap-2">
        {withSearch ? (
          <SearchField
            value={query}
            onChange={setQuery}
            label="Поиск категории"
            placeholder="Поиск"
            autoFocus={focusSearch}
            className="min-w-0 flex-1"
            onKeyDown={(e) => {
              // Enter в поиске выбирает лучшее совпадение (при пустом запросе — ничего) и не отправляет форму
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const first = searching ? found[0] : undefined;
              if (first) onPick(first.value);
            }}
          />
        ) : (
          <span className="flex-1" />
        )}
        <button type="button" onClick={onSkip} className={pillClass()}>
          Без категории
        </button>
      </div>
      {drilled && open && (
        <button
          type="button"
          aria-label="Назад к категориям"
          onClick={closeOpen}
          className="-ml-1 inline-flex min-h-[44px] min-w-0 items-center gap-1.5 self-start rounded-full pl-1 pr-3 text-base font-semibold text-text hover:bg-surface-2"
        >
          <Icon name="chevron" size={18} className="shrink-0 rotate-180 text-muted" />
          {open.icon && <Glyph value={open.icon} color={open.color} size={26} />}
          <span className="truncate">{open.label}</span>
        </button>
      )}
      {searching && (
        <p role="status" className={found.length === 0 ? 'px-1 text-sm text-muted' : 'sr-only'}>
          {found.length === 0 ? 'Такой категории нет. Создайте её кнопкой «Новая».' : `Найдено: ${found.length}`}
        </p>
      )}
      <div
        role="group"
        aria-label="Категория"
        // поле поиска и строка «‹ категория» занимают место сверху: сетке остаётся чуть меньше, чтобы панель не вылезала за экран
        className={cn(
          'grid grid-cols-3 gap-1.5 min-[420px]:grid-cols-4 overflow-y-auto overscroll-contain p-0.5 [scrollbar-width:thin]',
          drilled ? 'max-h-[min(30vh,230px)]' : 'max-h-[min(38vh,290px)]',
        )}
      >
        {!drilled && newTile}
        {onSaveTemplate && !searching && !drilled && (
          <button type="button" aria-label="Сохранить как шаблон" title="Сохранить как шаблон" onClick={onSaveTemplate} className={cn(cellClass(false), 'border-dashed text-brand')}>
            <Icon name="star" size={32} />
            <span className="text-caption font-medium leading-tight">В шаблон</span>
          </button>
        )}
        {drilled && open && (
          <Cell
            opt={{ value: open.value, label: 'Без подкатегории', ...(open.icon ? { icon: open.icon } : {}), ...(open.color ? { color: open.color } : {}) }}
            selected={open.value === value}
            onClick={() => onPick(open.value)}
          />
        )}
        {shown.map((opt) => (
          <Cell
            key={opt.value}
            opt={opt}
            // в верхнем уровне подсвечена и категория, в которой лежит выбранная подкатегория
            selected={opt.value === value || (!searching && !drilled && (kids.get(opt.value)?.some((k) => k.value === value) ?? false))}
            {...(searching && opt.sub ? { caption: opt.sub } : {})}
            {...(!searching && !drilled && kids.has(opt.value) ? { badge: kids.get(opt.value)?.length ?? 0 } : {})}
            onClick={() => tap(opt)}
          />
        ))}
        {drilled && newTile}
      </div>
      {adding && (
        <NewCategoryForm
          options={options}
          kind={kind}
          initialName={seed}
          {...(addingFor ? { parent: { id: addingFor.value, ...(addingFor.color ? { color: addingFor.color } : {}) } } : {})}
          onPick={onPick}
          onClose={() => setAdding(false)}
        />
      )}
      {options.length === 0 && !adding && <p className="px-1 text-sm text-muted">Категорий пока нет — создайте первую или сохраните без категории.</p>}
    </div>
  );
}
