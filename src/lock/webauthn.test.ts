import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBase64Url, sameBytes } from './bytes';
import { installFakeWebAuthn, type FakeWebAuthn } from './fakeWebAuthn';
import {
  createLockCredential,
  failureOf,
  getLockSupport,
  isIosBrowserTab,
  isLockSupported,
  LOCK_FAILURE_TEXT,
  SUPPORT_TEXT,
  verifyLock,
  type DeviceInfo,
} from './webauthn';

let fake: FakeWebAuthn;
beforeEach(() => {
  fake = installFakeWebAuthn();
});
afterEach(() => {
  fake.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const USER = { id: '11111111-1111-4111-8111-111111111111' };

describe('createLockCredential', () => {
  it('просит платформенный ключ с обязательным подтверждением, без почты в данных', async () => {
    const r = await createLockCredential(USER);
    expect(r.ok).toBe(true);
    const pk = fake.createCalls[0]!.publicKey!;
    expect(pk.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' });
    expect(pk.attestation).toBe('none');
    expect(pk.timeout).toBe(60_000);
    expect(pk.rp).toEqual({ name: 'Finora' }); // rp.id не задан: берётся адрес сайта
    expect(pk.pubKeyCredParams.map((p) => p.alg)).toEqual(expect.arrayContaining([-7, -257]));
    expect(new Uint8Array(pk.challenge as ArrayBuffer).byteLength).toBe(32);
    expect(new Uint8Array(pk.user.id as ArrayBuffer).byteLength).toBe(32);
    expect(JSON.stringify([pk.user.name, pk.user.displayName, pk.rp])).not.toMatch(/@|11111111/);
  });

  it('вызов (challenge) каждый раз новый, user.id для одного человека всегда один и тот же, для разных — разный', async () => {
    await createLockCredential(USER);
    await createLockCredential(USER);
    await createLockCredential({ id: '22222222-2222-4222-8222-222222222222' });
    const [a, b, c] = fake.createCalls.map((x) => x.publicKey!);
    expect(sameBytes(a!.challenge as ArrayBuffer, b!.challenge as ArrayBuffer)).toBe(false);
    expect(sameBytes(a!.user.id as ArrayBuffer, b!.user.id as ArrayBuffer)).toBe(true);
    expect(sameBytes(a!.user.id as ArrayBuffer, c!.user.id as ArrayBuffer)).toBe(false);
  });

  it('возвращает идентификатор ключа в base64url', async () => {
    const r = await createLockCredential(USER);
    if (!r.ok) throw new Error('ожидали успех');
    expect(sameBytes(fromBase64Url(r.credentialId)!, fake.keys[0]!)).toBe(true);
  });

  it.each([
    ['decline', 'declined'],
    ['abort', 'declined'],
    ['policy', 'blocked'],
    ['insecure-domain', 'failed'],
  ] as const)('ответ системы %s → причина %s', async (mode, reason) => {
    fake.mode = mode;
    expect(await createLockCredential(USER)).toEqual({ ok: false, reason });
  });

  it('нет WebAuthn → unsupported, без вызовов', async () => {
    fake.restore();
    expect(await createLockCredential(USER)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('параллельные нажатия дают одно окно и один ключ', async () => {
    const [a, b] = await Promise.all([createLockCredential(USER), createLockCredential(USER)]);
    expect(fake.createCalls).toHaveLength(1);
    expect(a).toEqual(b);
    await createLockCredential(USER); // после завершения — снова можно
    expect(fake.createCalls).toHaveLength(2);
  });

  it('запрет настройкой сайта (Permissions-Policy) виден заранее: окно не открываем', async () => {
    Object.defineProperty(document, 'featurePolicy', { value: { allowsFeature: (f: string) => f !== 'publickey-credentials-get' }, configurable: true });
    try {
      expect(await createLockCredential(USER)).toEqual({ ok: false, reason: 'blocked' });
      expect(fake.createCalls).toHaveLength(0);
    } finally {
      delete (document as unknown as { featurePolicy?: unknown }).featurePolicy;
    }
  });
});

describe('verifyLock', () => {
  async function newKey(): Promise<string> {
    const r = await createLockCredential(USER);
    if (!r.ok) throw new Error('не создался ключ');
    return r.credentialId;
  }

  it('успех только по подтверждению; запрос — именно по этому ключу, с обязательным подтверждением', async () => {
    const id = await newKey();
    expect(await verifyLock(id)).toEqual({ ok: true });
    const pk = fake.getCalls[0]!.publicKey!;
    expect(pk.userVerification).toBe('required');
    expect(pk.timeout).toBe(60_000);
    expect(pk.allowCredentials).toHaveLength(1);
    expect(sameBytes(pk.allowCredentials![0]!.id as ArrayBuffer, fake.keys[0]!)).toBe(true);
    expect(new Uint8Array(pk.challenge as ArrayBuffer).byteLength).toBe(32);
  });

  it('вызов каждый раз новый', async () => {
    const id = await newKey();
    await verifyLock(id);
    await verifyLock(id);
    expect(sameBytes(fake.getCalls[0]!.publicKey!.challenge as ArrayBuffer, fake.getCalls[1]!.publicKey!.challenge as ArrayBuffer)).toBe(false);
  });

  it.each([
    ['decline', 'declined'],
    ['abort', 'declined'],
    ['policy', 'blocked'],
    ['no-uv-flag', 'declined'],
    ['wrong-credential', 'failed'],
    ['wrong-challenge', 'failed'],
  ] as const)('режим %s → не открывает, причина %s', async (mode, reason) => {
    const id = await newKey();
    fake.mode = mode;
    expect(await verifyLock(id)).toEqual({ ok: false, reason });
  });

  it('повреждённый идентификатор → failed, система не вызывается', async () => {
    expect(await verifyLock('не base64url!')).toEqual({ ok: false, reason: 'failed' });
    expect(await verifyLock('')).toEqual({ ok: false, reason: 'failed' });
    expect(fake.getCalls).toHaveLength(0);
  });

  it('автозапрос и нажатие кнопки одновременно — одно окно, один результат; потом снова можно', async () => {
    const id = await newKey();
    let release: () => void = () => undefined;
    fake.hold = new Promise<void>((r) => (release = r));
    const auto = verifyLock(id);
    const tap = verifyLock(id);
    release();
    expect(await Promise.all([auto, tap])).toEqual([{ ok: true }, { ok: true }]);
    expect(fake.getCalls).toHaveLength(1);
    fake.hold = null;
    await verifyLock(id);
    expect(fake.getCalls).toHaveLength(2);
  });

  it('система не отвечает дольше срока — запрос отменяется сам (даже если браузер игнорирует сигнал), потом можно пробовать снова', async () => {
    const id = await newKey();
    fake.mode = 'hang';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = verifyLock(id);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(fake.getCalls[0]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(fake.getCalls[0]!.signal!.aborted).toBe(true);
    expect(await p).toEqual({ ok: false, reason: 'declined' });
    fake.mode = 'ok';
    expect(await verifyLock(id)).toEqual({ ok: true }); // не зависло навсегда на старом запросе
  });

  it('нет WebAuthn → unsupported', async () => {
    const id = await newKey();
    fake.restore();
    expect(await verifyLock(id)).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('failureOf', () => {
  it('разбор ошибок браузера; текст ошибки наружу не попадает', () => {
    expect(failureOf({ name: 'NotAllowedError', message: 'timed out' })).toBe('declined');
    expect(failureOf({ name: 'NotAllowedError', message: 'Permissions Policy may be used' })).toBe('blocked');
    expect(failureOf({ name: 'AbortError' })).toBe('declined');
    expect(failureOf({ name: 'NotSupportedError' })).toBe('unsupported');
    expect(failureOf({ name: 'SecurityError' })).toBe('failed');
    expect(failureOf({ name: 'InvalidStateError' })).toBe('failed');
    expect(failureOf(new TypeError('x'))).toBe('failed');
    expect(failureOf(undefined)).toBe('failed');
    expect(failureOf('строка')).toBe('failed');
  });

  it('тексты причин не пустые', () => {
    for (const r of ['declined', 'unsupported', 'blocked', 'failed'] as const) expect(LOCK_FAILURE_TEXT[r].length).toBeGreaterThan(5);
    expect(LOCK_FAILURE_TEXT.declined).toBe('Не подтверждено');
  });
});

describe('getLockSupport', () => {
  it('всё есть — поддерживается', async () => {
    expect(await getLockSupport()).toEqual({ supported: true });
    expect(await isLockSupported()).toBe(true);
  });

  it('нет WebAuthn вовсе', async () => {
    fake.restore();
    expect(await getLockSupport()).toEqual({ supported: false, reason: 'no-webauthn' });
    expect(await isLockSupported()).toBe(false);
  });

  it('устройство без Face ID / отпечатка / кода экрана', async () => {
    fake.available = false;
    expect(await getLockSupport()).toEqual({ supported: false, reason: 'no-authenticator' });
  });

  it('проверка падает или зависает — «не удалось проверить», страница не виснет', async () => {
    fake.available = 'throws';
    expect(await getLockSupport()).toEqual({ supported: false, reason: 'check-failed' });
    fake.available = 'hangs';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = getLockSupport();
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await p).toEqual({ supported: false, reason: 'check-failed' });
  });

  it('незащищённый адрес', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    try {
      expect(await getLockSupport()).toEqual({ supported: false, reason: 'insecure' });
    } finally {
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    }
  });

  it('iPhone во вкладке Safari без поддержки — подсказка «откройте с экрана Домой»; в установленном приложении — просто «не умеет»', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    fake.available = false;
    expect(await getLockSupport()).toEqual({ supported: false, reason: 'ios-browser' });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      expect(await getLockSupport()).toEqual({ supported: false, reason: 'no-authenticator' });
    } finally {
      delete (navigator as unknown as { standalone?: unknown }).standalone;
      ua.mockRestore();
    }
  });

  it('запрет настройкой сайта', async () => {
    Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => false }, configurable: true });
    try {
      expect(await getLockSupport()).toEqual({ supported: false, reason: 'blocked' });
    } finally {
      delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy;
    }
  });

  it('для каждой причины есть человеческий текст', () => {
    for (const r of ['insecure', 'no-webauthn', 'ios-browser', 'no-authenticator', 'blocked', 'check-failed'] as const) {
      expect(SUPPORT_TEXT[r].length).toBeGreaterThan(20);
    }
    expect(SUPPORT_TEXT['ios-browser']).toContain('Домой');
    expect(SUPPORT_TEXT['no-authenticator']).toContain('Это устройство не умеет');
  });
});

describe('isIosBrowserTab', () => {
  const base: DeviceInfo = { userAgent: '', platform: '', maxTouchPoints: 0, standalone: undefined, displayStandalone: false };
  it('iPhone / iPad во вкладке — да; установленное приложение, Android и ПК — нет', () => {
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(true);
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe(true);
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true); // iPad в режиме «как компьютер»
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (iPhone)', standalone: true })).toBe(false);
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (iPhone)', displayStandalone: true })).toBe(false);
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe(false);
    expect(isIosBrowserTab({ ...base, userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  });
});
