import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** ЗАГЛУШКА: настоящую страницу подключат позже (default export сохраняется). */
export default function HomePage() {
  return (
    <>
      <PageHeader title="Главная" />
      <EmptyState icon="home" title="Скоро" text="Здесь появится сводка по вашим деньгам." />
    </>
  );
}
