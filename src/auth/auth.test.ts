import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeAuthError, isNetworkError, NO_CONNECTION_TEXT } from './authErrors';
import { isSafeUserId, LOCAL_USER_ID, readCloudConfig } from './config';
import { LAST_USER_KEY, clearLastUser, readLastUser, writeLastUser } from './lastUser';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from './passwordRules';

describe('readCloudConfig', () => {
  const url = 'https://abcdefgh.supabase.co';

  it('есть адрес и ключ — облако настроено', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' })).toEqual({
      url,
      anonKey: 'sb_publishable_abc',
    });
  });

  it('убирает пробелы и хвостовой слэш', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: ` ${url}/ `, VITE_SUPABASE_ANON_KEY: ' key123 ' })).toEqual({ url, anonKey: 'key123' });
  });

  it.each([
    [{}, 'ничего не задано'],
    [{ VITE_SUPABASE_URL: url }, 'нет ключа'],
    [{ VITE_SUPABASE_ANON_KEY: 'k' }, 'нет адреса'],
    [{ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, 'пустые значения'],
    [{ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: 'k' }, 'адрес из пробелов'],
    [{ VITE_SUPABASE_URL: 'не адрес', VITE_SUPABASE_ANON_KEY: 'k' }, 'мусор вместо адреса'],
    [{ VITE_SUPABASE_URL: 'ftp://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }, 'не http(s)'],
    [{ VITE_SUPABASE_URL: 'javascript:alert(1)', VITE_SUPABASE_ANON_KEY: 'k' }, 'опасная схема'],
    [{ VITE_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_xxx' }, 'заготовка из .env.example'],
    [{ VITE_SUPABASE_URL: 123, VITE_SUPABASE_ANON_KEY: {} }, 'не строки'],
  ])('%j → локальный режим (%s)', (env) => {
    expect(readCloudConfig(env)).toBeNull();
  });
});

describe('isSafeUserId', () => {
  it('принимает обычные id и фиксированный локальный', () => {
    expect(isSafeUserId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isSafeUserId(LOCAL_USER_ID)).toBe(true);
  });
  it.each([[''], ['   '], ['a\u0000b'], ['x'.repeat(129)], [null], [undefined], [42], [{}]])('отвергает %j', (v) => {
    expect(isSafeUserId(v)).toBe(false);
  });
});

describe('lastUser', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('записывает и читает', () => {
    writeLastUser({ id: 'u-1', email: 'a@b.c' });
    expect(readLastUser()).toEqual({ id: 'u-1', email: 'a@b.c' });
    expect(JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? '')).toEqual({ id: 'u-1', email: 'a@b.c' });
  });

  it('clearLastUser забывает', () => {
    writeLastUser({ id: 'u-1', email: 'a@b.c' });
    clearLastUser();
    expect(readLastUser()).toBeNull();
  });

  it.each([['не json'], ['null'], ['[]'], ['{"id":""}'], ['{"id":5}'], ['{"email":"x"}'], ['"строка"']])('битая запись %s → null', (raw) => {
    localStorage.setItem(LAST_USER_KEY, raw);
    expect(readLastUser()).toBeNull();
  });

  it('если localStorage выбрасывает ошибки — не падает', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('запрещено');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('запрещено');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('запрещено');
    });
    expect(readLastUser()).toBeNull();
    expect(() => writeLastUser({ id: 'u', email: '' })).not.toThrow();
    expect(() => clearLastUser()).not.toThrow();
  });
});

describe('checkNewPassword', () => {
  it('короткий пароль', () => {
    expect(checkNewPassword('1234567', '1234567')).toContain(String(MIN_PASSWORD_LENGTH));
  });
  it('ровно 8 символов проходит', () => {
    expect(checkNewPassword('12345678', '12345678')).toBeNull();
  });
  it('повтор не совпадает', () => {
    expect(checkNewPassword('12345678', '12345679')).toBe('Пароли не совпадают');
  });
  it('одни пробелы — не пароль', () => {
    expect(checkNewPassword('        ', '        ')).toContain('пробел');
  });
});

describe('describeAuthError', () => {
  const err = (name: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { name, ...extra });

  it('неверный пароль → по-русски', () => {
    expect(describeAuthError(err('AuthApiError', 'Invalid login credentials', { status: 400, code: 'invalid_credentials' }), 'sign-in')).toBe(
      'Неверная почта или пароль',
    );
    expect(describeAuthError(err('AuthApiError', 'Invalid login credentials'), 'sign-in')).toBe('Неверная почта или пароль');
  });

  it('нет сети при входе → точная фраза про первый вход', () => {
    expect(describeAuthError(err('AuthRetryableFetchError', 'Failed to fetch', { status: 0 }), 'sign-in')).toBe(NO_CONNECTION_TEXT);
    expect(describeAuthError(new TypeError('Failed to fetch'), 'sign-in')).toBe(NO_CONNECTION_TEXT);
    expect(NO_CONNECTION_TEXT).toBe('Нет связи: для первого входа нужен интернет');
  });

  it('нет сети при смене пароля — другая фраза (не про вход)', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'), 'password')).toBe('Нет связи. Проверьте интернет и повторите.');
  });

  it.each([
    [err('AuthApiError', 'Email not confirmed', { code: 'email_not_confirmed' }), 'не подтверждена'],
    [err('AuthApiError', 'x', { status: 429 }), 'Слишком много попыток'],
    [err('AuthApiError', 'x', { code: 'over_request_rate_limit' }), 'Слишком много попыток'],
    [err('AuthApiError', 'x', { code: 'same_password' }), 'совпадает со старым'],
    [err('AuthApiError', 'x', { code: 'weak_password' }), 'слишком простой'],
    [err('AuthSessionMissingError', 'Auth session missing!'), 'Сессия закончилась'],
    [err('AuthApiError', 'x', { status: 503 }), 'Сервер сейчас недоступен'],
    [err('AuthApiError', 'x', { code: 'user_banned' }), 'отключён'],
  ])('%#: понятный русский текст', (e, part) => {
    expect(describeAuthError(e, 'other')).toContain(part);
  });

  it('неизвестная ошибка — общий русский текст, без английского', () => {
    const text = describeAuthError(err('AuthApiError', 'Something exotic happened', { status: 400 }), 'sign-in');
    expect(text).toBe('Не удалось войти. Попробуйте ещё раз.');
    expect(/[a-z]{4}/i.test(text)).toBe(false);
    expect(describeAuthError(null, 'password')).toBe('Не удалось сменить пароль. Попробуйте ещё раз.');
    expect(describeAuthError('строка', 'other')).toBe('Что-то пошло не так. Попробуйте ещё раз.');
  });

  it('isNetworkError различает сеть и отказ сервера', () => {
    expect(isNetworkError(err('AuthRetryableFetchError', 'x'))).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkError(err('AuthApiError', 'Invalid login credentials', { status: 400 }))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
