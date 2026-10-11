import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** Заглушка: настоящий экран заменит содержимое, имя файла и default export остаются. */
export default function BudgetsPage() {
  return (
    <>
      <PageHeader title="Бюджеты" />
      <EmptyState icon="pie" title="Скоро" text="Лимиты по категориям и прогноз «сколько можно тратить в день» появятся здесь." />
    </>
  );
}
