/** Перевод ошибок входа и смены пароля на понятный русский. Английские тексты Supabase человеку не показываем. */

export type AuthAction = 'sign-in' | 'password' | 'other';

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

function asLike(e: unknown): ErrorLike {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : {};
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Нет связи с сервером (а не «сервер ответил отказом»). */
export function isNetworkError(e: unknown): boolean {
  const { name, message, status } = asLike(e);
  if (name === 'AuthRetryableFetchError') return true;
  if (e instanceof TypeError) return true; // fetch без сети: «Failed to fetch» / «Load failed»
  if (status === 0) return true;
  return /failed to fetch|load failed|network ?error|networkerror|timed? ?out|timeout|fetch failed/i.test(text(message));
}

export const NO_CONNECTION_TEXT = 'Нет связи: для первого входа нужен интернет';

export function describeAuthError(e: unknown, action: AuthAction = 'other'): string {
  const { name, message, code, status } = asLike(e);
  const msg = text(message);
  const c = text(code);

  if (isNetworkError(e) || (typeof navigator !== 'undefined' && navigator.onLine === false && c === '')) {
    return action === 'sign-in' ? NO_CONNECTION_TEXT : 'Нет связи. Проверьте интернет и повторите.';
  }
  if (c === 'invalid_credentials' || /invalid login credentials|invalid credentials/i.test(msg)) {
    return 'Неверная почта или пароль';
  }
  if (c === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return 'Почта не подтверждена. Обратитесь к владельцу приложения.';
  }
  if (c === 'user_banned' || /banned/i.test(msg)) return 'Этот аккаунт отключён. Обратитесь к владельцу приложения.';
  if (c === 'over_request_rate_limit' || c === 'over_email_send_rate_limit' || status === 429) {
    return 'Слишком много попыток. Подождите несколько минут и повторите.';
  }
  if (c === 'same_password' || /should be different from the old password/i.test(msg)) {
    return 'Новый пароль совпадает со старым. Придумайте другой.';
  }
  if (c === 'weak_password' || /weak password|password should be/i.test(msg)) {
    return 'Пароль слишком простой. Добавьте длины, цифры и буквы.';
  }
  if (name === 'AuthSessionMissingError' || c === 'session_not_found' || c === 'session_expired' || status === 401) {
    return 'Сессия закончилась. Войдите заново.';
  }
  if (typeof status === 'number' && status >= 500) return 'Сервер сейчас недоступен. Попробуйте позже.';
  if (action === 'sign-in') return 'Не удалось войти. Попробуйте ещё раз.';
  if (action === 'password') return 'Не удалось сменить пароль. Попробуйте ещё раз.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
