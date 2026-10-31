import { describe, expect, it } from 'vitest';
import { mergeLinks, partsOf, type MergeLinked } from '@/domain/debtGroups';

const d = (id: string, o: Partial<MergeLinked> = {}): MergeLinked => ({
  id,
  direction: 'borrowed',
  currency: 'TJS',
  deletedAt: null,
  mergedIntoId: null,
  ...o,
});

describe('mergeLinks: какие связи объединения действуют', () => {
  it('составляющие собираются у главного долга по порядку; у остальных связей нет', () => {
    const debts = [d('main'), d('p1', { mergedIntoId: 'main' }), d('alone'), d('p2', { mergedIntoId: 'main' })];
    const { rootOf, parts } = mergeLinks(debts);
    expect([...rootOf]).toEqual([['p1', 'main'], ['p2', 'main']]);
    expect(parts.get('main')!.map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(parts.has('alone')).toBe(false);
    expect(partsOf(debts, 'main').map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(partsOf(debts, 'alone')).toEqual([]);
  });

  it('поле не задано (старые данные) — как null', () => {
    const old = { id: 'x', direction: 'lent', currency: 'TJS', deletedAt: null } as MergeLinked;
    expect(mergeLinks([old, d('y', { mergedIntoId: 'x', direction: 'lent' })]).rootOf.get('y')).toBe('x');
    expect(mergeLinks([old]).rootOf.size).toBe(0);
  });

  it('удалённый долг в расчёте не участвует ни как составляющая, ни как главный', () => {
    const gone = d('p1', { mergedIntoId: 'main', deletedAt: '2026-10-01T00:00:00.000Z' });
    expect(mergeLinks([d('main'), gone]).parts.size).toBe(0);
    const goneMain = d('main', { deletedAt: '2026-10-01T00:00:00.000Z' });
    expect(mergeLinks([goneMain, d('p1', { mergedIntoId: 'main' })]).rootOf.size).toBe(0); // главного нет — долг сам по себе
  });

  it('главного долга нет вовсе (ещё не пришёл с сервера) — связь не действует, ничего не падает', () => {
    expect(mergeLinks([d('p1', { mergedIntoId: 'ghost' })]).rootOf.size).toBe(0);
  });

  it('ссылка на самого себя не действует', () => {
    expect(mergeLinks([d('a', { mergedIntoId: 'a' })]).rootOf.size).toBe(0);
  });

  it('вложенность не действует: главный сам в чьём-то составе — его составляющие остаются сами по себе', () => {
    const debts = [d('top'), d('mid', { mergedIntoId: 'top' }), d('leaf', { mergedIntoId: 'mid' })];
    const { rootOf } = mergeLinks(debts);
    expect(rootOf.get('mid')).toBe('top');
    expect(rootOf.has('leaf')).toBe(false);
  });

  it('два устройства объединили долги друг с другом (цикл): обе связи не действуют, оба долга видны', () => {
    const { rootOf, parts } = mergeLinks([d('a', { mergedIntoId: 'b' }), d('b', { mergedIntoId: 'a' })]);
    expect(rootOf.size).toBe(0);
    expect(parts.size).toBe(0);
  });

  it('другое направление или другая валюта — связь не действует (суммы разных не складываются)', () => {
    const debts = [d('main'), d('lent', { mergedIntoId: 'main', direction: 'lent' }), d('usd', { mergedIntoId: 'main', currency: 'USD' })];
    expect(mergeLinks(debts).rootOf.size).toBe(0);
  });
});
