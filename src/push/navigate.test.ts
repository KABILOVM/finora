import { describe, expect, it } from 'vitest';
import { BAD_PATHS, GOOD_PATHS } from './__fixtures__/paths';
import { MAX_PATH_LENGTH, isSafeAppPath, safeAppPath } from './navigate';

describe('isSafeAppPath / safeAppPath: адрес из push-сообщения', () => {
  it('нормальные внутренние пути проходят без изменений', () => {
    for (const p of GOOD_PATHS) {
      expect(isSafeAppPath(p), p).toBe(true);
      expect(safeAppPath(p), p).toBe(p);
    }
  });

  it('вредные и странные адреса превращаются в «/» (Главная)', () => {
    for (const p of BAD_PATHS) {
      expect(isSafeAppPath(p), String(p)).toBe(false);
      expect(safeAppPath(p), String(p)).toBe('/');
    }
  });

  it('самый длинный допустимый путь проходит, на один символ длиннее — нет', () => {
    expect(isSafeAppPath('/' + 'a'.repeat(MAX_PATH_LENGTH - 1))).toBe(true);
    expect(isSafeAppPath('/' + 'a'.repeat(MAX_PATH_LENGTH))).toBe(false);
  });
});
