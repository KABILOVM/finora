import { describe, expect, it } from 'vitest';
import type { ChipOption } from '@/components/ChipPicker';
import { buildCategoryOptions, childrenOf, groupUnderParents, hasChildren, parentIn, pathLabel, searchCategories, searchOptions, withDescendants } from './categoryTree';

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

describe('searchCategories: поиск по названию', () => {
  const named = (id: string, name: string, parentId: string | null = null) => row(id, parentId, { name });
  const rows = [
    named('eda', 'Еда'),
    named('zhile', 'Жильё'),
    named('voda', 'Вода', 'zhile'),
    named('svet', 'Свет', 'zhile'),
    named('transport', 'Транспорт'),
    named('taxi', 'Такси', 'transport'),
  ];
  const ids = (found: readonly { id: string }[]) => found.map((r) => r.id);

  it('пустой запрос возвращает всё как есть', () => {
    expect(ids(searchCategories(rows, ''))).toEqual(ids(rows));
    expect(ids(searchCategories(rows, '   '))).toEqual(ids(rows));
  });

  it('совпала верхняя категория без подкатегорий — только она', () => {
    expect(ids(searchCategories(rows, 'еда'))).toEqual(['eda']);
  });

  it('совпал родитель — и все его подкатегории', () => {
    expect(ids(searchCategories(rows, 'жилье'))).toEqual(['zhile', 'voda', 'svet']); // «ё» и «е» не различаются
  });

  it('совпала подкатегория — и её родитель, но не соседние подкатегории', () => {
    expect(ids(searchCategories(rows, 'вода'))).toEqual(['zhile', 'voda']);
    expect(ids(searchCategories(rows, 'такси'))).toEqual(['transport', 'taxi']);
  });

  it('совпало и в родителе, и в подкатегории — каждая один раз, порядок списка сохранён', () => {
    // «т» есть в «Свет», «Транспорт», «Такси»; «Жильё» вошло как родитель найденного «Свет»
    expect(ids(searchCategories(rows, 'т'))).toEqual(['zhile', 'svet', 'transport', 'taxi']);
  });

  it('ничего не совпало — пусто; несколько слов — все должны найтись', () => {
    expect(searchCategories(rows, 'космос')).toEqual([]);
    // слова из пути «Жильё Вода»: «жил» есть у родителя, «вод» — у подкатегории; соседний «Свет» не подходит
    expect(ids(searchCategories(rows, 'вод жил'))).toEqual(['zhile', 'voda']);
    expect(ids(searchCategories(rows, 'вод еда'))).toEqual([]);
  });

  it('подкатегория с родителем не из списка (он в архиве) ищется как обычная и сама', () => {
    const orphan = [named('a', 'Вода', 'gone'), named('b', 'Еда')];
    expect(ids(searchCategories(orphan, 'вода'))).toEqual(['a']);
  });
});

describe('searchOptions: поиск категории при вводе операции', () => {
  const opt = (value: string, label: string, sub?: string): ChipOption => ({ value, label, ...(sub ? { sub } : {}) });
  // порядок как в панели: самые частые первыми, подкатегории под родителем
  const options: ChipOption[] = [
    opt('eda', 'Еда'),
    opt('zhile', 'Жильё'),
    opt('voda', 'Вода', 'Жильё'),
    opt('svet', 'Свет', 'Жильё'),
    opt('transport', 'Транспорт'),
    opt('taxi', 'Такси', 'Транспорт'),
    opt('avto', 'Автотранспорт и такси'),
  ];
  const values = (found: readonly ChipOption[]) => found.map((o) => o.value);

  it('пустой запрос и одни пробелы возвращают всё как есть', () => {
    expect(values(searchOptions(options, ''))).toEqual(values(options));
    expect(values(searchOptions(options, '   '))).toEqual(values(options));
  });

  it('регистр и «ё» не важны', () => {
    expect(values(searchOptions(options, 'ЖИЛЬЕ'))).toEqual(['zhile', 'voda', 'svet']);
  });

  it('«такси»: «Такси» и «Автотранспорт и такси» — оба с начала слова, порядок исходный', () => {
    expect(values(searchOptions(options, 'такси'))).toEqual(['taxi', 'avto']);
  });

  it('ступени: начало слова, потом вхождение внутри слова, потом совпавшее только по родителю', () => {
    // «тра»: «Транспорт» — начало слова; «Автотранспорт и такси» — внутри слова; «Такси» совпало лишь через родителя «Транспорт»
    expect(values(searchOptions(options, 'тра'))).toEqual(['transport', 'avto', 'taxi']);
  });

  it('вхождение внутри слова — после начала слова', () => {
    const found = values(searchOptions([opt('a', 'Автотранспорт'), opt('b', 'Транспорт')], 'транс'));
    expect(found).toEqual(['b', 'a']); // «Транспорт» начинается с «транс», в «Автотранспорте» — внутри слова
  });

  it('запрос по родителю находит родителя первым, потом все его подкатегории', () => {
    expect(values(searchOptions(options, 'жил'))).toEqual(['zhile', 'voda', 'svet']);
  });

  it('путь «родитель название»: «жильё вода» — только «Вода»', () => {
    expect(values(searchOptions(options, 'жильё вода'))).toEqual(['voda']);
  });

  it('несколько слов — все должны найтись, в любом порядке', () => {
    expect(values(searchOptions(options, 'такси авто'))).toEqual(['avto']);
    expect(values(searchOptions(options, 'вода еда'))).toEqual([]);
  });

  it('ничего не нашлось — пусто', () => {
    expect(searchOptions(options, 'космос')).toEqual([]);
  });

  it('исходный список не меняется', () => {
    const copy = [...options];
    searchOptions(options, 'такси');
    expect(options).toEqual(copy);
  });
});
