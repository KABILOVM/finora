import { describe, expect, it } from 'vitest';
import { buildCategoryOptions, childrenOf, groupUnderParents, hasChildren, parentIn, pathLabel, withDescendants } from './categoryTree';

const row = (id: string, parentId: string | null = null, extra: Record<string, string> = {}) => ({
  id,
  parentId,
  name: extra['name'] ?? id.toUpperCase(),
  icon: 'i:tag',
  color: '#16a34a',
});

describe('groupUnderParents: родитель, сразу за ним подкатегории', () => {
  it('без подкатегорий порядок не меняется', () => {
    const rows = [row('c'), row('a'), row('b')];
    expect(groupUnderParents(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('подкатегории встают под родителя, остальной порядок сохраняется', () => {
    const rows = [row('food'), row('water', 'comm'), row('home'), row('comm'), row('light', 'comm')];
    expect(groupUnderParents(rows).map((r) => r.id)).toEqual(['food', 'comm', 'water', 'light', 'home']);
  });

  it('группа стоит там, где встретился её первый член: самая частая подкатегория поднимает всю группу', () => {
    // в списке «частые первыми» подкатегория «вода» самая частая — группа «коммунальные» идёт первой
    const rows = [row('water', 'comm'), row('food'), row('comm'), row('light', 'comm')];
    expect(groupUnderParents(rows).map((r) => r.id)).toEqual(['comm', 'water', 'light', 'food']);
  });

  it('родителя нет в списке (в архиве, удалён): подкатегория остаётся обычной, не пропадает', () => {
    const rows = [row('food'), row('water', 'gone'), row('home')];
    expect(groupUnderParents(rows).map((r) => r.id)).toEqual(['food', 'water', 'home']);
  });

  it('цикл и родитель-сам-себе (повреждённые данные) не зацикливают и ничего не теряют', () => {
    const rows = [row('a', 'b'), row('b', 'a'), row('c', 'c'), row('d')];
    const out = groupUnderParents(rows).map((r) => r.id);
    expect(out.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('глубже одного уровня (после импорта): потомки идут вслед за верхним предком', () => {
    const rows = [row('x'), row('c', 'b'), row('a'), row('b', 'a')];
    expect(groupUnderParents(rows).map((r) => r.id)).toEqual(['x', 'a', 'c', 'b']);
  });

  it('не меняет переданный массив', () => {
    const rows = [row('b', 'a'), row('a')];
    const copy = [...rows];
    groupUnderParents(rows);
    expect(rows).toEqual(copy);
  });
});

describe('родитель, дети, потомки', () => {
  const rows = [row('comm'), row('water', 'comm'), row('light', 'comm'), row('food'), row('tap', 'water')];

  it('parentIn находит родителя только среди переданных', () => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    expect(parentIn(rows[1]!, byId)?.id).toBe('comm');
    expect(parentIn(rows[0]!, byId)).toBeNull();
    expect(parentIn(row('z', 'missing'), byId)).toBeNull();
    expect(parentIn(row('self', 'self'), byId)).toBeNull();
  });

  it('hasChildren и childrenOf', () => {
    expect(hasChildren('comm', rows)).toBe(true);
    expect(hasChildren('food', rows)).toBe(false);
    expect(hasChildren('comm', [row('comm', 'comm')])).toBe(false); // сама себе не подкатегория
    expect(childrenOf('comm', rows).map((r) => r.id)).toEqual(['water', 'light']);
    expect(childrenOf('food', rows)).toEqual([]);
  });

  it('withDescendants: родитель вместе со всеми потомками (в том числе глубже одного уровня), без повторов и зацикливания', () => {
    expect([...withDescendants('comm', rows)].sort()).toEqual(['comm', 'light', 'tap', 'water']);
    expect([...withDescendants('food', rows)]).toEqual(['food']);
    expect([...withDescendants('water', rows)].sort()).toEqual(['tap', 'water']);
    const loop = [row('a', 'b'), row('b', 'a')];
    expect([...withDescendants('a', loop)].sort()).toEqual(['a', 'b']);
  });
});

describe('варианты для выбора категории', () => {
  const rows = [
    row('water', 'comm', { name: 'Вода' }),
    row('food', null, { name: 'Еда' }),
    row('comm', null, { name: 'Коммунальные услуги' }),
  ];

  it('родитель идёт перед подкатегорией; у подкатегории подпись с названием родителя, а label — обычное название', () => {
    const options = buildCategoryOptions(rows);
    expect(options.map((o) => o.value)).toEqual(['comm', 'water', 'food']);
    expect(options[1]).toMatchObject({ value: 'water', label: 'Вода', sub: 'Коммунальные услуги', icon: 'i:tag', color: '#16a34a' });
    expect(options[0]).not.toHaveProperty('sub');
    expect(options[2]).not.toHaveProperty('sub');
  });

  it('без подкатегорий варианты такие же, как были: порядок и поля прежние, подписей нет', () => {
    const flat = [row('b', null, { name: 'Б' }), row('a', null, { name: 'А' })];
    expect(buildCategoryOptions(flat)).toEqual([
      { value: 'b', label: 'Б', icon: 'i:tag', color: '#16a34a' },
      { value: 'a', label: 'А', icon: 'i:tag', color: '#16a34a' },
    ]);
  });

  it('свой текст названия (например, «(в архиве)»), подпись родителя при этом сохраняется', () => {
    const options = buildCategoryOptions(rows, (r) => `${r.name} (в архиве)`);
    expect(options.find((o) => o.value === 'water')).toMatchObject({ label: 'Вода (в архиве)', sub: 'Коммунальные услуги' });
  });

  it('родитель не в списке: подкатегория показывается без подписи', () => {
    const options = buildCategoryOptions([row('water', 'comm', { name: 'Вода' })]);
    expect(options).toEqual([{ value: 'water', label: 'Вода', icon: 'i:tag', color: '#16a34a' }]);
  });

  it('pathLabel для плоских списков: «Родитель › Название»', () => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    expect(pathLabel(rows[0]!, byId)).toBe('Коммунальные услуги › Вода');
    expect(pathLabel(rows[1]!, byId)).toBe('Еда');
  });
});
