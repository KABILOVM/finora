import { describe, expect, it } from 'vitest';
import type { Release } from './releases';
import { MAX_RELEASES_SHOWN, releasesToShow } from './whatsNew';

const rel = (version: string): Release => ({ version, date: '2026-10-15', items: [{ icon: '✨', text: `новое в ${version}` }] });
/** Новые сверху, как в releases.ts. */
const ALL = [rel('0.5.0'), rel('0.4.0'), rel('0.3.0'), rel('0.2.0'), rel('0.1.0')];
const versions = (list: Release[]) => list.map((r) => r.version);

describe('releasesToShow: что показать в «Что нового»', () => {
  it('версия не менялась — ничего', () => {
    expect(releasesToShow(ALL, '0.5.0', '0.5.0', true)).toEqual([]);
  });

  it('обновились на одну версию — её запись', () => {
    expect(versions(releasesToShow(ALL, '0.5.0', '0.4.0', true))).toEqual(['0.5.0']);
  });

  it('пропустили несколько версий — все между, новые первыми', () => {
    expect(versions(releasesToShow(ALL, '0.5.0', '0.3.0', true))).toEqual(['0.5.0', '0.4.0']);
  });

  it(`не больше ${MAX_RELEASES_SHOWN} версий за раз`, () => {
    expect(versions(releasesToShow(ALL, '0.5.0', '0.1.0', true))).toEqual(['0.5.0', '0.4.0', '0.3.0']);
    expect(releasesToShow(ALL, '0.5.0', '0.1.0', true)).toHaveLength(MAX_RELEASES_SHOWN);
  });

  it('отметки нет: существующему человеку — запись текущей версии; новому — ничего', () => {
    expect(versions(releasesToShow(ALL, '0.5.0', null, true))).toEqual(['0.5.0']);
    expect(releasesToShow(ALL, '0.5.0', null, false)).toEqual([]);
  });

  it('прошлая версия списку неизвестна (очень старая или чужая) — только запись текущей', () => {
    expect(versions(releasesToShow(ALL, '0.5.0', '0.0.9', true))).toEqual(['0.5.0']);
    expect(versions(releasesToShow(ALL, '0.5.0', 'мусор', false))).toEqual(['0.5.0']);
  });

  it('у текущей версии нет записи — ничего (окно без содержимого не показываем)', () => {
    expect(releasesToShow(ALL, '0.5.1', '0.4.0', true)).toEqual([]);
    expect(releasesToShow(ALL, '0.5.1', null, true)).toEqual([]);
    expect(releasesToShow([], '0.1.0', null, true)).toEqual([]);
  });

  it('откат на старую версию (просмотрена новее текущей) — ничего', () => {
    expect(releasesToShow(ALL, '0.3.0', '0.5.0', true)).toEqual([]);
  });

  it('текущая версия не самая новая в списке: показываем от неё и старее, но не новее', () => {
    expect(versions(releasesToShow(ALL, '0.4.0', '0.2.0', true))).toEqual(['0.4.0', '0.3.0']);
  });
});
