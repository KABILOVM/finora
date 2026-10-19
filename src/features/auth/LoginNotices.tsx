import { Notice } from '@/components/Notice';
import { useOnline } from '@/components/OnlineBadge';

/** Подсказка «нет сети» — одна и для пароля, и для кода. */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <Notice tone="warning">Нет сети. Для входа нужен интернет.</Notice>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Notice tone="danger">{message}</Notice>
  );
}
