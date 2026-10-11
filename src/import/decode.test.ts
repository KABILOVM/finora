import { describe, expect, it } from 'vitest';
import { decodeBytes } from './decode';
import { ImportFileError } from './types';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Windows-1251: А–я = 0xC0–0xFF, Ё = 0xA8, ё = 0xB8. */
function cp1251(s: string): Uint8Array {
  return Uint8Array.from(Array.from(s), (ch) => {
    const c = ch.charCodeAt(0);
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (c === 0x401) return 0xa8;
    if (c === 0x451) return 0xb8;
    throw new Error(`нет в cp1251: ${ch}`);
  });
}

describe('decodeBytes', () => {
  it('UTF-8 без метки', () => {
    expect(decodeBytes(utf8('Дата;Счёт'))).toEqual({ text: 'Дата;Счёт', encoding: 'utf-8' });
  });

  it('UTF-8 с BOM: метка убирается', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Дата')]);
    expect(decodeBytes(bytes)).toEqual({ text: 'Дата', encoding: 'utf-8' });
  });

  it('UTF-16 LE и BE с меткой', () => {
    const le = new Uint8Array([0xff, 0xfe, ...[...'Дата'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    const be = new Uint8Array([0xfe, 0xff, ...[...'Дата'].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])]);
    expect(decodeBytes(le)).toEqual({ text: 'Дата', encoding: 'utf-16le' });
    expect(decodeBytes(be)).toEqual({ text: 'Дата', encoding: 'utf-16be' });
  });

  it('Windows-1251 (Excel): байты не похожи на UTF-8 — читаем как 1251', () => {
    const r = decodeBytes(cp1251('Дата;Счёт списания;Ёлка'));
    expect(r.encoding).toBe('windows-1251');
    expect(r.text).toBe('Дата;Счёт списания;Ёлка');
  });

  it('Excel .xlsx (zip) и бинарный мусор — понятный отказ', () => {
    expect(() => decodeBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toThrow(ImportFileError);
    expect(() => decodeBytes(new Uint8Array([1, 2, 0, 3, 4]))).toThrow(/не текстовый файл/);
  });

  it('пустой файл — пустой текст', () => {
    expect(decodeBytes(new Uint8Array()).text).toBe('');
  });
});
