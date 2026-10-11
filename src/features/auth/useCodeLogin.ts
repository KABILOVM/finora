import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import {
  CODE_MISSING_TEXT,
  EMAIL_EMPTY_TEXT,
  extractCode,
  isCodeComplete,
  isPlausibleEmail,
  normalizeEmail,
  RESEND_SECONDS,
} from '@/auth/emailCode';
import { useCountdown } from './useCountdown';

export type CodeStep = 'email' | 'code';
export type CodeBusy = 'request' | 'verify' | 'resend' | null;

/**
 * Состояние входа по коду. Живёт в экране входа (а не в форме), чтобы переключение «Пароль / Код на почту» не теряло ввод кода
 * и не сбрасывало отсчёт «прислать ещё раз». Почту и код нигде не сохраняет (ни в хранилище, ни в журнал): только в памяти страницы.
 */
export function useCodeLogin(email: string) {
  const auth = useAuth();
  const [step, setStep] = useState<CodeStep>('email');
  const [code, setCodeState] = useState('');
  const [busy, setBusy] = useState<CodeBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const { remaining, start } = useCountdown();
  const busyRef = useRef(false);

  const setCode = useCallback((raw: string) => {
    setCodeState(extractCode(raw));
    setError(null);
  }, []);

  /** Общий каркас действия: одно за раз, пока идёт — кнопки заблокированы. */
  const run = async (kind: Exclude<CodeBusy, null>, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const requestCode = () =>
    run('request', async () => {
      const normalized = normalizeEmail(email);
      if (!isPlausibleEmail(normalized)) {
        setError(EMAIL_EMPTY_TEXT);
        return;
      }
      const result = await auth.requestEmailCode(normalized);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSentTo(normalized);
      setCodeState('');
      setStep('code');
      start(RESEND_SECONDS);
    });

  const resend = () =>
    run('resend', async () => {
      if (remaining > 0 || sentTo === '') return;
      const result = await auth.requestEmailCode(sentTo);
      if (!result.ok) setError(result.message);
      // и при успехе, и при ошибке ждём заново: не даём долбить сервер
      start(RESEND_SECONDS);
    });

  const verify = () =>
    run('verify', async () => {
      // Сами ничего не отправляем, пока код не набран до минимальной длины.
      if (!isCodeComplete(code)) {
        setError(CODE_MISSING_TEXT);
        return;
      }
      const result = await auth.verifyEmailCode(sentTo, code);
      // при успехе экран заменится сам; при ошибке код остаётся в поле — можно поправить цифру
      if (!result.ok) setError(result.message);
    });

  const changeEmail = () => {
    if (busyRef.current) return;
    setStep('email');
    setCodeState('');
    setError(null);
  };

  return { step, code, setCode, busy, error, sentTo, remaining, requestCode, resend, verify, changeEmail };
}
