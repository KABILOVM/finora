/**
 * ЛОМАТЕЛЬ: вход по коду на почту, но с НАСТОЯЩИМ клиентом supabase-js (подменён только fetch): ответы сервера GoTrue
 * разбирает сама библиотека, а не подделка из otpTestkit. Так видно, что приложение читает настоящие поля ошибок.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@/components/testUtils';
import { AuthProvider, useAuth, type AuthApi } from './AuthProvider';
import { NO_CONNECTION_TEXT } from './authErrors';
import { CODE_SENT_TEXT, CODE_WRONG_TEXT, RATE_LIMIT_TEXT, SERVER_DOWN_TEXT, normalizeEmail } from './emailCode';

const USER = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48';

type Reply = { status: number; body?: unknown; raw?: string; contentType?: string } | 'network';

function clientWith(reply: Reply): { client: SupabaseClient; calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user') || url.includes('/token?')) return new Response('{}', { status: 200 });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      body = {};
    }
    calls.push({ url, body });
    if (reply === 'network') throw new TypeError('Failed to fetch');
    const text = reply.raw ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status, headers: { 'content-type': reply.contentType ?? 'application/json' } });
  };
  const client = createClient('https://example-ref.supabase.co', 'sb_publishable_FAKEKEYFORTESTING0123456789', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch as typeof fetch },
  });
  return { client, calls };
}

function mountAuth(client: SupabaseClient) {
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

async function request(reply: Reply) {
  const { client, calls } = clientWith(reply);
  const auth = mountAuth(client);
  await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  let result: Awaited<ReturnType<AuthApi['requestEmailCode']>> | undefined;
  await act(async () => {
    result = await auth.api.requestEmailCode('someone@example.org');
  });
  return { result: result!, calls };
}

async function verify(reply: Reply, code = '123456') {
  const { client } = clientWith(reply);
  const auth = mountAuth(client);
  await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  let result: Awaited<ReturnType<AuthApi['verifyEmailCode']>> | undefined;
  await act(async () => {
    result = await auth.api.verifyEmailCode('someone@example.org', code);
  });
  return { result: result!, auth };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.restoreAllMocks();
});

describe('ATTACK: настоящие ответы GoTrue → запрос кода', () => {
  it('в запрос уходит create_user:false и почта (регистрации нет)', async () => {
    const { result, calls } = await request({ status: 200, body: {} });
    expect(result).toEqual({ ok: true });
    const otp = calls.find((c) => c.url.endsWith('/auth/v1/otp'));
    expect(otp?.body.create_user).toBe(false);
    expect(otp?.body.email).toBe('someone@example.org');
  });

  // Все эти ответы на самом деле бывают у GoTrue для «такой почты нет / нельзя»: человек не должен их отличать от успеха.
  it.each([
    ['otp_disabled 422', { status: 422, body: { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' } }],
    ['otp_disabled 400 (старые версии)', { status: 400, body: { code: 400, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' } }],
    ['user_not_found 404', { status: 404, body: { code: 404, error_code: 'user_not_found', msg: 'User not found' } }],
    ['signup_disabled 422', { status: 422, body: { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' } }],
    ['email_address_not_authorized 400', { status: 400, body: { code: 400, error_code: 'email_address_not_authorized', msg: 'Email address "x@y.zz" cannot be used as it is not authorized' } }],
    ['email_address_invalid 400', { status: 400, body: { code: 400, error_code: 'email_address_invalid', msg: 'Email address "x@y.zz" is invalid' } }],
    ['validation_failed 422', { status: 422, body: { code: 422, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' } }],
    ['пауза между письмами 429', { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 42 seconds.' } }],
    ['старый формат ответа без error_code', { status: 422, body: { error: 'unprocessable_entity', error_description: 'Signups not allowed for otp' } }],
    ['пользователь заблокирован 403', { status: 403, body: { code: 403, error_code: 'user_banned', msg: 'User is banned' } }],
  ] as Array<[string, Reply]>)('%s — как успех, без отличий', async (_name, reply) => {
    const { result } = await request(reply);
    expect(result).toEqual({ ok: true });
  });

  it.each([
    ['лимит по адресу/ключу 429', { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } }, RATE_LIMIT_TEXT],
    ['общий лимит писем 429', { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' } }, RATE_LIMIT_TEXT],
    ['сервер упал 500', { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'Error sending magic link email' } }, SERVER_DOWN_TEXT],
    ['шлюз 502 (страница-заглушка)', { status: 502, raw: '<html>Bad gateway</html>', contentType: 'text/html' }, SERVER_DOWN_TEXT],
    ['503', { status: 503, body: { msg: 'unavailable' } }, SERVER_DOWN_TEXT],
    ['нет сети', 'network', NO_CONNECTION_TEXT],
  ] as Array<[string, Reply, string]>)('честная ошибка: %s', async (_name, reply, text) => {
    const { result } = await request(reply);
    expect(result).toEqual({ ok: false, message: text });
  });

  it('429 от защиты хостинга (HTML вместо JSON) — не принимается за успех и не маскируется под лимит писем', async () => {
    const { result } = await request({ status: 429, raw: '<html>Too many requests</html>', contentType: 'text/html' });
    expect(result.ok).toBe(false);
  });

  it('тексты ошибок не содержат ни почту, ни английские тексты сервера', async () => {
    const replies: Reply[] = [
      { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached for someone@example.org' } },
      { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'smtp error for someone@example.org' } },
      { status: 401, body: { code: 401, error_code: 'no_authorization', msg: 'No API key found in request someone@example.org' } },
    ];
    for (const r of replies) {
      const { result } = await request(r);
      if (!result.ok) {
        expect(result.message).not.toMatch(/someone@example\.org|rate limit|smtp|API key/i);
        expect(result.message).toMatch(/[А-Яа-я]/);
      }
    }
    expect(CODE_SENT_TEXT).toMatch(/Если такая почта есть/);
  });
});

describe('ATTACK: настоящие ответы GoTrue → проверка кода', () => {
  it.each([
    ['otp_expired 403', { status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } }],
    ['otp_expired 400 (старые версии)', { status: 400, body: { code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } }],
    ['без error_code', { status: 403, body: { error: 'access_denied', error_description: 'Email link is invalid or has expired' } }],
    ['validation_failed 422', { status: 422, body: { code: 422, error_code: 'validation_failed', msg: 'Verify requires a verification type' } }],
  ] as Array<[string, Reply]>)('неверный/просроченный код: %s → одно и то же сообщение', async (_n, reply) => {
    const { result, auth } = await verify(reply);
    expect(result).toEqual({ ok: false, message: CODE_WRONG_TEXT });
    expect(auth.api.state.status).toBe('signed-out');
  });

  it('успех без токенов (пользователь есть, сессии нет) — это НЕ вход', async () => {
    const { result, auth } = await verify({ status: 200, body: { user: { id: USER, email: 'someone@example.org' } } });
    expect(result.ok).toBe(false);
    expect(auth.api.state.status).toBe('signed-out');
  });

  it('успех с токенами — вход выполнен', async () => {
    const session = {
      access_token: 'a.b.c',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'r',
      user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'someone@example.org', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    };
    const { result, auth } = await verify({ status: 200, body: session });
    expect(result).toEqual({ ok: true });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
  });
});

describe('ATTACK: вставка мусора', () => {
  it('невидимые символы направления текста (U+2066–U+2069, U+061C) и мягкий перенос не должны остаться в почте', () => {
    // Такие метки приезжают при копировании адреса из чатов и контактов. Если они остались, сервер ответит «адрес неверный»,
    // а человек увидит «код отправлен» (ответ намеренно нейтральный) и будет ждать письма, которого не будет.
    for (const ch of ['⁦', '⁧', '⁨', '⁩', '؜', '­']) {
      expect(normalizeEmail(`${ch}user@example.com${ch}`), `символ U+${ch.codePointAt(0)!.toString(16).toUpperCase()} остался в почте`).toBe('user@example.com');
    }
  });
});
