/** Мелкие помощники для WebAuthn: base64url, случайные байты, «имя пользователя» ключа. Чистые функции. */

export function toBase64Url(data: ArrayBuffer | ArrayBufferView): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Идентификатор ключа WebAuthn не длиннее 1023 байт (это ≈ 1364 символа base64url). */
export const MAX_CREDENTIAL_ID_CHARS = 1400;

/** null — строка не похожа на base64url (пустая, лишние символы, слишком длинная, обрезанная). */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (text === '' || text.length > MAX_CREDENTIAL_ID_CHARS || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function sameBytes(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean {
  const x = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Случайный «вызов» WebAuthn (по умолчанию 32 байта). */
export function randomChallenge(length = 32): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

/**
 * Идентификатор пользователя для ключа (user.id): SHA-256 от id пользователя приложения с меткой — всегда одинаковый
 * для одного пользователя, 32 байта, и НЕ содержит почту. Нужен, чтобы у одного человека не множились ключи-двойники.
 */
export async function lockUserHandle(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  const input = new TextEncoder().encode(`finora-app-lock:v1:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(digest);
}
