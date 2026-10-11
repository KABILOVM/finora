import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** Заглушка: настоящий экран заменит содержимое, имя файла и default export остаются. */
export default function RecurringPage() {
  return (
    <>
      <PageHeader title="Регулярные платежи" />
      <EmptyState icon="repeat" title="Скоро" text="Платежи по расписанию появятся здесь." />
    </>
  );
}
