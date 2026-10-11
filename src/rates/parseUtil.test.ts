// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { encodeWin1251 } from './__fixtures__/testkit';
import { MAX_WARNINGS, boundWarnings, decodeBody, daysBetween, isFutureDate, isRateValue, normalizeDate, parseDecimal, parseNominal } from './parseUtil';

describe('parseDecimal', () => {
  it.each([
    ['10,95', 10.95],
    ['10.95', 10.95],
    ['  10,95  ', 10.95],
    ['1 234,5', 1234.5],
    ['1 234,5', 1234.5],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['0', 0],
    ['.5', 0.5],
    ['5.', 5],
    ['0,0000012', 0.0000012],
  ])('%j → %d', (input, expected) => {
    expect(parseDecimal(input)).toBeCloseTo(expected, 12);
  });

  it.each(['', '   ', 'abc', '-1', '+1', '1e5', '1E5', 'NaN', 'Infinity', '1,2,3', '1.2.3', '1,234.56.7', '1.2.3,4', ',234,567', '1234,567,890', '.', ',', '1 2 a', '١٢٣'])(
    '%j → null',
    (input) => {
      expect(parseDecimal(input)).toBeNull();
    },
  );

  it('не-строка → null', () => {
    expect(parseDecimal(undefined as unknown as string)).toBeNull();
    expect(parseDecimal(5 as unknown as string)).toBeNull();
  });

  it('огромное число из цифр, не помещающееся в double → null (а не Infinity)', () => {
    expect(parseDecimal('9'.repeat(400))).toBeNull();
  });
});

describe('parseNominal: номинал — целое число единиц', () => {
  it.each([
    ['1', 1],
    ['10', 10],
    ['100', 100],
    ['1 000', 1000],
    ['1\u00a0000', 1000],
    ['1,000', 1000], // запятая в целом поле — разделитель тысяч, а не десятичный
    ['1.000', 1000],
    ['10,000', 10000],
    ['10.000', 10000],
    ['100,000', 100000],
    ['1,000,000', 1000000],
    ['1.000.000', 1000000],
    ['1.0', 1], // хвост из нулей — всё то же целое
    ['1,00', 1],
    ['10,0', 10],
    ['1000,00', 1000],
    ['  10  ', 10],
  ])('«%s» → %d', (input, expected) => {
    expect(parseNominal(input)).toBe(expected);
  });

  it.each(['', ' ', '0', '0,000', '0.0', '1,5', '0,5', '1.50', '0.001', '1,0001', '12,34', '1,000.00', '1e3', '-10', '+10', 'десять', '1,2,3', '1..000', ',000', '10,', '9'.repeat(30)])(
    '«%s» → null (запись отбрасывают, а не угадывают масштаб)',
    (input) => {
      expect(parseNominal(input)).toBeNull();
    },
  );

  it('не строка → null', () => {
    expect(parseNominal(undefined as unknown as string)).toBeNull();
    expect(parseNominal(10 as unknown as string)).toBeNull();
  });
});

describe('isRateValue', () => {
  it('принимает только конечные числа в допустимых пределах', () => {
    expect(isRateValue(10.95)).toBe(true);
    expect(isRateValue(1e-9)).toBe(true);
    expect(isRateValue(1e9)).toBe(true);
    for (const bad of [0, -1, NaN, Infinity, -Infinity, 1e-10, 1e10, 1e23, '5', null, undefined]) expect(isRateValue(bad)).toBe(false);
  });
});

describe('normalizeDate', () => {
  it.each([
    ['10.10.2026', '2026-10-10'],
    ['2026-10-10', '2026-10-10'],
    ['2026-10-10T20:00:00Z', '2026-10-10'],
    ['2026-10-10 08:30', '2026-10-10'],
    ['2026/10/10', '2026-10-10'],
    ['1.2.2026', '2026-02-01'],
    ['20261010', '2026-10-10'],
    ['29.02.2028', '2028-02-29'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it.each(['', 'вчера', '31.02.2026', '29.02.2027', '2026-13-01', '2026-00-10', '10.10.26', '10.10', '99.99.9999', '0000-00-00'])('%j → null', (input) => {
    expect(normalizeDate(input)).toBeNull();
  });

  it('не-строка → null', () => {
    expect(normalizeDate(20261010 as unknown as string)).toBeNull();
  });
});

describe('даты', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('isFutureDate: сегодня и завтра допустимы (часовые пояса), послезавтра — уже будущее', () => {
    expect(isFutureDate('2026-10-09', now)).toBe(false);
    expect(isFutureDate('2026-10-10', now)).toBe(false);
    expect(isFutureDate('2026-10-11', now)).toBe(false);
    expect(isFutureDate('2026-10-12', now)).toBe(true);
    expect(isFutureDate('2036-10-10', now)).toBe(true);
  });
  it('daysBetween считает календарные сутки, в том числе через границу месяца и високосный год', () => {
    expect(daysBetween('2026-10-07', '2026-10-10')).toBe(3);
    expect(daysBetween('2026-10-10', '2026-10-07')).toBe(-3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0);
  });
});

describe('decodeBody', () => {
  const text = '<a>Доллар США</a>';

  it('UTF-8 по умолчанию и с BOM', () => {
    const utf8 = new TextEncoder().encode(text);
    expect(decodeBody(utf8)).toBe(text);
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeBody(withBom)).toBe(text);
  });

  it('windows-1251 по заголовку Content-Type', () => {
    expect(decodeBody(encodeWin1251(text), 'text/xml; charset=windows-1251')).toBe(text);
    expect(decodeBody(encodeWin1251(text), 'text/xml; charset="Windows-1251"')).toBe(text);
  });

  it('windows-1251 по объявлению <?xml encoding="...">', () => {
    const xml = `<?xml version="1.0" encoding="windows-1251"?>${text}`;
    expect(decodeBody(encodeWin1251(xml))).toBe(xml);
  });

  it('заголовок важнее объявления', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>${text}`;
    expect(decodeBody(encodeWin1251(xml), 'text/xml; charset=windows-1251')).toBe(xml);
  });

  it('UTF-16 по BOM', () => {
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      le[2 + i * 2] = c & 0xff;
      le[3 + i * 2] = c >> 8;
    }
    expect(decodeBody(le)).toBe(text);
  });

  it('неизвестная кодировка → запасной UTF-8, без исключения', () => {
    expect(decodeBody(new TextEncoder().encode('abc'), 'text/xml; charset=no-such-charset')).toBe('abc');
  });

  it('принимает ArrayBuffer и не падает на мусорных байтах', () => {
    const buf = new TextEncoder().encode('abc').buffer as ArrayBuffer;
    expect(decodeBody(buf)).toBe('abc');
    expect(() => decodeBody(Uint8Array.from([0xff, 0x00, 0xc3, 0x28]))).not.toThrow();
  });
});

describe('boundWarnings', () => {
  it('короткий список возвращает копией, длинный обрезает и сообщает сколько скрыто', () => {
    const short = ['a', 'b'];
    expect(boundWarnings(short)).toEqual(short);
    expect(boundWarnings(short)).not.toBe(short);
    const long = Array.from({ length: MAX_WARNINGS + 5 }, (_, i) => `w${i}`);
    const out = boundWarnings(long);
    expect(out).toHaveLength(MAX_WARNINGS + 1);
    expect(out.at(-1)).toBe('…и ещё 5');
  });
});
