// @vitest-environment node
// Состязательные тесты разбора: ищем входы, при которых парсер молча выдаёт НЕВЕРНЫЙ курс (а не ошибку).
import { describe, expect, it } from 'vitest';
import { NOW } from './__fixtures__/testkit';
import { parseNbtXml } from './nbt';

const doc = (records: string): string => `<?xml version="1.0" encoding="UTF-8"?><ValCurs Date="10.10.2026">${records}</ValCurs>`;
const rec = (code: string, nominal: string, value: string): string =>
  `<Valute><CharCode>${code}</CharCode><Nominal>${nominal}</Nominal><Value>${value}</Value></Valute>`;

describe('NBT: Nominal с разделителем тысяч', () => {
  // Nominal — всегда целое число единиц, поэтому '10,000' / '10.000' могут означать только 10 000.
  it("Nominal '10,000' (запятая — разделитель тысяч): UZS = 8,5 / 10000, а не 8,5 / 10", () => {
    const t = parseNbtXml(doc(rec('USD', '1', '10,95') + rec('UZS', '10,000', '8,5')), NOW);
    expect(t.perUnit.UZS).toBeCloseTo(8.5 / 10000, 10);
  });

  it("Nominal '1.000' (точка — разделитель тысяч): KRW = 8,0 / 1000, а не 8,0 / 1", () => {
    const t = parseNbtXml(doc(rec('USD', '1', '10,95') + rec('KRW', '1.000', '8,0')), NOW);
    expect(t.perUnit.KRW).toBeCloseTo(8 / 1000, 10);
  });

  it("Nominal '1 000' с пробелом разбирается верно (контроль: этот вариант автор учёл)", () => {
    const t = parseNbtXml(doc(rec('USD', '1', '10,95') + rec('KRW', '1 000', '8,0')), NOW);
    expect(t.perUnit.KRW).toBeCloseTo(8 / 1000, 10);
  });
});
