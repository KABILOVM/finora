import { afterEach, describe, expect, it } from 'vitest';
import { NO_CONNECTION_TEXT } from './authErrors';
import {
  classifyCodeRequestError,
  CODE_MAX_LENGTH,
  CODE_MIN_LENGTH,
  CODE_WRONG_TEXT,
  describeCodeVerifyError,
  extractCode,
  isCodeComplete,
  isPlausibleEmail,
  normalizeEmail,
  RATE_LIMIT_TEXT,
  SERVER_DOWN_TEXT,
} from './emailCode';

const err = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message ?? '')), fields);

afterEach(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }));

describe('normalizeEmail', () => {
  it('убирает пробелы, невидимые символы и приводит к строчным', () => {
    expect(normalizeEmail('  Name@Example.COM ')).toBe('name@example.com');
    expect(normalizeEmail('​name@example.com﻿')).toBe('name@example.com');
    expect(normalizeEmail('name＠example.com')).toBe('name@example.com'); // полноширинная «@»
  });

  it('убирает ВСЕ невидимые символы категории «формат» (Cf), а не только известный список', () => {
    // нулевая ширина, метки направления (в том числе изоляты U+2066–2069 и арабская метка U+061C), мягкий перенос, BOM, невидимые знаки
    // математики, метки языка (теги), монгольский разделитель
    const invisible = ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u202A', '\u202E', '\u2060', '\u2064', '\u2066', '\u2067', '\u2068', '\u2069', '\u061C', '\u00AD', '\u180E', '\uFEFF', '\u{E0041}'];
    for (const ch of invisible) {
      const name = `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`;
      expect(normalizeEmail(`${ch}user@example.com${ch}`), `${name} по краям`).toBe('user@example.com');
      expect(normalizeEmail(`us${ch}er@exam${ch}ple.com`), `${name} внутри`).toBe('user@example.com');
    }
    expect(normalizeEmail('\u2066 \u00AD Name@Example.COM \u2069')).toBe('name@example.com'); // и пробелы вперемешку
  });

  it('видимые символы не трогает: цифры, плюс-адрес, кириллица, пробел внутри остаётся (и адрес становится негодным)', () => {
    expect(normalizeEmail('name+tag@example.org')).toBe('name+tag@example.org');
    expect(normalizeEmail('Имя@Пример.РФ')).toBe('имя@пример.рф');
    expect(normalizeEmail('a b@c.de')).toBe('a b@c.de');
    expect(isPlausibleEmail(normalizeEmail('a b@c.de'))).toBe(false);
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail('\u200B\u2066')).toBe('');
  });
});

describe('isPlausibleEmail', () => {
  it.each(['a@b.co', 'name.surname+tag@example.org', 'имя@пример.рф', 'x@sub.example.co.uk'])('принимает %s', (e) => {
    expect(isPlausibleEmail(e)).toBe(true);
  });
  it.each(['', 'a', 'a@b', 'a@b.c', '@b.co', 'a@.co', 'a@b..co', 'a b@c.com', 'a@@b.co', 'a@b.co ', `${'x'.repeat(250)}@b.co`])('отвергает %j', (e) => {
    expect(isPlausibleEmail(e)).toBe(false);
  });
});

describe('extractCode: что остаётся в поле кода', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    ['123–456', '123456'],
    [' 12 34 56 ', '123456'],
    ['123.456', '123456'],
    ['１２３４５６', '123456'], // полноширинные цифры
    ['12345678', '12345678'],
    ['1234567890123', '1234567890'], // длиннее предела — обрезаем
    ['', ''],
    ['abc', ''],
    ['12a34b56', '123456'],
  ])('%j → %j', (raw, expected) => {
    expect(extractCode(raw)).toBe(expected);
  });

  it('кусок письма: берёт группу цифр длиной с код, а не все цифры подряд', () => {
    expect(extractCode('Ваш код: 123 456. Он действует 60 минут.')).toBe('123456');
    expect(extractCode('Your code is 654321')).toBe('654321');
  });

  it('невидимые символы из письма не мешают', () => {
    expect(extractCode('​123 456​')).toBe('123456');
  });
});

describe('isCodeComplete', () => {
  it('от минимальной до максимальной длины, только цифры', () => {
    expect(isCodeComplete('1'.repeat(CODE_MIN_LENGTH - 1))).toBe(false);
    expect(isCodeComplete('1'.repeat(CODE_MIN_LENGTH))).toBe(true);
    expect(isCodeComplete('1'.repeat(CODE_MAX_LENGTH))).toBe(true);
    expect(isCodeComplete('1'.repeat(CODE_MAX_LENGTH + 1))).toBe(false);
    expect(isCodeComplete('12345a')).toBe(false);
    expect(isCodeComplete('')).toBe(false);
  });
});

describe('classifyCodeRequestError: защита от перебора адресов', () => {
  const neutral = [
    err({ code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' }),
    err({ code: 'signup_disabled', status: 422, message: 'Signups not allowed for this instance' }),
    err({ code: 'user_not_found', status: 404, message: 'User not found' }),
    err({ status: 422, message: 'Signups not allowed for otp' }),
    err({ code: 'email_address_invalid', status: 400, message: 'Email address "x@y.zz" is invalid' }),
    err({ code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' }),
    err({ code: 'validation_failed', status: 422, message: 'Unable to validate email address' }),
    err({ status: 400, message: 'что-то непонятное про адрес' }),
    // пауза между письмами для ОДНОЙ почты показывает, что почта есть, — тоже нейтральна
    err({ code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 42 seconds.' }),
  ];
  it.each(neutral.map((e) => [e.message || String(e.status), e] as const))('нейтральный ответ: %s', (_name, e) => {
    expect(classifyCodeRequestError(e)).toEqual({ kind: 'neutral' });
  });

  it('честно: нет сети, слишком много попыток, сервер недоступен, вход по почте отключён', () => {
    expect(classifyCodeRequestError(err({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }))).toEqual({
      kind: 'error',
      message: NO_CONNECTION_TEXT,
    });
    expect(classifyCodeRequestError(new TypeError('Load failed'))).toEqual({ kind: 'error', message: NO_CONNECTION_TEXT });
    expect(classifyCodeRequestError(err({ code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached' }))).toEqual({
      kind: 'error',
      message: RATE_LIMIT_TEXT,
    });
    expect(classifyCodeRequestError(err({ code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' }))).toEqual({
      kind: 'error',
      message: RATE_LIMIT_TEXT,
    });
    expect(classifyCodeRequestError(err({ status: 429, message: 'x' }))).toEqual({ kind: 'error', message: RATE_LIMIT_TEXT });
    expect(classifyCodeRequestError(err({ status: 500, message: 'boom' }))).toEqual({ kind: 'error', message: SERVER_DOWN_TEXT });
    expect(classifyCodeRequestError(err({ status: 503, message: 'x' }))).toEqual({ kind: 'error', message: SERVER_DOWN_TEXT });
    // supabase-js отдаёт 502/503/504 тем же классом, что и «нет сети»: различаем по коду ответа
    expect(classifyCodeRequestError(err({ name: 'AuthRetryableFetchError', status: 503, message: 'upstream' }))).toEqual({ kind: 'error', message: SERVER_DOWN_TEXT });
    const disabled = classifyCodeRequestError(err({ code: 'email_provider_disabled', status: 422, message: 'Email logins are disabled' }));
    expect(disabled.kind).toBe('error');
  });

  it('браузер офлайн и ошибка без кода — «нет связи»', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(classifyCodeRequestError(err({ message: 'что угодно' }))).toEqual({ kind: 'error', message: NO_CONNECTION_TEXT });
  });

  it('непонятная ошибка без статуса и 401 (ключ приложения не принят) — не «нейтральный успех»: человек узнаёт, что не вышло', () => {
    expect(classifyCodeRequestError(err({ message: 'weird' })).kind).toBe('error');
    expect(classifyCodeRequestError(err({ status: 401, message: 'Invalid API key' })).kind).toBe('error');
    expect(classifyCodeRequestError(undefined).kind).toBe('error');
    expect(classifyCodeRequestError('строка').kind).toBe('error');
  });

  it('в тексте ответа нет ни почты, ни кода из ошибки сервера', () => {
    const e = err({ code: 'over_request_rate_limit', status: 429, message: 'limit for secret.person@example.org code 123456' });
    const out = classifyCodeRequestError(e);
    expect(JSON.stringify(out)).not.toMatch(/secret|example\.org|123456/);
  });
});

describe('describeCodeVerifyError', () => {
  it.each([
    [err({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' }), CODE_WRONG_TEXT],
    [err({ status: 422, message: 'Token has expired or is invalid' }), CODE_WRONG_TEXT],
    [err({ status: 400, message: 'Verify requires a verification type' }), CODE_WRONG_TEXT],
    [err({ code: 'over_request_rate_limit', status: 429, message: 'x' }), RATE_LIMIT_TEXT],
    [err({ status: 429, message: 'x' }), RATE_LIMIT_TEXT],
    [err({ status: 500, message: 'x' }), SERVER_DOWN_TEXT],
    [err({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }), NO_CONNECTION_TEXT],
    [err({ name: 'AuthRetryableFetchError', status: 502, message: 'bad gateway' }), SERVER_DOWN_TEXT],
  ])('%#', (e, expected) => {
    expect(describeCodeVerifyError(e)).toBe(expected);
  });

  it('аккаунт отключён — отдельный понятный текст; неизвестное — общий', () => {
    expect(describeCodeVerifyError(err({ code: 'user_banned', status: 403, message: 'User is banned' }))).toMatch(/отключён/);
    expect(describeCodeVerifyError(err({ message: 'странное' }))).toBe('Не удалось войти. Попробуйте ещё раз.');
    expect(describeCodeVerifyError(err({ status: 401, message: 'Invalid API key' }))).toBe('Не удалось войти. Попробуйте ещё раз.');
  });

  it('текст ошибки не содержит ни почты, ни кода', () => {
    const e = err({ code: 'otp_expired', status: 403, message: 'Token 123456 for a@b.co has expired or is invalid' });
    expect(describeCodeVerifyError(e)).not.toMatch(/123456|a@b\.co/);
  });
});
