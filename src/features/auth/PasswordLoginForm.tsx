import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { FormError, OfflineNotice } from './LoginNotices';

export interface PasswordLoginFormProps {
  email: string;
  onEmailChange(value: string): void;
}

/**
 * Вход по паролю. Поля размечены так, чтобы связка ключей iCloud и менеджеры паролей их узнавали (на iPhone Face ID подставляет
 * пароль именно через это): autocomplete username / current-password, постоянные id и name, подпись клавиши Enter.
 * method="post": если страница по какой-то причине отправит форму сама, пароль уйдёт в теле запроса, а не в адресе.
 */
export function PasswordLoginForm({ email, onEmailChange }: PasswordLoginFormProps) {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return; // двойной тап не отправляет вход дважды
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await auth.signIn(email, password);
    // при успехе экран заменится сам (состояние входа изменилось), поэтому состояние здесь трогаем только при ошибке
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      busyRef.current = false;
    }
  };

  return (
    <form id="password-login" name="password-login" method="post" onSubmit={(e) => void submit(e)} className="flex w-full flex-col gap-4" noValidate>
      <TextInput
        label="Почта"
        id="login-email"
        name="username"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        disabled={busy}
        required
      />
      <div className="flex flex-col gap-1.5">
        <TextInput
          label="Пароль"
          id="login-password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
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

      <OfflineNotice />
      <FormError message={error} />

      <Button type="submit" size="lg" fullWidth loading={busy}>
        Войти
      </Button>
    </form>
  );
}
