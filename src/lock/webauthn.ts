/**
 * Замок приложения на WebAuthn (Face ID / отпечаток / код экрана): платформенный аутентификатор самого устройства.
 *
 * ЧЕСТНО О ЗАЩИТЕ: проверять подпись и «вызов» (challenge) на сервере негде — это локальный замок. Он отвечает на один вопрос:
 * «человек у экрана только что подтвердил себя телефону?». Поэтому мы сверяем лишь то, что вернул браузер (тот ли ключ,
 * наш ли challenge, отмечено ли подтверждение пользователя), и НЕ проверяем подпись по открытому ключу. Против того, кто умеет
 * менять код страницы на устройстве, это не защита; против того, кто взял разблокированный телефон, — защита.
 */
import { fromBase64Url, lockUserHandle, randomChallenge, sameBytes, toBase64Url } from './bytes';

/** Почему не вышло. declined — человек не подтвердил (отменил, закрыл окно, не сошлось лицо) — это не ошибка приложения. */
export type LockFailure = 'declined' | 'unsupported' | 'blocked' | 'failed';

export type CreateResult = { ok: true; credentialId: string } | { ok: false; reason: LockFailure };
export type VerifyResult = { ok: true } | { ok: false; reason: LockFailure };

export type SupportReason = 'insecure' | 'no-webauthn' | 'ios-browser' | 'no-authenticator' | 'blocked' | 'check-failed';
export type LockSupport = { supported: true } | { supported: false; reason: SupportReason };

/** Сколько ждём подтверждения у системы, мс. */
export const PROMPT_TIMEOUT_MS = 60_000;
/** Если браузер не вернул ответ и после этого срока, отменяем запрос сами. */
const PROMPT_ABORT_MS = PROMPT_TIMEOUT_MS + 5_000;
/** Ответ на «умеет ли устройство» не должен висеть вечно. */
const SUPPORT_CHECK_TIMEOUT_MS = 4_000;

export const LOCK_FAILURE_TEXT: Record<LockFailure, string> = {
  declined: 'Не подтверждено',
  unsupported: 'Это устройство не умеет подтверждать личность по Face ID или отпечатку',
  blocked: 'Замок отключён настройками сайта. Сообщите владельцу приложения.',
  failed: 'Не получилось. Попробуйте ещё раз.',
};

export const SUPPORT_TEXT: Record<SupportReason, string> = {
  insecure: 'Замок работает только на защищённом адресе (https). Откройте Sumoima по обычной ссылке.',
  'no-webauthn': 'Этот браузер не умеет подтверждать личность по Face ID или отпечатку.',
  'ios-browser': 'Откройте Sumoima с экрана «Домой»: нажмите «Поделиться» → «На экран Домой» и включите замок в установленном приложении.',
  'no-authenticator': 'Это устройство не умеет: на нём не настроены Face ID, отпечаток или код экрана.',
  blocked: 'Замок отключён настройками сайта. Сообщите владельцу приложения.',
  'check-failed': 'Не удалось проверить, умеет ли устройство подтверждать личность. Попробуйте позже.',
};

/* ------------------------------ определение устройства ------------------------------ */

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone (только iOS Safari). */
  standalone: boolean | undefined;
  /** matchMedia('(display-mode: standalone)'). */
  displayStandalone: boolean;
}

/** iPhone/iPad, открытые во вкладке браузера (а не как приложение с экрана «Домой»). */
export function isIosBrowserTab(d: DeviceInfo): boolean {
  const ios = /iPhone|iPad|iPod/.test(d.userAgent) || (d.platform === 'MacIntel' && d.maxTouchPoints > 1);
  return ios && d.standalone !== true && !d.displayStandalone;
}

function currentDevice(): DeviceInfo {
  let displayStandalone = false;
  try {
    displayStandalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    displayStandalone = false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone,
    displayStandalone,
  };
}

/** Открыто ли приложение iPhone/iPad во вкладке браузера (для подсказки в настройках). */
export const onIosBrowserTab = (): boolean => isIosBrowserTab(currentDevice());

/** Запрещает ли настройка сайта (заголовок Permissions-Policy) подтверждение через WebAuthn. Где браузер не отвечает — не знаем, false. */
export function policyBlocksWebAuthn(): boolean {
  try {
    const doc = document as Document & {
      permissionsPolicy?: { allowsFeature(name: string): boolean };
      featurePolicy?: { allowsFeature(name: string): boolean };
    };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== 'function') return false;
    return policy.allowsFeature('publickey-credentials-get') === false || policy.allowsFeature('publickey-credentials-create') === false;
  } catch {
    return false;
  }
}

function hasCredentialsApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function'
  );
}

const TIMED_OUT = Symbol('timed-out');
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Умеет ли это устройство замок: защищённый адрес, WebAuthn, платформенный аутентификатор, сайту это не запрещено. */
export async function getLockSupport(): Promise<LockSupport> {
  try {
    if (typeof window === 'undefined') return { supported: false, reason: 'no-webauthn' };
    if (window.isSecureContext === false) return { supported: false, reason: 'insecure' };
    const iosTab = isIosBrowserTab(currentDevice());
    if (!hasCredentialsApi()) return { supported: false, reason: iosTab ? 'ios-browser' : 'no-webauthn' };
    if (policyBlocksWebAuthn()) return { supported: false, reason: 'blocked' };
    const check = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof check !== 'function') return { supported: false, reason: iosTab ? 'ios-browser' : 'no-authenticator' };
    const available = await raceTimeout(check.call(window.PublicKeyCredential), SUPPORT_CHECK_TIMEOUT_MS);
    if (available === TIMED_OUT) return { supported: false, reason: 'check-failed' };
    if (available !== true) return { supported: false, reason: iosTab ? 'ios-browser' : 'no-authenticator' };
    return { supported: true };
  } catch {
    return { supported: false, reason: 'check-failed' };
  }
}

/** Короткий ответ на «умеет ли устройство замок». */
export async function isLockSupported(): Promise<boolean> {
  return (await getLockSupport()).supported;
}

/* ------------------------------ создание и проверка ------------------------------ */

/** Ошибку браузера → причина. Текст самой ошибки наружу не отдаём (в нём бывают адреса и подробности устройства). */
export function failureOf(e: unknown): LockFailure {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
  if (name === 'NotAllowedError') {
    // Chromium: запрет заголовком Permissions-Policy приходит тем же NotAllowedError — отличаем по тексту, чтобы не врать «не подтверждено»
    return /permissions? policy|feature is not enabled/i.test(message) ? 'blocked' : 'declined';
  }
  if (name === 'AbortError') return 'declined';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'failed';
}

/**
 * Запрос к системе с ограничением по времени: если браузер молчит дольше срока (или не умеет отмену по сигналу), сдаёмся сами,
 * иначе кнопка «Открыть» зависла бы навсегда.
 */
function withAbort<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    }, PROMPT_ABORT_MS);
    run(controller.signal).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

let creating: Promise<CreateResult> | null = null;
const verifying = new Map<string, Promise<VerifyResult>>();

async function doCreate(user: { id: string }): Promise<CreateResult> {
  if (!hasCredentialsApi()) return { ok: false, reason: 'unsupported' };
  if (policyBlocksWebAuthn()) return { ok: false, reason: 'blocked' };
  try {
    const userHandle = await lockUserHandle(user.id);
    const cred = await withAbort((signal) =>
      navigator.credentials.create({
        signal,
        publicKey: {
          challenge: randomChallenge(32),
          // rp.id не задаём: берётся адрес сайта. Сменится адрес сайта — старые ключи перестанут подходить (тогда «выйти и войти заново»)
          rp: { name: 'Sumoima' },
          // Имя и id не содержат почту: имя видно в системных списках паролей
          user: { id: userHandle, name: 'Sumoima — замок', displayName: 'Sumoima — замок' },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          attestation: 'none',
          timeout: PROMPT_TIMEOUT_MS,
        },
      }),
    );
    if (!cred || cred.type !== 'public-key') return { ok: false, reason: 'failed' };
    const raw = (cred as PublicKeyCredential).rawId;
    if (!raw || raw.byteLength === 0 || raw.byteLength > 1023) return { ok: false, reason: 'failed' };
    return { ok: true, credentialId: toBase64Url(raw) };
  } catch (e) {
    return { ok: false, reason: failureOf(e) };
  }
}

/**
 * Создать ключ замка для пользователя (покажется системный запрос Face ID / отпечатка). Вызывать из нажатия кнопки.
 * Параллельные вызовы объединяются: второе нажатие не открывает второе окно.
 */
export function createLockCredential(user: { id: string }): Promise<CreateResult> {
  if (creating) return creating;
  const p = doCreate(user).finally(() => {
    creating = null;
  });
  creating = p;
  return p;
}

const UV_FLAG = 0x04;

async function doVerify(credentialId: string): Promise<VerifyResult> {
  const id = fromBase64Url(credentialId);
  if (!id) return { ok: false, reason: 'failed' };
  if (!hasCredentialsApi()) return { ok: false, reason: 'unsupported' };
  if (policyBlocksWebAuthn()) return { ok: false, reason: 'blocked' };
  try {
    const challenge = randomChallenge(32);
    const cred = await withAbort((signal) =>
      navigator.credentials.get({
        signal,
        publicKey: {
          challenge,
          allowCredentials: [{ type: 'public-key', id }],
          userVerification: 'required',
          timeout: PROMPT_TIMEOUT_MS,
        },
      }),
    );
    if (!cred || cred.type !== 'public-key') return { ok: false, reason: 'failed' };
    const pk = cred as PublicKeyCredential;
    if (!pk.rawId || !sameBytes(pk.rawId, id)) return { ok: false, reason: 'failed' };
    const response = pk.response as AuthenticatorAssertionResponse;
    // Подтверждение пользователя (лицо, отпечаток, код) должно быть отмечено в ответе; нет отметки — не открываем.
    if (response.authenticatorData && response.authenticatorData.byteLength > 32) {
      const flags = new Uint8Array(response.authenticatorData)[32] ?? 0;
      if ((flags & UV_FLAG) === 0) return { ok: false, reason: 'declined' };
    }
    // Наш ли это вызов: защита от перепутанных ответов.
    if (response.clientDataJSON) {
      const data = JSON.parse(new TextDecoder().decode(response.clientDataJSON)) as { type?: unknown; challenge?: unknown };
      if (data.type !== 'webauthn.get' || data.challenge !== toBase64Url(challenge)) return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: failureOf(e) };
  }
}

/**
 * Попросить у системы подтверждение (Face ID / отпечаток) именно по ЭТОМУ ключу. ok:true — только если человек подтвердил.
 * Одновременные вызовы для одного ключа объединяются (автозапрос и нажатие кнопки не отменяют друг друга).
 */
export function verifyLock(credentialId: string): Promise<VerifyResult> {
  const running = verifying.get(credentialId);
  if (running) return running;
  const p = doVerify(credentialId).finally(() => {
    verifying.delete(credentialId);
  });
  verifying.set(credentialId, p);
  return p;
}
