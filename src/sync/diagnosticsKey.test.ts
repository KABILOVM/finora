import { describe, expect, it } from 'vitest';
import { classifyApiKey, secretKeyMessage } from './diagnosticsKey';

const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
/** Ключ старого образца: JWT с ролью в середине. */
const jwt = (payload: unknown) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;

describe('classifyApiKey: какой ключ лежит в сборке', () => {
  it.each([
    ['старый anon (JWT, role=anon)', jwt({ iss: 'supabase', role: 'anon' }), 'public'],
    ['старый service_role (JWT, role=service_role)', jwt({ iss: 'supabase', role: 'service_role' }), 'secret'],
    ['новый publishable', 'sb_publishable_AbCdEf123456', 'public'],
    ['новый secret', 'sb_secret_AbCdEf123456', 'secret'],
    ['ключ с пробелами и переводом строки по краям', `  ${jwt({ role: 'service_role' })}\n`, 'secret'],
    ['JWT с другой ролью — не утверждаем ничего', jwt({ role: 'authenticated' }), 'unknown'],
    ['JWT без роли', jwt({ iss: 'supabase' }), 'unknown'],
    ['середина JWT не JSON', `${b64('{}')}.${b64('не json')}.x`, 'unknown'],
    ['середина JWT — не объект', `${b64('{}')}.${b64('42')}.x`, 'unknown'],
    ['роль не строка', jwt({ role: 5 }), 'unknown'],
    ['мусор', 'абракадабра', 'unknown'],
    ['пустая строка', '', 'unknown'],
    ['две части вместо трёх', 'aaa.bbb', 'unknown'],
  ])('%s → %s', (_name, key, kind) => {
    expect(classifyApiKey(key)).toBe(kind);
  });

  it.each([[undefined], [null], [42], [{}], [['sb_secret_x']]])('не строка (%s) → unknown, без исключения', (v) => {
    expect(classifyApiKey(v)).toBe('unknown');
  });
});

describe('secretKeyMessage', () => {
  it('для секретного ключа: тревога по-русски с понятным действием, самого ключа в тексте нет', () => {
    const key = jwt({ iss: 'supabase', role: 'service_role', ref: 'abcdefgh' });
    const msg = secretKeyMessage(key) ?? '';
    expect(msg).toContain('service_role');
    expect(msg).toContain('ОПАСНО');
    expect(msg).toContain('VITE_SUPABASE_ANON_KEY');
    expect(msg).toContain('пересоберите');
    for (const part of key.split('.')) expect(msg).not.toContain(part);
    expect(secretKeyMessage('sb_secret_AbCdEf123456')).not.toContain('AbCdEf123456');
  });

  it('для публичного и неопределённого ключа молчит', () => {
    expect(secretKeyMessage(jwt({ role: 'anon' }))).toBeNull();
    expect(secretKeyMessage('sb_publishable_x1')).toBeNull();
    expect(secretKeyMessage(undefined)).toBeNull();
    expect(secretKeyMessage('что-то')).toBeNull();
  });
});
