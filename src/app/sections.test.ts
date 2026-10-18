import { describe, expect, it } from 'vitest';
import appSource from '../App.tsx?raw';
import { GROUP_ORDER, moreGroups, SECTIONS } from './sections';

describe('реестр разделов', () => {
  it('id, адреса и названия не повторяются; адреса начинаются с «/»', () => {
    for (const key of ['id', 'path', 'title'] as const) {
      expect(new Set(SECTIONS.map((s) => s[key])).size).toBe(SECTIONS.length);
    }
    expect(SECTIONS.every((s) => s.path.startsWith('/'))).toBe(true);
  });

  it('каждый раздел есть среди маршрутов App.tsx', () => {
    for (const s of SECTIONS) {
      expect(appSource, `маршрут ${s.path}`).toContain(`<Route path="${s.path}" `);
    }
  });

  it('в нижней панели три раздела (плюс «Ещё» и «+»), все группы известны', () => {
    expect(SECTIONS.filter((s) => s.bottomBar).map((s) => s.title)).toEqual(['Главная', 'Операции', 'Аналитика']);
    expect(SECTIONS.every((s) => GROUP_ORDER.includes(s.group))).toBe(true);
  });

  it('«Ещё» = всё, чего нет в нижней панели, ничего не потеряно и не повторено', () => {
    const inMore = moreGroups().flatMap((g) => g.items.map((s) => s.id));
    expect(inMore.sort()).toEqual(SECTIONS.filter((s) => !s.bottomBar).map((s) => s.id).sort());
  });
});
