import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { INVALID_CREDENTIALS_TEXT } from '@/auth/authErrors';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '@/auth/passwordRules';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { FormError, OfflineNotice } from './LoginNotices';
import { PasswordField } from './PasswordField';

export interface PasswordLoginFormProps {
  email: string;
  onEmailChange(value: string): void;
  /** true — регистрация (почта, пароль и его повтор), иначе вход. */
  signUp?: boolean;
  /** «Войти по коду на почту»: предлагается после неверного пароля (забыли пароль). */
  onUseCode?: () => void;
}

/**
 * Вход по паролю. Поля размечены так, чтобы связка ключей iCloud и менеджеры паролей их узнавали (на iPhone Face ID подставляет
 * пароль именно через это): autocomplete username / current-password, постоянные id и name, подпись клавиши Enter.
 * method="post": если страница по какой-то причине отправит форму сама, пароль уйдёт в теле запроса, а не в адресе.
 */
export function PasswordLoginForm({ email, onEmailChange, signUp = false, onUseCode }: PasswordLoginFormProps) {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const busyRef = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return; // двойной тап не отправляет вход дважды
    busyRef.current = true;
    setBusy(true);
    setError(null);
    if (signUp) {
      // пароль набирают дважды, чтобы опечатка не закрыла вход в новый аккаунт
      const problem = checkNewPassword(password, repeat);
      if (problem) {
        setError(problem);
        setBusy(false);
        busyRef.current = false;
        return;
      }
    }
    const result = signUp ? await auth.signUp(email, password) : await auth.signIn(email, password);
    // при успехе экран заменится сам (состояние входа изменилось), поэтому состояние здесь трогаем только при ошибке
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      busyRef.current = false;
    } else if (result.confirm) {
      // аккаунт создан, но войти можно только после письма
      setConfirmSent(true);
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
      <PasswordField
        label="Пароль"
        id="login-password"
        name="password"
        shown={showPassword}
        onToggleShown={() => setShowPassword((v) => !v)}
        autoComplete={signUp ? 'new-password' : 'current-password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint={signUp ? 'next' : 'go'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        hint={signUp ? `Не короче ${MIN_PASSWORD_LENGTH} символов` : undefined}
        required
      />
      {signUp && (
        <PasswordField
          label="Повторите пароль"
          id="login-password-repeat"
          name="password-repeat"
          shown={showPassword}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          disabled={busy}
          required
        />
      )}

      {confirmSent && (
        <Notice tone="success">Мы отправили письмо на {email.trim()}. Подтвердите почту по ссылке в нём, затем войдите.</Notice>
      )}
      <OfflineNotice />
      <FormError message={error} />
      {!signUp && onUseCode && error === INVALID_CREDENTIALS_TEXT && (
        <Button variant="secondary" fullWidth onClick={onUseCode}>
          Забыли пароль? Войти по коду на почту
        </Button>
      )}

      <Button type="submit" size="lg" fullWidth loading={busy}>
        {signUp ? 'Создать аккаунт' : 'Войти'}
      </Button>
    </form>
  );
}
