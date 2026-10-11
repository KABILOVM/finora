import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import { CodeLoginForm } from './CodeLoginForm';
import { PasswordLoginForm } from './PasswordLoginForm';
import { useCodeLogin } from './useCodeLogin';

type Method = 'password' | 'code';

const METHODS: readonly SegmentOption<Method>[] = [
  { value: 'password', label: 'Пароль' },
  { value: 'code', label: 'Код на почту' },
];

/**
 * Экран входа. Регистрации здесь нет: это закрытый круг, аккаунты создаёт владелец приложения.
 * Войти можно по паролю или по коду, который приходит на почту.
 * Экран без боковой и нижней панелей; показывается самой сборкой (src/app), пока никто не вошёл, на любом адресе.
 */
export default function LoginPage() {
  const [method, setMethod] = useState<Method>('password');
  // Почта общая для обоих способов: переключили способ — набирать заново не нужно.
  const [email, setEmail] = useState('');
  const codeFlow = useCodeLogin(email);

  // Пока идёт запрос кода, способ не меняем: ответ придёт в форму, которой уже нет на экране.
  const changeMethod = (m: Method) => {
    if (codeFlow.busy === null) setMethod(m);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo size={64} />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Вход</h1>
      <p className="mt-1 text-center text-muted">Finora — учёт денег. Войдите, чтобы открыть свои записи.</p>

      <Segmented className="mt-6 w-full" options={METHODS} value={method} onChange={changeMethod} ariaLabel="Способ входа" />

      <div className="mt-5 w-full">
        {method === 'password' ? (
          <PasswordLoginForm email={email} onEmailChange={setEmail} />
        ) : (
          <CodeLoginForm email={email} onEmailChange={setEmail} flow={codeFlow} />
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Аккаунты создаёт владелец приложения. Если у вас нет почты и пароля — попросите его.
      </p>
    </main>
  );
}
