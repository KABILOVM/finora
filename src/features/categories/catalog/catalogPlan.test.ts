import { describe, expect, it } from 'vitest';
import { actionable, countSelected, defaultSelection, isGroupOn, nameKey, planCatalog, toggleChild, toggleGroup, type ExistingCategory } from './catalogPlan';

let n = 0;
const cat = (name: string, over: Partial<ExistingCategory> = {}): ExistingCategory => ({
  id: `id-${++n}-${name}`,
  name,
  kind: 'expense',
  parentId: null,
  archived: false,
  color: '#123456',
  ...over,
});
const group = (plan: ReturnType<typeof planCatalog>, slug: string) => {
  const g = plan.groups.find((x) => x.group.slug === slug);
  if (!g) throw new Error(`нет группы ${slug}`);
  return g;
};
const child = (plan: ReturnType<typeof planCatalog>, g: string, c: string) => {
  const found = group(plan, g).children.find((x) => x.child.slug === c);
  if (!found) throw new Error(`нет подкатегории ${g}/${c}`);
  return found;
};

describe('nameKey: сравнение названий', () => {
  it('регистр, «ё», знаки и окончания не мешают', () => {
    expect(nameKey('Коммунальные услуги')).toBe(nameKey('коммунальная  УСЛУГА'));
    expect(nameKey('Интернета')).toBe(nameKey('интернет'));
    expect(nameKey('Воды')).toBe(nameKey('Вода'));
    expect(nameKey('Света')).toBe(nameKey('свет'));
    expect(nameKey('Лепёшки')).toBe(nameKey('лепешки'));
    expect(nameKey('Wi-Fi')).toBe(nameKey('wi fi'));
  });

  it('разные слова остаются разными: «Газ» ≠ «Газета», «Дом» ≠ «Домофон»', () => {
    expect(nameKey('Газ')).not.toBe(nameKey('Газета'));
    expect(nameKey('Дом')).not.toBe(nameKey('Домофон'));
    expect(nameKey('Свет')).not.toBe(nameKey('Светлана'));
  });
});

describe('planCatalog', () => {
  it('у человека пусто: всё предлагается создать, родители тоже', () => {
    const plan = planCatalog([]);
    const g = group(plan, 'utilities');
    expect(g.parent).toEqual({ action: 'create' });
    expect(g.children.every((c) => c.action === 'create')).toBe(true);
    expect(g.open).toBe(g.children.length + 1);
  });

  it('стартовые категории приложения «Продукты» и «Жильё» находятся, подкатегории встают под них', () => {
    const food = cat('Продукты', { color: '#22c55e' });
    const plan = planCatalog([food, cat('Жильё')]);
    const g = group(plan, 'groceries');
    expect(g.parent).toMatchObject({ action: 'present', id: food.id, color: '#22c55e' });
    expect(g.open).toBe(g.children.length); // родитель не считается: он уже есть
    expect(child(plan, 'groceries', 'meat').action).toBe('create');
  });

  it('«Коммуналка», «Свет», «Вода», «Газ», «Интернет» собираются в группы: родитель есть, остальные переносятся', () => {
    const komm = cat('Коммуналка');
    const light = cat('Свет');
    const water = cat('Воды');
    const gas = cat('Газ');
    const net = cat('Интернет');
    const comm = cat('Связь');
    const plan = planCatalog([komm, light, water, gas, net, comm]);
    const util = group(plan, 'utilities');
    expect(util.parent).toMatchObject({ action: 'present', id: komm.id });
    expect(child(plan, 'utilities', 'electricity')).toMatchObject({ action: 'move', existing: { id: light.id, name: 'Свет' } });
    expect(child(plan, 'utilities', 'water')).toMatchObject({ action: 'move', existing: { id: water.id } });
    expect(child(plan, 'utilities', 'gas')).toMatchObject({ action: 'move', existing: { id: gas.id } });
    expect(child(plan, 'utilities', 'heating').action).toBe('create');
    // интернет — не коммунальная услуга, а связь
    expect(child(plan, 'communication', 'internet')).toMatchObject({ action: 'move', existing: { id: net.id } });
    expect(group(plan, 'communication').parent).toMatchObject({ action: 'present', id: comm.id });
  });

  it('«Жена» и «Дети» уходят под «Семья»; если «Семьи» нет — она создаётся', () => {
    const wife = cat('Жена');
    const kids = cat('Дети');
    const plan = planCatalog([wife, kids]);
    const fam = group(plan, 'family');
    expect(fam.parent).toEqual({ action: 'create' });
    expect(child(plan, 'family', 'spouse')).toMatchObject({ action: 'move', existing: { id: wife.id } });
    expect(child(plan, 'family', 'kids')).toMatchObject({ action: 'move', existing: { id: kids.id } });
    expect(child(plan, 'family', 'parents').action).toBe('create');
  });

  it('категория, которая уже подкатегория нужной группы, считается «уже есть»', () => {
    const util = cat('Коммуналка');
    const light = cat('Свет', { parentId: util.id });
    const plan = planCatalog([util, light]);
    expect(child(plan, 'utilities', 'electricity')).toMatchObject({ action: 'present', existing: { id: light.id } });
  });

  it('чужие подкатегории не трогаем и копий не заводим: «Свет» у другого родителя остаётся там', () => {
    const home = cat('Мой дом');
    const light = cat('Свет', { parentId: home.id });
    const plan = planCatalog([home, light]);
    expect(group(plan, 'utilities').children.find((c) => c.child.slug === 'electricity')).toBeUndefined();
  });

  it('категория с собственными подкатегориями не переносится (вложенность одна) и копия не создаётся', () => {
    const light = cat('Свет');
    const sub = cat('Свет в гараже', { parentId: light.id });
    const plan = planCatalog([light, sub]);
    expect(group(plan, 'utilities').children.find((c) => c.child.slug === 'electricity')).toBeUndefined();
  });

  it('архивная категория не воскресает как подкатегория и не дублируется', () => {
    const old = cat('Свет', { archived: true });
    const plan = planCatalog([old]);
    expect(group(plan, 'utilities').children.find((c) => c.child.slug === 'electricity')).toBeUndefined();
  });

  it('родитель в архиве предлагается вернуть', () => {
    const arch = cat('Продукты', { archived: true });
    const plan = planCatalog([arch]);
    expect(group(plan, 'groceries').parent).toMatchObject({ action: 'restore', id: arch.id });
  });

  it('виды не смешиваются: расходный «Подарки» и доходный «Подарки» — разные записи', () => {
    const incomeGifts = cat('Подарки', { kind: 'income' });
    const plan = planCatalog([incomeGifts]);
    expect(group(plan, 'gifts').parent).toMatchObject({ action: 'present', id: incomeGifts.id });
    expect(group(plan, 'celebrations').parent).toEqual({ action: 'create' });
    expect(child(plan, 'celebrations', 'presents').action).toBe('create');
  });

  it('название группы занято чьей-то подкатегорией: группу не предлагаем (нет места для вложенности)', () => {
    const top = cat('Дом');
    const sub = cat('Продукты', { parentId: top.id });
    const plan = planCatalog([top, sub]);
    expect(plan.groups.find((g) => g.group.slug === 'groceries')).toBeUndefined();
  });

  it('одна категория человека переносится только один раз, даже если подходит двум записям', () => {
    const plan = planCatalog([cat('Кофе')]);
    const moves = plan.groups.flatMap((g) => g.children).filter((c) => c.action === 'move');
    expect(moves.map((m) => m.existing?.name)).toEqual(['Кофе']);
  });

  it('когда всё на месте, у группы нет работы', () => {
    const util = cat('Коммунальные услуги');
    const kids = group(planCatalog([]), 'utilities').children.map((c) => cat(c.child.name, { parentId: util.id }));
    const plan = planCatalog([util, ...kids]);
    expect(group(plan, 'utilities').open).toBe(0);
  });

  it('ничего не меняется от порядка и повторов: тот же вход — тот же план', () => {
    const rows = [cat('Свет'), cat('Коммуналка'), cat('Жена'), cat('Продукты')];
    expect(planCatalog(rows)).toEqual(planCatalog(rows));
  });
});

describe('выбор', () => {
  const rows = [cat('Коммуналка'), cat('Свет'), cat('Продукты'), cat('Корм')];
  const plan = planCatalog(rows);

  it('по умолчанию отмечены популярные группы и всё, где есть что перенести; остальное — нет', () => {
    const sel = defaultSelection(plan);
    expect(isGroupOn(group(plan, 'utilities'), sel)).toBe(true);
    expect(isGroupOn(group(plan, 'groceries'), sel)).toBe(true);
    expect(isGroupOn(group(plan, 'travel'), sel)).toBe(false);
    // «Корм» переносится в «Питомцы», хотя группа не популярная: у человека такая категория уже есть
    expect(child(plan, 'pets', 'pet-food').action).toBe('move');
    expect(isGroupOn(group(plan, 'pets'), sel)).toBe(true);
  });

  it('группы без работы в выбор не попадают', () => {
    const empty = planCatalog([]);
    const sel = defaultSelection({ groups: empty.groups.map((g) => ({ ...g, open: 0 })) });
    expect(sel.size).toBe(0);
  });

  it('переключение группы отмечает/снимает её и все подкатегории', () => {
    const g = group(plan, 'travel');
    const on = toggleGroup(g, new Set());
    expect(isGroupOn(g, on)).toBe(true);
    expect(on.has(g.key)).toBe(true);
    for (const c of actionable(g)) expect(on.has(c.key)).toBe(true);
    const off = toggleGroup(g, on);
    expect(off.size).toBe(0);
  });

  it('подкатегория отмечает родителя, которого ещё нет; снятие последней убирает и его', () => {
    const g = group(plan, 'travel');
    const first = g.children[0]!;
    const sel = toggleChild(g, first.key, new Set());
    expect(sel.has(g.key)).toBe(true);
    const none = toggleChild(g, first.key, sel);
    expect(none.has(g.key)).toBe(false);
    expect(none.size).toBe(0);
  });

  it('у существующего родителя подкатегорию можно снять, а группа остаётся «частично отмеченной»', () => {
    const g = group(plan, 'groceries');
    const all = toggleGroup(g, new Set());
    const less = toggleChild(g, g.children[0]!.key, all);
    expect(isGroupOn(g, less)).toBe(false);
    expect(actionable(g).some((c) => less.has(c.key))).toBe(true);
  });

  it('countSelected считает создаваемые родители, подкатегории и переносы; подкатегории без родителя не считаются', () => {
    const travel = group(plan, 'travel');
    expect(countSelected(plan, toggleGroup(travel, new Set()))).toBe(travel.children.length + 1);
    const orphan = new Set([travel.children[0]!.key]); // родитель не отмечен и его нет
    expect(countSelected(plan, orphan)).toBe(0);
    const groceries = group(plan, 'groceries');
    expect(countSelected(plan, toggleGroup(groceries, new Set()))).toBe(groceries.children.length);
  });
});
