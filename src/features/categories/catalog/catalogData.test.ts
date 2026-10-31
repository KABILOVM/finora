import { describe, expect, it } from 'vitest';
import { GLYPH_CHOICES } from '@/components/glyphs';
import { CATALOG, childSlug, groupSlug } from './catalogData';
import { nameKey } from './catalogPlan';

const SEED_EXPENSE = ['Еда', 'Продукты', 'Транспорт', 'Жильё', 'Связь', 'Здоровье', 'Покупки', 'Развлечения', 'Подписки', 'Образование', 'Долги'];
const SEED_INCOME = ['Зарплата', 'Подработка', 'Подарки'];

describe('каталог готовых категорий: данные', () => {
  it('slug вечные и латиницей, уникальные по всему каталогу', () => {
    const slugs = CATALOG.flatMap((g) => [groupSlug(g), ...g.children.map((c) => childSlug(g, c))]);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of CATALOG) {
      expect(g.slug, g.name).toMatch(/^[a-z0-9-]+$/);
      for (const c of g.children) expect(c.slug, `${g.name} › ${c.name}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('названия: непустые, без лишних пробелов, не длиннее 60 знаков (граница базы), не повторяются в пределах вида', () => {
    for (const kind of ['expense', 'income'] as const) {
      const names = CATALOG.filter((g) => g.kind === kind).flatMap((g) => [g.name, ...g.children.map((c) => c.name)]);
      for (const n of names) {
        expect(n, n).toBe(n.trim());
        expect(n.length, n).toBeGreaterThan(0);
        expect(n.length, n).toBeLessThanOrEqual(60);
      }
      expect(new Set(names.map((n) => n.toLocaleLowerCase('ru'))).size, kind).toBe(names.length);
    }
  });

  it('значки существуют в наборе приложения, цвета — #rrggbb', () => {
    for (const g of CATALOG) {
      expect(GLYPH_CHOICES, `${g.name}: значок «${g.icon}»`).toContain(g.icon);
      expect(g.color, g.name).toMatch(/^#[0-9a-f]{6}$/);
      for (const c of g.children) expect(GLYPH_CHOICES, `${g.name} › ${c.name}: значок «${c.icon}»`).toContain(c.icon);
    }
  });

  it('у каждой группы есть подсказка и от двух подкатегорий; обязательными бывают только расходные', () => {
    for (const g of CATALOG) {
      expect(g.hint.length, g.name).toBeGreaterThan(5);
      expect(g.children.length, g.name).toBeGreaterThanOrEqual(2);
      if (g.kind === 'income') {
        expect(g.essential, g.name).toBeUndefined();
        for (const c of g.children) expect(c.essential, `${g.name} › ${c.name}`).toBeUndefined();
      }
    }
  });

  it('названия и синонимы однозначны: один ключ сравнения не принадлежит двум записям одного вида', () => {
    for (const kind of ['expense', 'income'] as const) {
      const owners = new Map<string, string>();
      const claim = (key: string, owner: string, spelled: string) => {
        const prev = owners.get(key);
        expect(prev === undefined || prev === owner, `«${spelled}» (${owner}) совпадает с «${prev}»`).toBe(true);
        owners.set(key, owner);
      };
      for (const g of CATALOG.filter((x) => x.kind === kind)) {
        for (const n of [g.name, ...(g.aka ?? [])]) claim(nameKey(n), g.slug, n);
        for (const c of g.children) for (const n of [c.name, ...(c.aka ?? [])]) claim(nameKey(n), `${g.slug}/${c.slug}`, n);
      }
    }
  });

  it('стартовые категории приложения есть в каталоге под теми же названиями: подкатегории встанут под них', () => {
    const names = (kind: string) => CATALOG.filter((g) => g.kind === kind).map((g) => g.name);
    for (const n of SEED_EXPENSE) expect(names('expense'), n).toContain(n);
    for (const n of SEED_INCOME) expect(names('income'), n).toContain(n);
  });

  it('есть всё, что просили: коммуналка, продукты, семья (дети, супруг) и другие наборы', () => {
    const find = (slug: string) => CATALOG.find((g) => g.slug === slug);
    expect(find('utilities')?.children.map((c) => c.name)).toEqual(expect.arrayContaining(['Электричество', 'Вода', 'Газ', 'Отопление']));
    expect(find('groceries')?.children.map((c) => c.name)).toEqual(expect.arrayContaining(['Мясо и птица', 'Овощи и фрукты', 'Молочные продукты']));
    expect(find('family')?.children.map((c) => c.name)).toEqual(expect.arrayContaining(['Дети', 'Супруг(а)']));
    expect(CATALOG.filter((g) => g.kind === 'expense').length).toBeGreaterThanOrEqual(15);
    expect(CATALOG.filter((g) => g.kind === 'income').length).toBeGreaterThanOrEqual(5);
    expect(CATALOG.filter((g) => g.popular).length).toBeGreaterThanOrEqual(8);
  });
});
