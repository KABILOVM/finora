/**
 * Вход по коду на почту (Supabase email OTP): чистые функции — разбор почты и кода, разбор ответов сервера.
 * Ничего здесь не логирует и не кладёт почту или код в тексты ошибок.
 */
import { isNetworkError, NO_CONNECTION_TEXT } from './authErrors';

/** Длину кода задаёт настройка проекта Supabase (по умолчанию 6, бывает до 10): принимаем весь этот промежуток. */
export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 10;
/** Через сколько секунд можно запросить код ещё раз (у сервера свой предел — он про то же самое). */
export const RESEND_SECONDS = 60;

/** Один и тот же ответ человеку, есть такая почта или нет: по экрану нельзя узнать, чей адрес зарегистрирован. */
export const CODE_SENT_TEXT = 'Если такая почта есть, мы отправили на неё код.';

const EMAIL_TEXT = 'Введите почту, например name@example.com';
export const CODE_MISSING_TEXT = `Введите код из письма: только цифры, от ${CODE_MIN_LENGTH} до ${CODE_MAX_LENGTH}.`;
export const CODE_WRONG_TEXT = 'Неверный или просроченный код. Проверьте цифры или запросите новый код.';
export const RATE_LIMIT_TEXT = 'Слишком много попыток. Подождите несколько минут и повторите.';
export const SERVER_DOWN_TEXT = 'Сервер сейчас недоступен. Попробуйте позже.';
export const EMAIL_EMPTY_TEXT = EMAIL_TEXT;

/**
 * Невидимые символы, которые приезжают при копировании из писем, чатов и контактов: нулевая ширина, метки направления текста
 * (U+200E, U+202A–202E, U+2066–2069, U+061C), мягкий перенос U+00AD, BOM. Все они относятся к категории Unicode «Cf» (формат) —
 * убираем её целиком, а не список «известных», чтобы очередная метка не оставила в адресе невидимый мусор.
 */
const INVISIBLE = /\p{Cf}/gu;

/** Почта в том виде, в каком её ждёт сервер: без пробелов и невидимых символов по краям, строчными буквами. */
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').trim().toLowerCase();
}

/** Похоже ли на адрес почты (полную проверку делает сервер): один «@», точка в домене, без пробелов, не длиннее 254. */
export function isPlausibleEmail(email: string): boolean {
  if (email.length > 254 || /\s/.test(email)) return false;
  return /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)*\.[^@\s.]{2,}$/.test(email);
}

/** Код после очистки: только цифры, не длиннее CODE_MAX_LENGTH. */
export function extractCode(raw: string): string {
  const text = raw.normalize('NFKC').replace(INVISIBLE, '');
  // Только цифры и разделители («123 456», «123-456», «123.456») — это сам код, разделители убираем.
  if (/^[\s\d\-–—._·]*$/.test(text)) return text.replace(/\D/g, '').slice(0, CODE_MAX_LENGTH);
  // Вставили кусок письма («Ваш код: 123 456, действует…») — берём первую группу цифр длиной с код.
  const group = /\d(?:[\s\-–—]?\d){5,9}/.exec(text);
  if (group) return group[0].replace(/\D/g, '').slice(0, CODE_MAX_LENGTH);
  return text.replace(/\D/g, '').slice(0, CODE_MAX_LENGTH);
}

/** Набрана ли минимальная длина кода: пока нет, ничего не отправляем. */
export function isCodeComplete(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= CODE_MIN_LENGTH && code.length <= CODE_MAX_LENGTH;
}

interface ErrorFields {
  code: string;
  status: number | null;
  message: string;
}

function fieldsOf(e: unknown): ErrorFields {
  const o = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {};
  return {
    code: typeof o.code === 'string' ? o.code : '',
    status: typeof o.status === 'number' ? o.status : null,
    message: typeof o.message === 'string' ? o.message : '',
  };
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

const RATE_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit']);
/** «For security purposes, you can only request this after 42 seconds» — пауза между письмами для ОДНОЙ почты. */
const PER_ADDRESS_PAUSE = /only request this after|after \d+ seconds?/i;
/** Ответы «такого пользователя нет / регистрация закрыта / адрес не подходит» — от них нельзя отличать успех. */
const NEUTRAL_CODES = new Set([
  'otp_disabled',
  'signup_disabled',
  'user_not_found',
  'email_address_invalid',
  'email_address_not_authorized',
  'validation_failed',
]);
const NEUTRAL_MESSAGE = /signups? not allowed|user not found|not allowed for otp|email address .*(invalid|not authorized)|invalid email/i;
const NEUTRAL_STATUSES = new Set([400, 403, 404, 422]);

export type CodeRequestOutcome = { kind: 'neutral' } | { kind: 'error'; message: string };

/**
 * Что сказать человеку после неудачного запроса кода. Защита от перебора адресов: ответы «нет такой почты» и «регистрация закрыта»
 * (а заодно паузу между письмами для одной почты) НЕ отличаем от успеха — это 'neutral'. Честно говорим только то, что не зависит
 * от адреса: нет сети, слишком много попыток, сервер недоступен, вход по почте отключён.
 */
export function classifyCodeRequestError(e: unknown): CodeRequestOutcome {
  const { code, status, message } = fieldsOf(e);
  // supabase-js отдаёт 502/503/504 как AuthRetryableFetchError (тот же класс, что и «нет сети»): по числу отличаем сервер от сети
  if (status !== null && status >= 500) return { kind: 'error', message: SERVER_DOWN_TEXT };
  if (isNetworkError(e) || (isOffline() && code === '')) return { kind: 'error', message: NO_CONNECTION_TEXT };
  if (RATE_CODES.has(code) || status === 429) {
    return PER_ADDRESS_PAUSE.test(message) ? { kind: 'neutral' } : { kind: 'error', message: RATE_LIMIT_TEXT };
  }
  if (code === 'email_provider_disabled') {
    return { kind: 'error', message: 'Вход по почте отключён на сервере. Обратитесь к владельцу приложения.' };
  }
  if (NEUTRAL_CODES.has(code) || NEUTRAL_MESSAGE.test(message) || (status !== null && NEUTRAL_STATUSES.has(status))) {
    return { kind: 'neutral' };
  }
  return { kind: 'error', message: 'Не удалось отправить код. Попробуйте ещё раз.' };
}

/** Что сказать человеку после неудачной проверки кода. */
export function describeCodeVerifyError(e: unknown): string {
  const { code, status, message } = fieldsOf(e);
  if (status !== null && status >= 500) return SERVER_DOWN_TEXT;
  if (isNetworkError(e) || (isOffline() && code === '')) return NO_CONNECTION_TEXT;
  if (RATE_CODES.has(code) || status === 429) return RATE_LIMIT_TEXT;
  if (code === 'user_banned' || /banned/i.test(message)) return 'Этот аккаунт отключён. Обратитесь к владельцу приложения.';
  if (status === 401) return 'Не удалось войти. Попробуйте ещё раз.'; // ключ приложения не принят — это не вина кода
  if (
    code === 'otp_expired' ||
    code === 'invalid_credentials' ||
    code === 'validation_failed' ||
    /token has expired|invalid|expired/i.test(message) ||
    (status !== null && NEUTRAL_STATUSES.has(status))
  ) {
    return CODE_WRONG_TEXT;
  }
  return 'Не удалось войти. Попробуйте ещё раз.';
}
