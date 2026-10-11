/**
 * Помощник ТОЛЬКО для тестов: подменный WebAuthn (navigator.credentials и window.PublicKeyCredential) с настраиваемым поведением.
 * В боевой код не попадает (его никто не импортирует).
 */
import { toBase64Url } from './bytes';

export type FakeMode = 'ok' | 'decline' | 'abort' | 'policy' | 'insecure-domain' | 'no-uv-flag' | 'wrong-credential' | 'wrong-challenge' | 'hang';

export interface FakeWebAuthn {
  /** Как отвечает аутентификатор на следующие запросы. */
  mode: FakeMode;
  /** Ответ isUserVerifyingPlatformAuthenticatorAvailable. */
  available: boolean | 'throws' | 'hangs';
  /** Параметры вызовов (последние сверху вниз). */
  createCalls: CredentialCreationOptions[];
  getCalls: CredentialRequestOptions[];
  /** Созданные ключи (rawId). */
  keys: Uint8Array[];
  /** Если задан, get() ждёт этот промис (чтобы проверить одновременные вызовы). */
  hold: Promise<void> | null;
  restore(): void;
}

function domError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

export function installFakeWebAuthn(initial: Partial<Pick<FakeWebAuthn, 'mode' | 'available'>> = {}): FakeWebAuthn {
  const fake: FakeWebAuthn = {
    mode: initial.mode ?? 'ok',
    available: initial.available ?? true,
    createCalls: [],
    getCalls: [],
    keys: [],
    hold: null,
    restore: () => undefined,
  };

  const failFor = (): Error | null => {
    if (fake.mode === 'decline') return domError('NotAllowedError', 'The operation either timed out or was not allowed.');
    if (fake.mode === 'abort') return domError('AbortError', 'aborted');
    if (fake.mode === 'policy') return domError('NotAllowedError', "The 'publickey-credentials-get' feature is not enabled in this document. Permissions Policy may be used");
    if (fake.mode === 'insecure-domain') return domError('SecurityError', 'This is an invalid domain.');
    return null;
  };

  const credentials = {
    async create(options: CredentialCreationOptions) {
      fake.createCalls.push(options);
      const err = failFor();
      if (err) throw err;
      const raw = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
      fake.keys.push(raw);
      return { type: 'public-key', id: toBase64Url(raw), rawId: raw.buffer, response: {} };
    },
    async get(options: CredentialRequestOptions) {
      fake.getCalls.push(options);
      if (fake.hold) await fake.hold;
      if (fake.mode === 'hang') return new Promise<never>(() => undefined);
      const err = failFor();
      if (err) throw err;
      const allowed = options.publicKey?.allowCredentials?.[0]?.id;
      const wanted = allowed ? new Uint8Array(allowed as ArrayBuffer) : new Uint8Array(0);
      const raw = fake.mode === 'wrong-credential' ? new Uint8Array(32).fill(7) : wanted;
      const authData = new Uint8Array(37);
      authData[32] = fake.mode === 'no-uv-flag' ? 0x01 : 0x05; // UP (+ UV)
      const challenge = options.publicKey?.challenge ? toBase64Url(options.publicKey.challenge as ArrayBuffer) : '';
      const clientData = JSON.stringify({
        type: 'webauthn.get',
        challenge: fake.mode === 'wrong-challenge' ? 'AAAA' : challenge,
        origin: location.origin,
      });
      return {
        type: 'public-key',
        id: toBase64Url(raw),
        rawId: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        response: { authenticatorData: authData.buffer, clientDataJSON: new TextEncoder().encode(clientData).buffer, signature: new ArrayBuffer(8) },
      };
    },
  };

  class FakePublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
      if (fake.available === 'throws') return Promise.reject(new Error('boom'));
      if (fake.available === 'hangs') return new Promise<boolean>(() => undefined);
      return Promise.resolve(fake.available);
    }
  }

  const w = window as unknown as { PublicKeyCredential?: unknown };
  const prevPkc = w.PublicKeyCredential;
  const prevCreds = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  w.PublicKeyCredential = FakePublicKeyCredential;
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });

  fake.restore = () => {
    if (prevPkc === undefined) delete w.PublicKeyCredential;
    else w.PublicKeyCredential = prevPkc;
    if (prevCreds) Object.defineProperty(navigator, 'credentials', prevCreds);
    else delete (navigator as unknown as { credentials?: unknown }).credentials;
  };
  return fake;
}
