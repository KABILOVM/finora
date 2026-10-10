import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

/** ЗАГЛУШКА: настоящую страницу подключат позже (default export сохраняется). */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Настройки" />
      <EmptyState icon="more" title="Скоро" text="Здесь будут валюта, категории, резервная копия и аккаунт." />
    </>
  );
}
