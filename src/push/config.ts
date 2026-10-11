/**
 * Настройка напоминаний со стороны сборки: публичный ключ VAPID (VITE_VAPID_PUBLIC_KEY).
 *
 * Ключ публичный (это «адрес отправителя», не пароль): он вшивается в сборку, это нормально. ПРИВАТНЫЙ ключ VAPID
 * в приложении быть не должен ни при каких условиях: он лежит только в секретах серверной функции send-reminders.
 * Публичный ключ — точка P-256 в несжатом виде: 65 байт, первый байт 0x04, в base64url это ровно 87 символов.
 * Приватный ключ — 32 байта (43 символа): такое значение мы НЕ принимаем и никуда не показываем.
 */

export const VAPID_PUBLIC_KEY_LENGTH = 87;
const VAPID_PUBLIC_KEY_BYTES = 65;

export type VapidProblem = 'missing' | 'invalid';

export type VapidConfig =
  | { ok: true; /** Ключ как строка base64url (без «=»). */ key: string; /** Он же в байтах — для pushManager.subscribe. */ bytes: Uint8Array }
  | { ok: false; reason: VapidProblem };

/** base64url → байты. null — строка не в base64url. Допускает «=» в конце и обычные «+», «/» (на случай копирования из другого места). */
export function decodeBase64Url(input: string): Uint8Array | null {
  const clean = input.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_+/-]*$/.test(clean) || clean.length % 4 === 1) return null;
  const std = clean.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Байты → base64url без «=» (для сравнения ключей и тестов). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface VapidEnvLike {
  VITE_VAPID_PUBLIC_KEY?: unknown;
}

/**
 * Читает и проверяет публичный ключ. Не бросает ошибок. Значение ключа нигде не логируется и в тексты ошибок не попадает.
 * 'missing' — переменной нет или она пустая; 'invalid' — заготовка, неверная длина или не P-256-точка в несжатом виде.
 */
export function readVapidConfig(env: VapidEnvLike): VapidConfig {
  const raw = typeof env.VITE_VAPID_PUBLIC_KEY === 'string' ? env.VITE_VAPID_PUBLIC_KEY.trim() : '';
  if (raw === '') return { ok: false, reason: 'missing' };
  const key = raw.replace(/=+$/, '');
  if (key.length !== VAPID_PUBLIC_KEY_LENGTH || !/^[A-Za-z0-9_-]+$/.test(key)) return { ok: false, reason: 'invalid' };
  const bytes = decodeBase64Url(key);
  if (!bytes || bytes.length !== VAPID_PUBLIC_KEY_BYTES || bytes[0] !== 0x04) return { ok: false, reason: 'invalid' };
  return { ok: true, key, bytes };
}

/** Ключ из сборки (import.meta.env). */
export function getVapidConfig(): VapidConfig {
  return readVapidConfig(import.meta.env as VapidEnvLike);
}
