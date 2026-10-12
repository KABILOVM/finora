import { describe, expect, it } from 'vitest';
import { MAX_PARSED_ITEMS, normalizeAiItems } from './shoppingAi';

describe('normalizeAiItems: ответ ИИ приводится к правилам списка', () => {
  it('нормальный ответ: имя с большой буквы, количество в тысячных долях', () => {
    expect(
      normalizeAiItems([
        { name: 'мука', qty: 1, unit: 'pcs' },
        { name: 'масло сливочное', qty: 0.2, unit: 'kg' },
        { name: 'молоко', qty: 2, unit: 'l' },
        { name: 'яблоки', qty: 1.5, unit: 'kg' },
      ]),
    ).toEqual([
      { name: 'Мука', qtyMilli: 1000, unit: 'pcs' },
      { name: 'Масло сливочное', qtyMilli: 200, unit: 'kg' },
      { name: 'Молоко', qtyMilli: 2000, unit: 'l' },
      { name: 'Яблоки', qtyMilli: 1500, unit: 'kg' },
    ]);
  });

  it('штуки — только целые; дробь округляется, нуль и минус дают 1', () => {
    const r = normalizeAiItems([
      { name: 'хлеб', qty: 2.6, unit: 'pcs' },
      { name: 'яйца', qty: 0, unit: 'pcs' },
      { name: 'соль', qty: -4, unit: 'pcs' },
    ]);
    expect(r.map((i) => i.qtyMilli)).toEqual([3000, 1000, 1000]);
  });

  it('лишние знаки после тысячных округляются, слишком маленькое — минимум 0,001', () => {
    const r = normalizeAiItems([
      { name: 'чай', qty: 0.1234, unit: 'kg' },
      { name: 'перец', qty: 0.00001, unit: 'kg' },
    ]);
    expect(r.map((i) => i.qtyMilli)).toEqual([123, 1]);
  });

  it('неизвестная единица → штуки; количество не число → 1', () => {
    expect(normalizeAiItems([{ name: 'вода', qty: 'три', unit: 'бутылки' }])).toEqual([{ name: 'Вода', qtyMilli: 1000, unit: 'pcs' }]);
  });

  it('мусор отбрасывается: не массив, не объекты, пустые и нестроковые имена, слишком большое количество', () => {
    expect(normalizeAiItems(null)).toEqual([]);
    expect(normalizeAiItems('молоко')).toEqual([]);
    expect(normalizeAiItems([null, 5, 'x', { name: '' }, { name: '   ' }, { name: 7 }, { qty: 1 }, { name: 'гора', qty: 1e12, unit: 'kg' }])).toEqual([]);
  });

  it('пробелы схлопываются, длинное имя режется до 80 знаков, не больше 100 позиций', () => {
    const [a] = normalizeAiItems([{ name: '  сыр    моцарелла ', qty: 1, unit: 'pcs' }]);
    expect(a!.name).toBe('Сыр моцарелла');
    const [b] = normalizeAiItems([{ name: 'ж'.repeat(200), qty: 1, unit: 'pcs' }]);
    expect(b!.name).toHaveLength(80);
    const many = Array.from({ length: 300 }, (_, i) => ({ name: `товар ${i}`, qty: 1, unit: 'pcs' }));
    expect(normalizeAiItems(many)).toHaveLength(MAX_PARSED_ITEMS);
  });
});
