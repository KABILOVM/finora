import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** ЗАГЛУШКА: настоящую страницу подключат позже (default export сохраняется). */
export default function WalletsPage() {
  return (
    <>
      <PageHeader title="Кошельки" />
      <EmptyState icon="wallet" title="Скоро" text="Здесь будут ваши кошельки и их остатки." />
    </>
  );
}
