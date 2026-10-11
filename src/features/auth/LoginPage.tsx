import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { useOnline } from '@/components/OnlineBadge';
import { Logo } from '@/components/Logo';

/**
 * Экран входа. Регистрации здесь нет: это закрытый круг, аккаунты создаёт владелец приложения.
 * Экран без боковой и нижней панелей; показывается самой сборкой (src/app), пока никто не вошёл, на любом адресе.
 */
export default function LoginPage() {
  const auth = useAuth();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // двойной тап не отправляет вход дважды
    setBusy(true);
    setError(null);
    const result = await auth.signIn(email, password);
    // при успехе экран заменится сам (состояние входа изменилось), поэтому состояние здесь трогаем только при ошибке
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo size={64} />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Вход</h1>
      <p className="mt-1 text-center text-muted">Finora — учёт денег. Войдите, чтобы открыть свои записи.</p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 flex w-full flex-col gap-4" noValidate>
        <TextInput
          label="Почта"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
        <div className="flex flex-col gap-1.5">
          <TextInput
            label="Пароль"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            className="min-h-[44px] self-start rounded-lg px-1 text-base font-semibold text-brand"
          >
            {showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          </button>
        </div>

        {!online && (
          <p role="status" className="rounded-xl bg-warning/10 p-3 text-warning">
            Нет сети. Для входа нужен интернет.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={busy}>
          Войти
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Аккаунты создаёт владелец приложения. Если у вас нет почты и пароля — попросите его.
      </p>
    </main>
  );
}
