import { useMemo, useState } from 'react';
import { type ChipOption } from '@/components/ChipPicker';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import type { CategoryKind } from '@/domain/types';
import { suggestColor, suggestGlyph } from '@/features/categories/suggestGlyph';
import { cleanName, sameName } from '@/features/wallets/walletUi';
import { cn } from '@/lib/cn';
import { FieldGroup } from './FieldGroup';

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
export function CategoryPicker({ options, value, onChange, error, kind }: CategoryPickerProps) {
  const store = useStore();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const collapsible = options.length > MAIN_COUNT + 1;
  const shown = useMemo(() => {
    if (!collapsible || expanded) return options;
    const main = options.slice(0, MAIN_COUNT);
    const picked = value !== null && !main.some((o) => o.value === value) ? options.find((o) => o.value === value) : undefined;
    return picked ? [...main, picked] : main;
  }, [options, value, collapsible, expanded]);
  const hidden = options.length - shown.length;

  const add = async () => {
    if (busy) return;
    const clean = cleanName(name);
    if (clean === '') return setProblem('Введите название');
    if (clean.length > 60) return setProblem('Не длиннее 60 символов');
    const twin = options.find((o) => sameName(o.label, clean));
    if (twin) {
      onChange(twin.value); // такая уже есть — просто выбираем её
      setAdding(false);
      setName('');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const row = await store.categories.create({ name: clean, kind, color: suggestColor(options.length), icon: suggestGlyph(clean) });
      onChange(row.id);
      setAdding(false);
      setName('');
      setExpanded(true);
    } catch (e) {
      console.error('Не удалось добавить категорию:', e);
      setProblem(e instanceof Error && e.name === 'ValidationError' ? e.message : 'Не удалось добавить. Попробуйте ещё раз.');
      toast.error('Категория не добавлена');
    } finally {
      setBusy(false);
    }
  };

  const chips = (
    <div role="group" aria-label="Категория" className="flex flex-wrap gap-2">
      {shown.map((opt) => {
        const selected = opt.value === value;
        return (
          <button key={opt.value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? null : opt.value)} className={chipClass(selected)}>
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
      {!adding && (
        <button type="button" aria-label="Новая категория" onClick={() => setAdding(true)} className={cn(chipClass(false), 'border-dashed text-brand')}>
          <Icon name="plus" size={18} />
          <span>Новая</span>
        </button>
      )}
    </div>
  );

  return (
    <FieldGroup label="Категория" hint="можно не выбирать" error={error}>
      {chips}
      {adding && (
        <form
          className="mt-2 flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter добавляет, а не сохраняет всю операцию
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="Название, например «Кофе»"
              aria-label="Название новой категории"
              maxLength={60}
              autoComplete="off"
              enterKeyHint="done"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base outline-none focus:border-brand"
            />
            <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-brand px-4 font-semibold text-brand-fg disabled:opacity-60">
              Добавить
            </button>
            <button
              type="button"
              aria-label="Отмена"
              onClick={() => {
                setAdding(false);
                setName('');
                setProblem(null);
              }}
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-muted hover:bg-surface-2"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {problem && (
            <p role="alert" className="text-sm font-medium text-danger">
              {problem}
            </p>
          )}
        </form>
      )}
      {options.length === 0 && !adding && <p className="mt-2 text-sm text-muted">Категорий пока нет — операция сохранится и без категории.</p>}
    </FieldGroup>
  );
}
