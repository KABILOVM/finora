import { useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import type { PlanCategory } from '@/import/types';

function CategoryState({ c }: { c: PlanCategory }) {
  if (c.target.kind === 'existing') return <Badge tone="neutral">уже есть</Badge>;
  if (c.target.kind === 'create') return <Badge tone="brand">будет создана</Badge>;
  return <Badge tone="warning">без категории</Badge>;
}

/** Категории Дзен-мани: сколько нашлось у вас и сколько будет создано; список можно развернуть. */
export function CategoriesBlock({ categories }: { categories: readonly PlanCategory[] }) {
  const [open, setOpen] = useState(false);
  if (categories.length === 0) return null;
  const found = categories.filter((c) => c.target.kind === 'existing').length;
  const created = categories.filter((c) => c.target.kind === 'create' && c.needed).length;
  const missing = categories.filter((c) => c.target.kind === 'missing').length;
  return (
    <section aria-labelledby="cats-h" className="flex flex-col gap-2">
      <SectionHeader id="cats-h" className="mb-0">
        Категории
      </SectionHeader>
      <Card className="flex flex-col gap-3">
        <p data-testid="categories-summary">
          Найдено у вас: {found}. Будет создано: {created}.
          {missing > 0 ? ` Без категории: ${missing}.` : ''}
        </p>
        <Button variant="secondary" aria-expanded={open} aria-controls="cats-list" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть список' : 'Показать список'}
        </Button>
        {open && (
          <ul id="cats-list" className="divide-y divide-border rounded-xl border border-border">
            {categories.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words">
                  {c.path.join(' / ')}
                  <span className="ml-2 text-sm text-muted">{c.catKind === 'expense' ? 'расход' : 'доход'}</span>
                </span>
                <CategoryState c={c} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
