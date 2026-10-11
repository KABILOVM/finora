import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { useOnline } from '@/components/OnlineBadge';
import { Logo } from '@/components/Logo';

/**
 * Экран входа и регистрации (один экран, два режима). Без боковой и нижней панелей; показывается самой сборкой (src/app),
 * пока никто не вошёл, на любом адресе. Повторно входить не нужно: сессия хранится на устройстве.
 */
export default function LoginPage() {
  const auth = useAuth();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [confirmSent, setConfirmSent] = useState(false);
  const signUp = mode === 'up';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // двойной тап не отправляет вход дважды
    setBusy(true);
    setError(null);
    const result = signUp ? await auth.signUp(email, password) : await auth.signIn(email, password);
    // при успехе экран заменится сам (состояние входа изменилось), поэтому состояние здесь трогаем только при ошибке
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
    } else if (result.confirm) {
      // аккаунт создан, но войти можно только после письма
      setConfirmSent(true);
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(signUp ? 'in' : 'up');
    setError(null);
    setConfirmSent(false);
    setPassword('');
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex w-full animate-rise flex-col items-center rounded-[2rem] border border-border/70 bg-surface/70 p-6 shadow-card backdrop-blur-xl">
      <Logo size={72} className="drop-shadow-[0_14px_18px_rgb(var(--brand)/0.4)]" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{signUp ? 'Регистрация' : 'Вход'}</h1>
      <p className="mt-1 text-center text-muted">Finora — учёт денег</p>

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
            autoComplete={signUp ? 'new-password' : 'current-password'}
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

        {signUp && <p className="-mt-2 text-sm text-muted">Пароль — от 8 символов</p>}
        {confirmSent && (
          <p role="status" className="rounded-xl bg-income/10 p-3 font-medium text-income">
            Мы отправили письмо на {email.trim()}. Подтвердите почту по ссылке в нём, затем войдите.
          </p>
        )}
        {!online && (
          <p role="status" className="rounded-xl bg-warning/10 p-3 text-warning">
            {signUp ? 'Нет сети. Для регистрации нужен интернет.' : 'Нет сети. Для входа нужен интернет.'}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {signUp ? 'Создать аккаунт' : 'Войти'}
        </Button>
      </form>

      <button
        type="button"
        onClick={switchMode}
        disabled={busy}
        className="mt-4 min-h-[44px] rounded-lg px-2 text-base font-semibold text-brand"
      >
        {signUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
      </button>
      </div>
    </main>
  );
}
