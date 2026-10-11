/**
 * Помощник ТОЛЬКО для тестов: подменный вход по коду на почту (signInWithOtp / verifyOtp) поверх fakeAuthClient.
 * Ведёт себя как Supabase: на неизвестную почту при shouldCreateUser:false отвечает ошибкой «регистрация закрыта»,
 * на известную «присылает» код (его можно прочитать из state.codes), проверяет код и открывает сессию.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ALICE, BOB, fakeAuthClient, type FakeAccount, type FakeAuthOptions } from '@/app/testkit';

export type UnknownEmailStyle = 'otp_disabled' | 'user_not_found' | 'signup_disabled' | 'email_address_invalid';

export interface FakeOtpOptions extends FakeAuthOptions {
  /** Длина кода (у Supabase настраивается, по умолчанию 6). */
  codeLength?: number;
}

function authError(name: string, message: string, extra: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { name, ...extra });
}

export function fakeOtpClient(options: FakeOtpOptions = {}) {
  const base = fakeAuthClient(options);
  const accounts: FakeAccount[] = options.accounts ?? [ALICE, BOB];
  const length = options.codeLength ?? 6;
  const state = {
    /** Все запросы кода: что пришло в signInWithOtp. */
    requests: [] as Array<{ email: string; shouldCreateUser: boolean | undefined }>,
    verifies: [] as Array<{ email: string; token: string; type: string }>,
    /** Выданные коды по почте. */
    codes: new Map<string, string>(),
    /** Почты, для которых «создали бы пользователя» (приложение этого делать не должно). */
    created: [] as string[],
    unknownStyle: 'otp_disabled' as UnknownEmailStyle,
    /** Режим сервера на следующие запросы. */
    mode: 'ok' as 'ok' | 'offline' | 'rate' | 'email-rate' | 'server' | 'cooldown',
    /** verifyOtp отвечает успехом без сессии. */
    verifyWithoutSession: false,
    counter: 0,
  };

  const network = () => authError('AuthRetryableFetchError', 'Failed to fetch', { status: 0 });
  const sessionOf = (a: FakeAccount) => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: a.id, email: a.email } });

  const modeError = (): Error | null => {
    switch (state.mode) {
      case 'offline':
        return network();
      case 'rate':
        return authError('AuthApiError', 'Request rate limit reached', { status: 429, code: 'over_request_rate_limit' });
      case 'email-rate':
        return authError('AuthApiError', 'email rate limit exceeded', { status: 429, code: 'over_email_send_rate_limit' });
      case 'server':
        return authError('AuthRetryableFetchError', 'upstream', { status: 503 });
      case 'cooldown':
        return authError('AuthApiError', 'For security purposes, you can only request this after 42 seconds.', { status: 429, code: 'over_email_send_rate_limit' });
      default:
        return null;
    }
  };

  const auth = base.client.auth as unknown as Record<string, unknown>;
  auth.signInWithOtp = async ({ email, options: o }: { email: string; options?: { shouldCreateUser?: boolean } }) => {
    state.requests.push({ email, shouldCreateUser: o?.shouldCreateUser });
    const err = modeError();
    if (err) return { data: { user: null, session: null }, error: err };
    const known = accounts.find((a) => a.email === email);
    if (!known) {
      if (o?.shouldCreateUser === false) {
        const style = state.unknownStyle;
        const e =
          style === 'user_not_found'
            ? authError('AuthApiError', 'User not found', { status: 404, code: 'user_not_found' })
            : style === 'signup_disabled'
              ? authError('AuthApiError', 'Signups not allowed for this instance', { status: 422, code: 'signup_disabled' })
              : style === 'email_address_invalid'
                ? authError('AuthApiError', `Email address "${email}" is invalid`, { status: 400, code: 'email_address_invalid' })
                : authError('AuthApiError', 'Signups not allowed for otp', { status: 422, code: 'otp_disabled' });
        return { data: { user: null, session: null }, error: e };
      }
      state.created.push(email);
    }
    state.counter++;
    state.codes.set(email, String(100000 + state.counter * 7919).padEnd(length, '3').slice(0, length));
    return { data: { user: null, session: null }, error: null };
  };

  auth.verifyOtp = async ({ email, token, type }: { email: string; token: string; type: string }) => {
    state.verifies.push({ email, token, type });
    const err = modeError();
    if (err) return { data: { user: null, session: null }, error: err };
    const account = accounts.find((a) => a.email === email);
    if (!account || type !== 'email' || state.codes.get(email) !== token) {
      return { data: { user: null, session: null }, error: authError('AuthApiError', 'Token has expired or is invalid', { status: 403, code: 'otp_expired' }) };
    }
    state.codes.delete(email); // код одноразовый
    if (state.verifyWithoutSession) return { data: { user: { id: account.id, email: account.email }, session: null }, error: null };
    base.setSession(account);
    base.emit('SIGNED_IN', account);
    const session = sessionOf(account);
    return { data: { user: session.user, session }, error: null };
  };

  return { ...base, client: base.client as SupabaseClient, otp: state };
}
