import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { Segmented } from '@/components/Segmented';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import type { Category, CategoryKind, LocalRow } from '@/domain/types';
import { CategorySheet } from '@/features/categories/CategorySheet';
import { cn } from '@/lib/cn';
import { setCategoryEnabled } from './onboardingActions';
import { WizardFrame } from './WizardFrame';

/** Шаг 3: категории. Стандартные видны с галочками; снятая галочка прячет категорию (архив), поставленная возвращает. */
export function CategoriesStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);

  const all = useCategories(kind, { includeArchived: true });
  const list = all ?? [];

  const toggle = async (c: LocalRow<Category>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await setCategoryEnabled(store, c.id, c.archivedAt !== null);
    } catch (e) {
      console.error('Не удалось изменить категорию:', e);
      toast.error('Не удалось изменить категорию. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
    }
  };

  return (
    <WizardFrame
      step="categories"
      title="Категории"
      lead="На что вы тратите и откуда получаете деньги. Уберите лишнее или добавьте своё."
      onBack={onBack}
      onNext={onNext}
    >
      <Segmented
        ariaLabel="Вид категорий"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Расходы', tone: 'expense' },
          { value: 'income', label: 'Доходы', tone: 'income' },
        ]}
      />
      <ul aria-label={kind === 'expense' ? 'Категории расходов' : 'Категории доходов'} className="flex flex-wrap gap-2">
        {list.map((c) => {
          const on = c.archivedAt === null;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => void toggle(c)}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-2 rounded-full border py-1 pl-1.5 pr-4 text-base font-medium transition duration-200 ease-spring active:scale-95',
                  on ? 'border-brand bg-brand/10 text-text' : 'border-border bg-surface text-muted line-through opacity-70',
                )}
              >
                <Glyph value={c.icon} color={c.color} size={30} />
                <span className="whitespace-nowrap">{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>
        Добавить свою
      </Button>
      {adding && (
        <CategorySheet
          category={null}
          kind={kind}
          others={list.map((c) => ({ name: c.name, archived: c.archivedAt !== null }))}
          onClose={() => setAdding(false)}
        />
      )}
    </WizardFrame>
  );
}
