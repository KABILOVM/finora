import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** ЗАГЛУШКА: настоящую страницу подключат позже (default export сохраняется). */
export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Операции" />
      <EmptyState icon="list" title="Скоро" text="Здесь будет список расходов, доходов и переводов." />
    </>
  );
}
