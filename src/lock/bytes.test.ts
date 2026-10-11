import { describe, expect, it } from 'vitest';
import { fromBase64Url, lockUserHandle, MAX_CREDENTIAL_ID_CHARS, randomChallenge, sameBytes, toBase64Url } from './bytes';

describe('base64url', () => {
  it('туда и обратно, без «=», «+» и «/»', () => {
    for (const len of [1, 2, 3, 4, 5, 16, 32, 64, 100]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 250) % 256);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Array.from(fromBase64Url(text) ?? [])).toEqual(Array.from(bytes));
    }
  });

  it('принимает ArrayBuffer и срез буфера (смещение учитывается)', () => {
    const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const slice = new Uint8Array(big.buffer, 2, 3);
    expect(toBase64Url(slice)).toBe(toBase64Url(new Uint8Array([1, 2, 3])));
    expect(toBase64Url(new Uint8Array([1, 2, 3]).buffer)).toBe(toBase64Url(new Uint8Array([1, 2, 3])));
  });

  it.each([[''], ['a'], ['abcde'], ['ab cd'], ['ab+/'], ['ab=='], ['привет'], ['x'.repeat(MAX_CREDENTIAL_ID_CHARS + 1)]])('не base64url: %j → null', (text) => {
    expect(fromBase64Url(text)).toBeNull();
  });
});

describe('sameBytes', () => {
  it('равные и разные', () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]).buffer)).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe('randomChallenge', () => {
  it('32 байта по умолчанию, каждый раз разные', () => {
    const a = randomChallenge();
    const b = randomChallenge();
    expect(a.byteLength).toBe(32);
    expect(sameBytes(a, b)).toBe(false);
    expect(randomChallenge(16).byteLength).toBe(16);
  });
});

describe('lockUserHandle', () => {
  it('одинаков для одного пользователя, разный для разных, 32 байта, не содержит id в открытом виде', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const a = await lockUserHandle(id);
    const b = await lockUserHandle(id);
    const c = await lockUserHandle('22222222-2222-4222-8222-222222222222');
    expect(a.byteLength).toBe(32);
    expect(sameBytes(a, b)).toBe(true);
    expect(sameBytes(a, c)).toBe(false);
    expect(new TextDecoder().decode(a)).not.toContain(id);
  });
});
