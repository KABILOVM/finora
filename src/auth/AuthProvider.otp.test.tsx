import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, BOB } from '@/app/testkit';
import { act, render, waitFor } from '@/components/testUtils';
import { clearLock, lockKey, readLock, writeLock } from '@/lock/lockStore';
import { AuthProvider, useAuth, type AuthApi } from './AuthProvider';
import { NO_CONNECTION_TEXT } from './authErrors';
import { CODE_MISSING_TEXT, CODE_WRONG_TEXT, RATE_LIMIT_TEXT, SERVER_DOWN_TEXT } from './emailCode';
import { readLastUser } from './lastUser';
import { fakeOtpClient, type FakeOtpOptions } from './otpTestkit';

function mountAuth(client: SupabaseClient | null) {
  const holder: { api: AuthApi | null } = { api: null };
  function Probe() {
    holder.api = useAuth();
    return null;
  }
  render(
    <AuthProvider client={client} bootTimeoutMs={50}>
      <Probe />
    </AuthProvider>,
  );
  return {
    get api(): AuthApi {
      if (!holder.api) throw new Error('AuthProvider не отрисован');
      return holder.api;
    },
  };
}

async function setup(opts: FakeOtpOptions = { session: null }) {
  const fake = fakeOtpClient(opts);
  const auth = mountAuth(fake.client);
  await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  return { fake, auth };
}

const SECRET_EMAIL = 'secret.person@example.org';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.restoreAllMocks();
});

describe('requestEmailCode: запрос кода', () => {
  it('просит код у сервера БЕЗ создания пользователя; почта приводится к строчным и очищается', async () => {
    const { fake, auth } = await setup();
    let r: Awaited<ReturnType<AuthApi['requestEmailCode']>> | undefined;
    await act(async () => {
      r = await auth.api.requestEmailCode('  Alice@Example.COM ​');
    });
    expect(r).toEqual({ ok: true });
    expect(fake.otp.requests).toEqual([{ email: ALICE.email, shouldCreateUser: false }]);
    expect(fake.otp.created).toEqual([]);
    expect(auth.api.state.status).toBe('signed-out'); // просто запросили код, не вошли
  });

  it.each(['otp_disabled', 'user_not_found', 'signup_disabled', 'email_address_invalid'] as const)(
    'неизвестная почта (сервер отвечает «%s») — тот же успех, что и для известной',
    async (style) => {
      const { fake, auth } = await setup();
      fake.otp.unknownStyle = style;
      const known = await auth.api.requestEmailCode(ALICE.email);
      const unknown = await auth.api.requestEmailCode('nobody@example.org');
      expect(unknown).toEqual(known);
      expect(unknown).toEqual({ ok: true });
      expect(fake.otp.codes.has('nobody@example.org')).toBe(false); // код при этом не выдан
    },
  );

  it('пауза между письмами для одной почты тоже выглядит как успех', async () => {
    const { fake, auth } = await setup();
    fake.otp.mode = 'cooldown';
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: true });
  });

  it('честные ошибки: нет сети, слишком много попыток (в том числе писем), сервер недоступен', async () => {
    const { fake, auth } = await setup();
    fake.otp.mode = 'offline';
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: false, message: NO_CONNECTION_TEXT });
    fake.otp.mode = 'rate';
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: false, message: RATE_LIMIT_TEXT });
    fake.otp.mode = 'email-rate';
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: false, message: RATE_LIMIT_TEXT });
    fake.otp.mode = 'server';
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: false, message: SERVER_DOWN_TEXT });
  });

  it('сеть бросает исключение (а не возвращает ошибку) — тоже понятный текст, ничего не падает', async () => {
    const { fake, auth } = await setup();
    (fake.client.auth as unknown as { signInWithOtp: () => Promise<never> }).signInWithOtp = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await auth.api.requestEmailCode(ALICE.email)).toEqual({ ok: false, message: NO_CONNECTION_TEXT });
  });

  it('не похоже на почту — сервер не беспокоим', async () => {
    const { fake, auth } = await setup();
    for (const bad of ['', '   ', 'alice', 'alice@', '@example.com', 'a b@example.com']) {
      const r = await auth.api.requestEmailCode(bad);
      expect(r.ok).toBe(false);
    }
    expect(fake.otp.requests).toEqual([]);
  });

  it('локальный режим (облака нет): отказ с понятным текстом', async () => {
    const auth = mountAuth(null);
    const r = await auth.api.requestEmailCode(ALICE.email);
    expect(r.ok).toBe(false);
    expect((await auth.api.verifyEmailCode(ALICE.email, '123456')).ok).toBe(false);
  });

  it('двойное нажатие: два одинаковых запроса подряд — один запрос к серверу и один ответ; после ответа можно снова', async () => {
    const { fake, auth } = await setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.client.auth.signInWithOtp.bind(fake.client.auth);
    vi.spyOn(fake.client.auth, 'signInWithOtp').mockImplementation(async (c) => {
      await gate;
      return real(c);
    });
    const first = auth.api.requestEmailCode(ALICE.email);
    const second = auth.api.requestEmailCode('ALICE@example.com ');
    release();
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(fake.otp.requests).toHaveLength(1);
    await auth.api.requestEmailCode(ALICE.email);
    expect(fake.otp.requests).toHaveLength(2);
  });

  it('другая почта в это же время — отдельный запрос', async () => {
    const { fake, auth } = await setup();
    await Promise.all([auth.api.requestEmailCode(ALICE.email), auth.api.requestEmailCode(BOB.email)]);
    expect(fake.otp.requests.map((r) => r.email).sort()).toEqual([ALICE.email, BOB.email]);
  });
});

describe('verifyEmailCode: проверка кода', () => {
  async function withCode(email = ALICE.email) {
    const ctx = await setup();
    await ctx.auth.api.requestEmailCode(email);
    return { ...ctx, code: ctx.fake.otp.codes.get(email)! };
  }

  it('верный код → вошёл: состояние, запомненный пользователь, запрос с type:email', async () => {
    const { fake, auth, code } = await withCode();
    let r: Awaited<ReturnType<AuthApi['verifyEmailCode']>> | undefined;
    await act(async () => {
      r = await auth.api.verifyEmailCode(ALICE.email, code);
    });
    expect(r).toEqual({ ok: true });
    expect(fake.otp.verifies).toEqual([{ email: ALICE.email, token: code, type: 'email' }]);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    expect(auth.api.user).toEqual({ id: ALICE.id, email: ALICE.email });
    expect(readLastUser()).toEqual({ id: ALICE.id, email: ALICE.email });
  });

  it('код с пробелами и дефисами очищается; почта в другом регистре', async () => {
    const { fake, auth, code } = await withCode();
    const spaced = `${code.slice(0, 3)} - ${code.slice(3)}`;
    await act(async () => void (await auth.api.verifyEmailCode('  ALICE@example.com', spaced)));
    expect(fake.otp.verifies[0]).toEqual({ email: ALICE.email, token: code, type: 'email' });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
  });

  it('код длиннее 6 цифр (у проекта он настроен иначе) принимается', async () => {
    const ctx = await setup({ session: null, codeLength: 8 });
    await ctx.auth.api.requestEmailCode(ALICE.email);
    const code = ctx.fake.otp.codes.get(ALICE.email)!;
    expect(code).toHaveLength(8);
    await act(async () => void (await ctx.auth.api.verifyEmailCode(ALICE.email, code)));
    await waitFor(() => expect(ctx.auth.api.state.status).toBe('signed-in'));
  });

  it('короткий или пустой код: сервер не беспокоим, не угадываем', async () => {
    const { fake, auth } = await withCode();
    for (const bad of ['', '12345', 'abcdef', '  ']) {
      expect(await auth.api.verifyEmailCode(ALICE.email, bad)).toEqual({ ok: false, message: CODE_MISSING_TEXT });
    }
    expect(fake.otp.verifies).toEqual([]);
  });

  it('неверный код: понятный текст, не вошёл, можно повторить верным', async () => {
    const { fake, auth, code } = await withCode();
    expect(await auth.api.verifyEmailCode(ALICE.email, '000000')).toEqual({ ok: false, message: CODE_WRONG_TEXT });
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();
    await act(async () => void (await auth.api.verifyEmailCode(ALICE.email, code)));
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    expect(fake.otp.verifies).toHaveLength(2);
  });

  it('код чужой почты и код неизвестной почты не подходят', async () => {
    const { auth, code } = await withCode();
    expect(await auth.api.verifyEmailCode(BOB.email, code)).toEqual({ ok: false, message: CODE_WRONG_TEXT });
    expect(await auth.api.verifyEmailCode('nobody@example.org', code)).toEqual({ ok: false, message: CODE_WRONG_TEXT });
    expect(auth.api.state.status).toBe('signed-out');
  });

  it('честные ошибки: нет сети, лимит попыток, сервер недоступен', async () => {
    const { fake, auth, code } = await withCode();
    fake.otp.mode = 'offline';
    expect(await auth.api.verifyEmailCode(ALICE.email, code)).toEqual({ ok: false, message: NO_CONNECTION_TEXT });
    fake.otp.mode = 'rate';
    expect(await auth.api.verifyEmailCode(ALICE.email, code)).toEqual({ ok: false, message: RATE_LIMIT_TEXT });
    fake.otp.mode = 'server';
    expect(await auth.api.verifyEmailCode(ALICE.email, code)).toEqual({ ok: false, message: SERVER_DOWN_TEXT });
    expect(auth.api.state.status).toBe('signed-out');
  });

  it('сервер ответил без сессии — это не вход', async () => {
    const { fake, auth, code } = await withCode();
    fake.otp.verifyWithoutSession = true;
    const r = await auth.api.verifyEmailCode(ALICE.email, code);
    expect(r.ok).toBe(false);
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();
  });

  it('двойное нажатие «Войти»: один запрос проверки (код одноразовый — второй был бы отказом)', async () => {
    const { fake, auth, code } = await withCode();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.client.auth.verifyOtp.bind(fake.client.auth);
    vi.spyOn(fake.client.auth, 'verifyOtp').mockImplementation(async (p) => {
      await gate;
      return real(p);
    });
    let results: unknown[] = [];
    await act(async () => {
      const a = auth.api.verifyEmailCode(ALICE.email, code);
      const b = auth.api.verifyEmailCode(ALICE.email, code);
      release();
      results = await Promise.all([a, b]);
    });
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(fake.otp.verifies).toHaveLength(1);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
  });

  it('в сообщениях об ошибках и в консоли нет ни почты, ни кода', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const ctx = await setup({ session: null, accounts: [{ id: ALICE.id, email: SECRET_EMAIL, password: 'x' }] });
    const messages: string[] = [];
    for (const mode of ['ok', 'offline', 'rate', 'email-rate', 'server', 'cooldown'] as const) {
      ctx.fake.otp.mode = mode;
      const a = await ctx.auth.api.requestEmailCode(SECRET_EMAIL);
      if (!a.ok) messages.push(a.message);
      const b = await ctx.auth.api.verifyEmailCode(SECRET_EMAIL, '918273');
      if (!b.ok) messages.push(b.message);
    }
    for (const style of ['otp_disabled', 'user_not_found'] as const) {
      ctx.fake.otp.mode = 'ok';
      ctx.fake.otp.unknownStyle = style;
      const r = await ctx.auth.api.requestEmailCode('nobody.secret@example.org');
      if (!r.ok) messages.push(r.message);
    }
    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) expect(m).not.toMatch(/secret|example\.org|918273/i);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret|example\.org|918273/i);
  });
});

describe('вход по коду и «замок»', () => {
  async function signInAs(account = ALICE) {
    const ctx = await setup();
    await ctx.auth.api.requestEmailCode(account.email);
    await act(async () => void (await ctx.auth.api.verifyEmailCode(account.email, ctx.fake.otp.codes.get(account.email)!)));
    await waitFor(() => expect(ctx.auth.api.state.status).toBe('signed-in'));
    return ctx;
  }
  const lock = { credentialId: 'AbCd_-0123', enabledAt: '2026-10-11T08:00:00.000Z', graceSeconds: 60 as const };

  it('выход снимает замок ЭТОГО пользователя и не трогает чужие', async () => {
    const { auth } = await signInAs(ALICE);
    writeLock(ALICE.id, lock);
    writeLock(BOB.id, lock);
    await act(async () => void (await auth.api.signOut()));
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLock(ALICE.id)).toEqual({ kind: 'off' });
    expect(readLock(BOB.id).kind).toBe('on');
    clearLock(BOB.id);
  });

  it('выход снимает и повреждённую запись замка', async () => {
    const { auth } = await signInAs(ALICE);
    localStorage.setItem(lockKey(ALICE.id), '{битый');
    await act(async () => void (await auth.api.signOut()));
    expect(localStorage.getItem(lockKey(ALICE.id))).toBeNull();
  });
});
