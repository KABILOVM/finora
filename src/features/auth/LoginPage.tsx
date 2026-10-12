import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import { Wordmark } from '@/components/Wordmark';
import { CodeLoginForm } from './CodeLoginForm';
import { PasswordLoginForm } from './PasswordLoginForm';
import { useCodeLogin } from './useCodeLogin';

type Method = 'password' | 'code';
type Mode = 'in' | 'up';

const METHODS: readonly SegmentOption<Method>[] = [
  { value: 'password', label: 'Пароль' },
  { value: 'code', label: 'Код на почту' },
];

/**
 * Экран входа и регистрации (один экран, два режима). Войти можно по паролю или по коду, который приходит на почту;
 * зарегистрироваться — по почте и паролю. Без боковой и нижней панелей; показывается самой сборкой (src/app), пока никто
 * не вошёл, на любом адресе. Повторно входить не нужно: сессия хранится на устройстве.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('in');
  const [method, setMethod] = useState<Method>('password');
  // Почта общая для обоих способов: переключили способ — набирать заново не нужно.
  const [email, setEmail] = useState('');
  const codeFlow = useCodeLogin(email);
  const signUp = mode === 'up';

  // Пока идёт запрос кода, способ не меняем: ответ придёт в форму, которой уже нет на экране.
  const changeMethod = (m: Method) => {
    if (codeFlow.busy === null) setMethod(m);
  };
  const switchMode = () => {
    if (codeFlow.busy !== null) return;
    setMode(signUp ? 'in' : 'up');
    setMethod('password');
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex w-full animate-rise flex-col items-center rounded-[2rem] border border-border/70 bg-surface/70 p-6 shadow-card backdrop-blur-xl">
        <Logo size={72} className="drop-shadow-[0_14px_18px_rgb(var(--brand)/0.4)]" />
        <Wordmark className="mt-3 text-3xl" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{signUp ? 'Регистрация' : 'Вход'}</h1>
        <p className="mt-1 text-center text-muted">Личный учёт денег</p>

        {!signUp && <Segmented className="mt-6 w-full" options={METHODS} value={method} onChange={changeMethod} ariaLabel="Способ входа" />}

        <div className="mt-5 w-full">
          {method === 'password' || signUp ? (
            <PasswordLoginForm key={mode} email={email} onEmailChange={setEmail} signUp={signUp} />
          ) : (
            <CodeLoginForm email={email} onEmailChange={setEmail} flow={codeFlow} />
          )}
        </div>

        <button
          type="button"
          onClick={switchMode}
          className="mt-4 min-h-[44px] rounded-lg px-2 text-base font-semibold text-brand"
        >
          {signUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
      </div>
    </main>
  );
}
