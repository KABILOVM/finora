import { useOnline } from '@/components/OnlineBadge';

/** Подсказка «нет сети» — одна и для пароля, и для кода. */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="rounded-xl bg-warning/10 p-3 text-warning">
      Нет сети. Для входа нужен интернет.
    </p>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
      {message}
    </p>
  );
}
