/**
 * Переходы по нажатию на уведомление. Адрес в push-сообщении приходит снаружи, поэтому пускаем только внутренние пути приложения.
 * Те же правила повторены в public/push-handler.js (service worker не может импортировать модули); тесты сверяют оба.
 */

/** Сообщение от service worker окнам приложения: перейти на путь (внутри приложения). */
export const MSG_NAVIGATE = 'finora-navigate';
/** Сообщение от service worker: браузер сменил/сбросил подписку на push — надо сверить её с сервером. */
export const MSG_SUBSCRIPTION_CHANGED = 'finora-push-subscription-changed';

export const MAX_PATH_LENGTH = 300;

/**
 * Путь допустим, если: строка, начинается ровно с одного «/», дальше только безопасные символы адреса
 * (буквы, цифры и - . _ ~ % @ ! $ & ' ( ) * + , ; = / ?). Двоеточие, обратный слэш, «#», пробелы, переводы строк,
 * управляющие и не-ASCII символы запрещены — значит, нельзя ни выйти на чужой сайт ('//evil.com', 'https://…', 'javascript:…'),
 * ни спрятать лишнее в адресе.
 */
export function isSafeAppPath(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 1 && raw.length <= MAX_PATH_LENGTH && /^\/(?!\/)[A-Za-z0-9\-._~%@!$&'()*+,;=/?]*$/.test(raw);
}

/** Путь из сообщения или '/' (Главная), если путь не годится. */
export function safeAppPath(raw: unknown): string {
  return isSafeAppPath(raw) ? raw : '/';
}
