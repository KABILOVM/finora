import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TJ_GROUPS, TJ_SERVICES } from './tjData';

/** Значки таджикских банков и сервисов лежат файлами в public/tj/<id>.png; tjData.ts пишет scripts/gen-tj-services.cjs. Тест ловит расхождения. */
const DIR = resolve(__dirname, '../../public/tj');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => !f.startsWith('.')) : [];

describe('таджикские банки и сервисы: файлы и каталог', () => {
  it('каждому файлу в public/tj есть запись в каталоге и наоборот (после правки файлов запустите scripts/gen-tj-services.cjs)', () => {
    expect(files.sort()).toEqual(TJ_SERVICES.map((s) => `${s.id}.png`).sort());
  });

  it('записи каталога корректны: id, группа, путь, цвет, поле icon укладывается в 32 символа', () => {
    const groups = TJ_GROUPS.map((g) => g.id);
    expect(new Set(TJ_SERVICES.map((s) => s.id)).size).toBe(TJ_SERVICES.length);
    for (const s of TJ_SERVICES) {
      expect(s.id, s.id).toMatch(/^[a-z0-9]{1,30}$/);
      expect(`s:${s.id}`.length, s.id).toBeLessThanOrEqual(32);
      expect(groups, s.id).toContain(s.group);
      expect(s.img, s.id).toBe(`tj/${s.id}.png`);
      expect(s.color, s.id).toBe('#ffffff');
    }
  });

  it('каждый файл — настоящий квадратный PNG от 96 до 192 px и не тяжелее 40 КБ (иначе раздует офлайн-кэш)', () => {
    for (const f of files) {
      const buf = readFileSync(resolve(DIR, f));
      expect(buf.subarray(0, 8).toString('hex'), f).toBe('89504e470d0a1a0a');
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      expect(Math.abs(w - h), `${f} ${w}×${h}`).toBeLessThanOrEqual(2);
      expect(w, f).toBeGreaterThanOrEqual(96);
      expect(w, f).toBeLessThanOrEqual(192);
      expect(statSync(resolve(DIR, f)).size, f).toBeLessThanOrEqual(40_000);
    }
  });
});
