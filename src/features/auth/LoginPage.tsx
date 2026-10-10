import { EmptyState } from '@/components/EmptyState';
import { Logo } from '@/components/Logo';

/** ЗАГЛУШКА: вход подключат позже (default export сохраняется). Экран без боковой и нижней панелей. */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo size={64} />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Вход</h1>
      <EmptyState title="Скоро" text="Вход в аккаунт появится здесь." />
    </main>
  );
}
