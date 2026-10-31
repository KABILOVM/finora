import { describe, expect, it } from 'vitest';
import { CATALOG } from '@/features/categories/catalog/catalogData';
import type { ExistingCategory } from '@/features/categories/catalog/catalogPlan';
import { BUDGET_TEMPLATES, buildTemplateRows, defaultRowKeys, niceMinor, rowKey, templateById } from './budgetTemplates';

let n = 0;
const cat = (name: string, over: Partial<ExistingCategory> = {}): ExistingCategory => ({
  id: `cat-${++n}`,
  name,
  kind: 'expense',
  parentId: null,
  archived: false,
  color: '#123456',
  ...over,
});
const none = new Map<string, number>();

describe('шаблоны: данные', () => {
  it('у каждого шаблона уникальный id, название и подсказка; доли разумные', () => {
    expect(new Set(BUDGET_TEMPLATES.map((t) => t.id)).size).toBe(BUDGET_TEMPLATES.length);
    expect(BUDGET_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of BUDGET_TEMPLATES) {
      expect(t.name.length, t.id).toBeGreaterThan(0);
      expect(t.tagline.length, t.id).toBeGreaterThan(5);
      expect(t.about.length, t.id).toBeGreaterThan(20);
      const lines = t.lines.reduce((s, l) => s + l.percent, 0);
      // категории и накопления вместе не больше всего дохода и почти его исчерпывают
      expect(lines + t.savingsPercent, t.id).toBeLessThanOrEqual(100);
      expect(lines + t.savingsPercent, t.id).toBeGreaterThanOrEqual(95);
      for (const l of t.lines) expect(l.percent, `${t.id}/${l.group}`).toBeGreaterThan(0);
      expect(new Set(t.lines.map((l) => l.group)).size, t.id).toBe(t.lines.length);
    }
  });

  it('каждый набор шаблона есть в каталоге готовых категорий (или это «Прочее»)', () => {
    const slugs = new Set(CATALOG.filter((g) => g.kind === 'expense').map((g) => g.slug));
    for (const t of BUDGET_TEMPLATES) for (const l of t.lines) expect(l.group === 'other' || slugs.has(l.group), `${t.id}/${l.group}`).toBe(true);
  });

  it('«50 / 30 / 20»: накоплений 20%, нужное и желания в сумме 80%', () => {
    const t = templateById('rule-50-30-20')!;
    expect(t.savingsPercent).toBe(20);
    expect(t.lines.reduce((s, l) => s + l.percent, 0)).toBe(80);
  });
});

describe('niceMinor', () => {
  it('округляет по-человечески: два значащих знака, не меньше целой единицы', () => {
    expect(niceMinor(123_456, 'TJS')).toBe(120_000); // 1234,56 → 1200
    expect(niceMinor(8_540, 'TJS')).toBe(8_500); // 85,40 → 85
    expect(niceMinor(8_550, 'TJS')).toBe(8_600); // 85,50 → 86
    expect(niceMinor(1_234_500, 'TJS')).toBe(1_200_000); // 12 345 → 12 000
    expect(niceMinor(4_000, 'TJS')).toBe(4_000);
    expect(niceMinor(40, 'TJS')).toBe(100); // меньше единицы — одна единица
    expect(niceMinor(0, 'TJS')).toBe(0);
    expect(niceMinor(-5, 'TJS')).toBe(0);
    expect(niceMinor(Number.NaN, 'TJS')).toBe(0);
  });

  it('валюта без копеек (JPY) считается целыми единицами', () => {
    expect(niceMinor(12_345, 'JPY')).toBe(12_000);
  });
});

describe('buildTemplateRows', () => {
  const t = templateById('rule-50-30-20')!;
  const cats = [cat('Жильё'), cat('Коммуналка'), cat('Продукты'), cat('Транспорт'), cat('Связь'), cat('Здоровье'), cat('Покупки'), cat('Развлечения'), cat('Прочее')];

  it('общий лимит первым: доход без накоплений; дальше лимиты по категориям человека в процентах от дохода', () => {
    const r = buildTemplateRows(t, 10_000_00, cats, none, 'TJS');
    expect(r.rows[0]).toMatchObject({ categoryId: null, name: 'Общий лимит на все расходы', percent: 80, amountMinor: 8_000_00 });
    const byName = new Map(r.rows.map((x) => [x.name, x]));
    expect(byName.get('Жильё')?.amountMinor).toBe(1_500_00);
    expect(byName.get('Продукты')?.amountMinor).toBe(1_400_00);
    expect(byName.get('Коммуналка')?.amountMinor).toBe(600_00); // «Коммуналка» = набор «Коммунальные услуги»
    expect(byName.get('Прочее')?.amountMinor).toBe(200_00);
    expect(r.savingsMinor).toBe(2_000_00);
  });

  it('названия берутся человеческие — его собственные, а ids — его категорий', () => {
    const r = buildTemplateRows(t, 10_000_00, cats, none, 'TJS');
    const k = r.rows.find((x) => x.name === 'Коммуналка')!;
    expect(k.categoryId).toBe(cats[1]!.id);
    expect(k.group).toBe('utilities');
  });

  it('наборы без категории у человека не придумываются: они в «missing» с процентами', () => {
    const r = buildTemplateRows(t, 10_000_00, cats, none, 'TJS');
    const names = r.missing.map((m) => m.name);
    expect(names).toContain('Путешествия');
    expect(names).toContain('Красота и уход');
    expect(r.rows.some((x) => x.group === 'travel')).toBe(false);
    expect(r.coveredPercent).toBeLessThan(80);
  });

  it('категории в архиве и подкатегории не годятся как «набор»', () => {
    const top = cat('Дом');
    const r = buildTemplateRows(t, 10_000_00, [cat('Продукты', { archived: true }), cat('Транспорт', { parentId: top.id })], none, 'TJS');
    expect(r.rows.some((x) => x.group === 'groceries')).toBe(false);
    expect(r.rows.some((x) => x.group === 'transport')).toBe(false);
  });

  it('доходные категории с таким же названием не подходят', () => {
    const r = buildTemplateRows(t, 10_000_00, [cat('Подарки', { kind: 'income' })], none, 'TJS');
    expect(r.rows.some((x) => x.group === 'celebrations')).toBe(false);
  });

  it('стоящие лимиты видны в строке и не отмечаются заранее', () => {
    const food = cats[2]!;
    const r = buildTemplateRows(t, 10_000_00, cats, new Map([[food.id, 900_00], ['total', 5_000_00]]), 'TJS');
    expect(r.rows.find((x) => x.categoryId === food.id)?.currentMinor).toBe(900_00);
    expect(r.rows[0]?.currentMinor).toBe(5_000_00);
    const keys = defaultRowKeys(r.rows);
    expect(keys.has(food.id)).toBe(false);
    expect(keys.has('total')).toBe(false);
    expect(keys.has(cats[0]!.id)).toBe(true);
    expect(rowKey(r.rows[0]!)).toBe('total');
  });

  it('нет дохода или доход ноль — лимитов нет, ничего не падает', () => {
    for (const income of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const r = buildTemplateRows(t, income, cats, none, 'TJS');
      expect(r.rows, String(income)).toEqual([]);
    }
  });

  it('очень маленький доход: строки с нулевой суммой не создаются, остальные не меньше единицы валюты', () => {
    const r = buildTemplateRows(t, 300, cats, none, 'TJS'); // 3 сомони
    for (const row of r.rows) expect(row.amountMinor).toBeGreaterThanOrEqual(100);
  });

  it('две категории одного набора не получают лимит дважды: берётся одна', () => {
    const r = buildTemplateRows(t, 10_000_00, [cat('Продукты'), cat('Супермаркет')], none, 'TJS');
    expect(r.rows.filter((x) => x.group === 'groceries')).toHaveLength(1);
  });

  it('все шаблоны на реальном наборе категорий дают общий лимит и хотя бы пять лимитов по категориям', () => {
    const real = [
      cat('Еда'), cat('Продукты'), cat('Транспорт'), cat('Жильё'), cat('Связь'), cat('Здоровье'), cat('Покупки'), cat('Развлечения'),
      cat('Подписки'), cat('Образование'), cat('Долги'), cat('Прочее'), cat('Семья'), cat('Коммунальные услуги'),
    ];
    for (const tpl of BUDGET_TEMPLATES) {
      const r = buildTemplateRows(tpl, 8_000_00, real, none, 'TJS');
      expect(r.rows[0]?.categoryId, tpl.id).toBeNull();
      expect(r.rows.length, tpl.id).toBeGreaterThanOrEqual(6);
      const sum = r.rows.slice(1).reduce((s, x) => s + x.amountMinor, 0);
      expect(sum, tpl.id).toBeLessThanOrEqual(r.rows[0]!.amountMinor * 1.05); // лимиты по категориям не больше общего (с запасом на округление)
    }
  });
});
