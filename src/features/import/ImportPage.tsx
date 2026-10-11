import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** Заглушка: настоящий экран заменит содержимое, имя файла и default export остаются. */
export default function ImportPage() {
  return (
    <>
      <PageHeader title="Импорт из Zenmoney" />
      <EmptyState icon="upload" title="Скоро" text="Перенос истории из Zenmoney появится здесь." />
    </>
  );
}
