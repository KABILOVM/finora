import { describe, expect, it } from 'vitest';
import { VAPID_PUBLIC_KEY_LENGTH, decodeBase64Url, encodeBase64Url, readVapidConfig } from './config';
import { VAPID_PUBLIC, VAPID_PUBLIC_OTHER } from './__fixtures__/pushKit';

const read = (v: unknown) => readVapidConfig({ VITE_VAPID_PUBLIC_KEY: v });

describe('readVapidConfig: публичный ключ VAPID', () => {
  it('настоящий ключ P-256 (87 символов, 65 байт, первый байт 0x04) принимается; ключ и байты согласованы', () => {
    for (const k of [VAPID_PUBLIC, VAPID_PUBLIC_OTHER]) {
      expect(k).toHaveLength(VAPID_PUBLIC_KEY_LENGTH);
      const r = read(k);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.key).toBe(k);
        expect(r.bytes).toHaveLength(65);
        expect(r.bytes[0]).toBe(4);
        expect(encodeBase64Url(r.bytes)).toBe(k);
      }
    }
  });

  it('пробелы вокруг и «=» на конце не мешают', () => {
    expect(read(`  ${VAPID_PUBLIC}\n`)).toMatchObject({ ok: true, key: VAPID_PUBLIC });
    expect(read(`${VAPID_PUBLIC}=`)).toMatchObject({ ok: true, key: VAPID_PUBLIC });
  });

  it('нет переменной, пустая, из пробелов или не строка — «не настроено» (missing), без падения', () => {
    for (const v of [undefined, null, '', '   ', 5, {}, [], true]) expect(read(v)).toEqual({ ok: false, reason: 'missing' });
    expect(readVapidConfig({})).toEqual({ ok: false, reason: 'missing' });
  });

  it('заготовка, неверная длина, чужие символы, не точка P-256 — «неверно» (invalid)', () => {
    const bad = [
      'YOUR-VAPID-PUBLIC-KEY',
      'BXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      VAPID_PUBLIC.slice(0, 86),
      `${VAPID_PUBLIC}A`,
      VAPID_PUBLIC.slice(0, 80) + '!!!!!!!',
      `${VAPID_PUBLIC.slice(0, 40)} ${VAPID_PUBLIC.slice(41)}`,
      // первый байт не 0x04 (сжатая точка): 'A' + остаток даёт 0x00… как первый байт
      `A${VAPID_PUBLIC.slice(1)}`,
    ];
    for (const v of bad) expect(read(v), v).toEqual({ ok: false, reason: 'invalid' });
  });

  it('ПРИВАТНЫЙ ключ (32 байта, 43 символа) не принимается как публичный и нигде не возвращается', () => {
    const privateKey = '6OXgJM2SnqF2WiwqdpJHGiNHUdJCB39EBDG87CDgsqo';
    expect(privateKey).toHaveLength(43);
    const r = read(privateKey);
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(JSON.stringify(r)).not.toContain(privateKey);
  });
});

describe('base64url', () => {
  it('туда и обратно, в том числе байты 0xfb 0xff (символы - и _)', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00, 1, 2, 3]);
    const s = encodeBase64Url(bytes);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(decodeBase64Url(s)!)).toEqual(Array.from(bytes));
  });
  it('мусор — null, а не исключение', () => {
    expect(decodeBase64Url('a')).toBeNull(); // длина 1 по модулю 4 невозможна
    expect(decodeBase64Url('ab$d')).toBeNull();
    expect(decodeBase64Url('')).toEqual(new Uint8Array());
  });
});
