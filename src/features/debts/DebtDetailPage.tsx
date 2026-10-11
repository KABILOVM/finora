import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** Заглушка страницы одного долга (/debts/:id): содержимое заменит модуль долгов. */
export default function DebtDetailPage() {
  return (
    <>
      <PageHeader title="Долг" />
      <EmptyState icon="banknote" title="Скоро" text="Платежи по долгу появятся здесь." />
    </>
  );
}
