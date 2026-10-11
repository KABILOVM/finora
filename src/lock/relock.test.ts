import { describe, expect, it } from 'vitest';
import { shouldLockOnReturn } from './relock';

describe('shouldLockOnReturn: закрывать ли замок при возвращении', () => {
  const T = 1_000_000;
  it('«сразу» (0) — всегда', () => {
    expect(shouldLockOnReturn(T, T, 0)).toBe(true);
    expect(shouldLockOnReturn(T, T + 10, 0)).toBe(true);
  });

  it('через минуту: до границы не закрываем, на границе и после — закрываем', () => {
    expect(shouldLockOnReturn(T, T + 59_999, 60)).toBe(false);
    expect(shouldLockOnReturn(T, T + 60_000, 60)).toBe(true);
    expect(shouldLockOnReturn(T, T + 61_000, 60)).toBe(true);
    expect(shouldLockOnReturn(T, T + 299_999, 300)).toBe(false);
    expect(shouldLockOnReturn(T, T + 300_000, 300)).toBe(true);
  });

  it('при сомнении закрываем: не знаем, когда скрыли; не числа; часы ушли назад', () => {
    expect(shouldLockOnReturn(null, T, 60)).toBe(true);
    expect(shouldLockOnReturn(NaN, T, 60)).toBe(true);
    expect(shouldLockOnReturn(T, NaN, 60)).toBe(true);
    expect(shouldLockOnReturn(Infinity, T, 300)).toBe(true);
    expect(shouldLockOnReturn(T, T - 1, 300)).toBe(true);
    expect(shouldLockOnReturn(T, T - 10 * 60_000, 60)).toBe(true);
  });

  it('вернулись мгновенно (0 мс) при grace > 0 — не закрываем', () => {
    expect(shouldLockOnReturn(T, T, 60)).toBe(false);
  });
});
