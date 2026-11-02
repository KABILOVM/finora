import { useEffect, useRef, type FormEvent } from 'react';
import { CODE_MAX_LENGTH, CODE_MIN_LENGTH, CODE_SENT_TEXT } from '@/auth/emailCode';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { FormError, OfflineNotice } from './LoginNotices';
import type { useCodeLogin } from './useCodeLogin';
import { resendAnnouncement } from './useCountdown';
import { canAutoFocusText } from '@/lib/pointer';

type CodeLogin = ReturnType<typeof useCodeLogin>;

export interface CodeLoginFormProps {
  email: string;
  onEmailChange(value: string): void;
  flow: CodeLogin;
}

/** Вход по коду на почту: шаг 1 — почта, шаг 2 — код из письма. */
export function CodeLoginForm({ email, onEmailChange, flow }: CodeLoginFormProps) {
  const { step, code, setCode, busy, error, sentTo, remaining, requestCode, resend, verify, changeEmail } = flow;
  const codeRef = useRef<HTMLInputElement>(null);

  // На втором шаге на компьютере сразу в поле кода; на телефоне поле открывается нажатием (клавиатура сама не выезжает)
  useEffect(() => {
    if (step === 'code' && canAutoFocusText()) codeRef.current?.focus();
  }, [step]);

  const onSubmit = (action: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault();
    void action();
  };

  if (step === 'email') {
    return (
      <form id="code-request" name="code-request" method="post" onSubmit={onSubmit(requestCode)} className="flex w-full flex-col gap-4" noValidate>
        <p className="text-muted">Мы пришлём на вашу почту код из цифр. Он действует недолго.</p>
        <TextInput
          label="Почта"
          id="code-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          disabled={busy !== null}
          required
        />
        <OfflineNotice />
        <FormError message={error} />
        <Button type="submit" size="lg" fullWidth loading={busy === 'request'}>
          Прислать код
        </Button>
      </form>
    );
  }

  const tooShort = code.length < CODE_MIN_LENGTH;
  return (
    <form id="code-verify" name="code-verify" method="post" onSubmit={onSubmit(verify)} className="flex w-full flex-col gap-4" noValidate>
      <div role="status" className="rounded-xl bg-surface-2 p-3">
        <p className="font-semibold">{CODE_SENT_TEXT}</p>
        <p className="mt-1 text-sm text-muted">Код действует недолго. Письмо не пришло? Проверьте «Спам».</p>
      </div>
      <p className="break-all text-sm text-muted">Почта: {sentTo}</p>

      <TextInput
        ref={codeRef}
        label="Код из письма"
        id="code-value"
        name="code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        hint={`От ${CODE_MIN_LENGTH} до ${CODE_MAX_LENGTH} цифр. Можно вставить с пробелами.`}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={busy === 'verify'}
        className="text-center text-2xl tracking-[0.2em]"
        required
      />

      <OfflineNotice />
      <FormError message={error} />

      <Button type="submit" size="lg" fullWidth loading={busy === 'verify'} disabled={tooShort}>
        Войти
      </Button>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="secondary" onClick={() => void resend()} disabled={remaining > 0 || busy !== null} loading={busy === 'resend'}>
            Прислать код ещё раз
          </Button>
          {remaining > 0 && (
            <span aria-hidden="true" className="text-sm tabular-nums text-muted">
              через {remaining} с
            </span>
          )}
        </div>
        {/* Для скринридера: сообщение меняется всего несколько раз, а не каждую секунду */}
        <p role="status" className="sr-only">
          {resendAnnouncement(remaining)}
        </p>
        <Button variant="ghost" onClick={changeEmail} disabled={busy !== null} className="self-start">
          Изменить почту
        </Button>
      </div>
    </form>
  );
}
