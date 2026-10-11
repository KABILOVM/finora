import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** Заглушка: настоящий экран заменит содержимое, имя файла и default export остаются. */
export default function DebtsPage() {
  return (
    <>
      <PageHeader title="Долги и кредиты" />
      <EmptyState icon="banknote" title="Скоро" text="Учёт долгов и кредитов появится здесь." />
    </>
  );
}
