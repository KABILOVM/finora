import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
import type { Category, LocalRow } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { CategoryPicker } from './CategoryPicker';
import { rankCategories, usePopularity } from './popularity';

export interface BulkCategorySheetProps {
  /** Вид выделенных операций: категории показываются только этого вида. */
  kind: 'expense' | 'income';
  count: number;
  categories: readonly LocalRow<Category>[];
  /** Идёт сохранение: окно закрыть и применить повторно нельзя. */
  saving?: boolean;
  onApply: (categoryId: string) => void;
  onClose: () => void;
}

/** «Категория для N операций»: выбор чипами, как в форме операции (самые частые первыми, «Новая» — прямо здесь). */
export function BulkCategorySheet({ kind, count, categories, saving = false, onApply, onClose }: BulkCategorySheetProps) {
  const pop = usePopularity();
  const [picked, setPicked] = useState<string | null>(null);
  const options = useMemo(() => {
    const live = categories.filter((c) => c.archivedAt === null);
    // пока частота не посчитана — обычный порядок категорий этого вида
    return buildCategoryOptions(pop ? rankCategories(live, kind, pop) : live.filter((c) => c.kind === kind), (c) => c.name);
  }, [categories, kind, pop]);
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={`Категория для ${count} ${pluralRu(count, 'операции', 'операций', 'операций')}`}
      footer={
        <Button size="lg" fullWidth loading={saving} disabled={picked === null} onClick={() => picked !== null && onApply(picked)}>
          Применить
        </Button>
      }
    >
      <p className="mb-3 text-muted">
        {kind === 'income' ? 'Категория дохода' : 'Категория расхода'} будет поставлена всем выбранным операциям. Прежние можно вернуть кнопкой «Отменить».
      </p>
      <CategoryPicker kind={kind} options={options} value={picked} onChange={setPicked} expanded />
    </Sheet>
  );
}
