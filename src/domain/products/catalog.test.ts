import { describe, expect, it } from 'vitest';
import { CATALOG, PRODUCT_GROUPS, defaultUnitFor, groceryCategoryFor, isFoodProduct, isStapleProduct, matchProduct, normName, productById, productByName, searchCatalog } from './catalog';
import { RAW_PRODUCTS } from './data';

describe('встроенный каталог продуктов: данные', () => {
  it('около 300 продуктов', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(280);
    expect(CATALOG.length).toBeLessThanOrEqual(360);
  });

  it('id: латиница, уникальны, не длиннее 30 символов', () => {
    const ids = RAW_PRODUCTS.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9][a-z0-9-]{1,29}$/);
  });

  it('название: без лишних пробелов, с заглавной, до 80 символов; единица — шт, кг или л; раздел известен', () => {
    const groups = new Set(PRODUCT_GROUPS.map((g) => g.id));
    for (const [id, name, group, unit] of RAW_PRODUCTS) {
      expect(name, id).toBe(name.trim());
      expect(name.length, id).toBeGreaterThan(1);
      expect(name.length, id).toBeLessThanOrEqual(80);
      expect(name[0], id).toBe(name[0]!.toLocaleUpperCase('ru'));
      expect(['pcs', 'kg', 'l'], id).toContain(unit);
      expect(groups.has(group), `${id}: раздел ${group}`).toBe(true);
    }
  });

  it('синонимы: строчными буквами, непустые, без повторов у одного продукта', () => {
    for (const [id, , , , synonyms = []] of RAW_PRODUCTS) {
      for (const s of synonyms) {
        expect(s.trim(), id).toBe(s);
        expect(s, id).toBe(s.toLocaleLowerCase('ru'));
        expect(normName(s), id).not.toBe('');
      }
      expect(new Set(synonyms.map(normName)).size, id).toBe(synonyms.length);
    }
  });

  it('ни одно название или синоним не принадлежит двум продуктам (иначе поиск и привязка неоднозначны)', () => {
    const owner = new Map<string, string>();
    for (const p of CATALOG) {
      for (const k of p.keys) {
        expect(owner.get(k), `«${k}»: ${owner.get(k)} и ${p.id}`).toBeUndefined();
        owner.set(k, p.id);
      }
    }
  });

  it('в каждом разделе не меньше 8 продуктов, пустых разделов нет', () => {
    for (const g of PRODUCT_GROUPS) {
      expect(CATALOG.filter((p) => p.group === g.id).length, g.label).toBeGreaterThanOrEqual(8);
    }
  });

  it('самые ходовые продукты на месте', () => {
    for (const name of [
      'Картофель', 'Помидоры', 'Огурцы', 'Морковь', 'Лук', 'Чеснок', 'Капуста', 'Яблоки', 'Бананы', 'Лимоны', 'Арбуз',
      'Укроп', 'Петрушка', 'Говядина', 'Баранина', 'Курица', 'Фарш', 'Колбаса', 'Рыба', 'Молоко', 'Кефир', 'Сметана', 'Творог', 'Сыр',
      'Масло сливочное', 'Яйца', 'Хлеб', 'Лепёшка', 'Рис', 'Гречка', 'Макароны', 'Мука', 'Сахар', 'Соль', 'Масло подсолнечное',
      'Чай', 'Кофе', 'Вода питьевая', 'Сок', 'Конфеты', 'Печенье', 'Изюм', 'Грецкие орехи', 'Мыло', 'Стиральный порошок', 'Туалетная бумага',
    ]) {
      expect(productByName(name), name).toBeDefined();
    }
  });
});

describe('normName: ключ названия', () => {
  it('без регистра, «ё», знаков и лишних пробелов', () => {
    expect(normName('  Лепёшка  ')).toBe('лепешка');
    expect(normName('Яйца, С1')).toBe('яйца с1');
    expect(normName('Масло-сливочное')).toBe('масло сливочное');
    expect(normName('')).toBe('');
    expect(normName('!!!')).toBe('');
  });
});

describe('поиск по каталогу', () => {
  const first = (q: string) => searchCatalog(q)[0]?.name;

  it('находит по названию и синониму: «картошка» → Картофель, «яйцо» → Яйца', () => {
    expect(first('картошка')).toBe('Картофель');
    expect(first('Картофель')).toBe('Картофель');
    expect(first('ЯЙЦА')).toBe('Яйца');
    expect(first('яйцо')).toBe('Яйца');
  });

  it('понимает падежи и числа (так диктуют и пишут в чеках): «картошки», «помидоров», «огурцов», «яблок»', () => {
    expect(first('картошки')).toBe('Картофель');
    expect(first('помидоров')).toBe('Помидоры');
    expect(first('огурцов')).toBe('Огурцы');
    expect(first('яблок')).toBe('Яблоки');
    expect(first('молока')).toBe('Молоко');
  });

  it('по началу слова: «молок» → Молоко первым; «карт» находит картофель', () => {
    expect(first('молок')).toBe('Молоко');
    expect(searchCatalog('карт').map((p) => p.name)).toContain('Картофель');
  });

  it('точное название раньше частичного; несколько слов — все должны подойти', () => {
    expect(first('хлеб')).toBe('Хлеб');
    expect(first('масло сливочное')).toBe('Масло сливочное');
    expect(first('сливочное масло')).toBe('Масло сливочное');
  });

  it('пустой запрос и неизвестное — пустой список; limit и раздел работают', () => {
    expect(searchCatalog('')).toEqual([]);
    expect(searchCatalog('   ')).toEqual([]);
    expect(searchCatalog('фывапролдж')).toEqual([]);
    expect(searchCatalog('а', { limit: 5 }).length).toBeLessThanOrEqual(5);
    const veg = searchCatalog('лук', { group: 'veg' });
    expect(veg.length).toBeGreaterThan(0);
    expect(veg.every((p) => p.group === 'veg')).toBe(true);
  });
});

describe('поиск по id и названию', () => {
  it('productById и productByName', () => {
    const p = productByName('Картошка');
    expect(p?.name).toBe('Картофель');
    expect(productById(p!.id)).toBe(p);
    expect(productById('нет такого')).toBeUndefined();
    expect(productByName('')).toBeUndefined();
    expect(productByName('Неведомый продукт')).toBeUndefined();
  });

  it('единица по умолчанию: молоко — литры, картофель — килограммы, неизвестное — null', () => {
    expect(defaultUnitFor('молоко')).toBe('l');
    expect(defaultUnitFor('картошка')).toBe('kg');
    expect(defaultUnitFor('что-то своё')).toBeNull();
  });
});

describe('matchProduct: уверенное сопоставление названий из речи и чеков', () => {
  const name = (q: string) => matchProduct(q)?.name ?? null;

  it('падежи и числа: «картошки», «помидоров», «яблок», «муки», «сыра», «хлеба», «морковку», «воды»', () => {
    expect(name('картошки')).toBe('Картофель');
    expect(name('помидоров')).toBe('Помидоры');
    expect(name('яблок')).toBe('Яблоки');
    expect(name('муки')).toBe('Мука');
    expect(name('сыра')).toBe('Сыр');
    expect(name('хлеба')).toBe('Хлеб');
    expect(name('морковку')).toBe('Морковь');
    expect(name('воды')).toBe('Вода питьевая');
    expect(name('масла сливочного')).toBe('Масло сливочное');
  });

  it('числа, проценты и граммовки на чеке названия не меняют: «Молоко 3,2% 1л», «Яйца С1 10шт»', () => {
    expect(name('Молоко 3,2% 1л')).toBe('Молоко');
    expect(name('ЯЙЦА С1 10ШТ')).toBe('Яйца');
  });

  it('неоднозначное и неизвестное — null: «масло», «печенья» (печенье или печень), «кар», «Сыр Российский Брест», своё название', () => {
    for (const q of ['масло', 'печенья', 'кар', 'Сыр Российский Брест', 'Курт сушёный', '', '   ', '123', '5%']) expect(matchProduct(q), q).toBeNull();
  });

  it('один и тот же продукт под названием и синонимом: «картошка» и «Картофель»', () => {
    expect(matchProduct('картошка')?.id).toBe(matchProduct('Картофель')?.id);
  });

  it('у каждого продукта находится он сам по своему названию и по каждому синониму (основы не склеивают разные продукты)', () => {
    for (const p of CATALOG) for (const k of p.keys) expect(matchProduct(k)?.id, `${k} → ${p.id}`).toBe(p.id);
  });
});

describe('isFoodProduct и groceryCategoryFor: «автораспределение» по продуктам', () => {
  const cats = [
    { id: 'g', name: 'Продукты' },
    { id: 't', name: 'Транспорт' },
  ];
  it('продукт питания без категории → «Продукты» человека; «Дом и гигиена», неизвестное и нет такой категории → null', () => {
    expect(isFoodProduct(productByName('Хлеб')!)).toBe(true);
    expect(isFoodProduct(productByName('Мыло')!)).toBe(false);
    expect(groceryCategoryFor('хлеба', cats)).toBe('g');
    expect(groceryCategoryFor('Молоко 3,2%', cats)).toBe('g');
    expect(groceryCategoryFor('мыло', cats)).toBeNull();
    expect(groceryCategoryFor('такси', cats)).toBeNull();
    expect(groceryCategoryFor('хлеб', [{ id: 't', name: 'Транспорт' }])).toBeNull();
    expect(groceryCategoryFor('хлеб', [{ id: 'g', name: ' ПРОДУКТЫ ' }])).toBe('g');
  });

  it('в речи — только бесспорные продукты: «кофе», «чай», «мороженое» чаще кафе; на чеке из магазина они тоже «Продукты»', () => {
    expect(isStapleProduct(productByName('Хлеб')!)).toBe(true);
    expect(isStapleProduct(productByName('Кофе')!)).toBe(false);
    expect(isStapleProduct(productByName('Конфеты')!)).toBe(false);
    expect(groceryCategoryFor('кофе', cats, { staplesOnly: true })).toBeNull();
    expect(groceryCategoryFor('конфеты', cats, { staplesOnly: true })).toBeNull();
    expect(groceryCategoryFor('картошки', cats, { staplesOnly: true })).toBe('g');
    expect(groceryCategoryFor('кофе', cats)).toBe('g');
    expect(groceryCategoryFor('конфеты', cats)).toBe('g');
  });
});
