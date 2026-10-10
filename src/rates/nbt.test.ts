// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NBT_ALL_GARBAGE,
  NBT_ATTR_STYLE,
  NBT_CHILD_STYLE,
  NBT_FUTURE,
  NBT_GARBAGE,
  NBT_HTML,
  NBT_HUGE_NUMBERS,
  NBT_NO_DATE,
  NBT_TWO_DATES,
  NBT_VALUTE_STYLE,
  NBT_WITH_DOCTYPE,
} from './__fixtures__/nbt.fixtures';
import { NOW, encodeWin1251, failResponse, okResponse, routeFetch } from './__fixtures__/testkit';
import { NBT_URL, nbtProvider, parseNbtXml } from './nbt';
import { RateParseError, isRateValue } from './parseUtil';

const parse = (xml: string, now: Date = NOW) => parseNbtXml(xml, now);

describe('parseNbtXml: нормальные раскладки', () => {
  it('раскладка «Valute»: запятая, Nominal, дата DD.MM.YYYY из атрибута корня', () => {
    const t = parse(NBT_VALUTE_STYLE);
    expect(t.asOf).toBe('2026-10-10');
    expect(t.pivot).toBe('TJS');
    expect(t.source).toBe('nbt');
    expect(t.fetchedAt).toBe(NOW.toISOString());
    expect(t.perUnit.TJS).toBe(1);
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.perUnit.EUR).toBe(12.78);
    expect(t.perUnit.RUB).toBe(0.1189);
    expect(t.perUnit.KZT).toBeCloseTo(0.0205, 12); // 2,05 за 100
    expect(t.perUnit.UZS).toBeCloseTo(0.00085, 12); // 8,5 за 10000
    expect(t.perUnit.JPY).toBeCloseTo(0.072, 12); // 7,2 за 100
    expect(Object.keys(t.perUnit)).toEqual(['TJS', 'EUR', 'JPY', 'KZT', 'RUB', 'USD', 'UZS']);
    expect(t.warnings).toEqual([]);
  });

  it('раскладка «дочерние поля»: дата YYYY-MM-DD в дочернем теге, точка, Nominal 10 и 100', () => {
    const t = parse(NBT_CHILD_STYLE);
    expect(t.asOf).toBe('2026-10-10');
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.perUnit.RUB).toBeCloseTo(0.1189, 12); // 1,189 за 10
    expect(t.perUnit.KGS).toBeCloseTo(0.125, 12); // 12,5 за 100
  });

  it('раскладка «атрибуты»: нижний регистр, самозакрывающиеся теги, Nominal «1 000»', () => {
    const t = parse(NBT_ATTR_STYLE);
    expect(t.asOf).toBe('2026-10-10');
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.perUnit.EUR).toBe(12.78);
    expect(t.perUnit.UZS).toBeCloseTo(0.00085, 12);
    expect(t.perUnit.KZT).toBeCloseTo(0.0205, 12);
  });

  it('разные раскладки с теми же числами дают один и тот же курс', () => {
    const a = parse(NBT_VALUTE_STYLE).perUnit;
    const b = parse(NBT_CHILD_STYLE).perUnit;
    const c = parse(NBT_ATTR_STYLE).perUnit;
    for (const code of ['USD', 'EUR']) {
      expect(b[code]).toBe(a[code]);
      expect(c[code]).toBe(a[code]);
    }
  });

  it('BOM в начале, пространства имён и CDATA не мешают', () => {
    const xml = `﻿<n:ValCurs xmlns:n="urn:x" n:Date="10.10.2026"><n:Valute><n:CharCode><![CDATA[usd]]></n:CharCode><n:Nominal>1</n:Nominal><n:Value>10,95</n:Value></n:Valute></n:ValCurs>`;
    const t = parse(xml);
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.asOf).toBe('2026-10-10');
  });

  it('DOCTYPE, пользовательские сущности и числовые коды: разбор не ломается и сущности не раскрываются', () => {
    const t = parse(NBT_WITH_DOCTYPE);
    expect(t.perUnit.USD).toBe(10.95);
    expect(Object.keys(t.perUnit)).toEqual(['TJS', 'USD']);
  });

  it('имя поля вроде __proto__ не загрязняет Object.prototype', () => {
    const xml = `<ValCurs Date="10.10.2026"><Valute __proto__="polluted" polluted="yes" CharCode="USD" Value="1,5"/></ValCurs>`;
    const t = parse(xml);
    expect(t.perUnit.USD).toBe(1.5);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('parseNbtXml: мусор отбрасывается, но не молча', () => {
  it('нулевые, отрицательные, нечисловые, степени, нулевой/нечисловой Nominal, запись без буквенного кода', () => {
    const t = parse(NBT_GARBAGE);
    expect(Object.keys(t.perUnit)).toEqual(['TJS', 'GBP', 'JPY', 'USD']);
    const w = t.warnings.join('\n');
    for (const code of ['EUR', 'RUB', 'KZT', 'CNY', 'CHF', 'TRY']) expect(w).toContain(code);
    expect(w).toContain('784'); // запись без буквенного кода
  });

  it('дубликат кода: берётся первая запись, дубль попадает в warnings', () => {
    const t = parse(NBT_GARBAGE);
    expect(t.perUnit.GBP).toBe(14.5);
    expect(t.warnings.some((x) => x.includes('Дубль GBP'))).toBe(true);
  });

  it('если первая запись кода негодная, вторая её НЕ подменяет (спорные данные не угадываем)', () => {
    const xml = `<ValCurs Date="10.10.2026">
      <Valute><CharCode>EUR</CharCode><Value>0</Value></Valute>
      <Valute><CharCode>EUR</CharCode><Value>12,78</Value></Valute>
      <Valute><CharCode>USD</CharCode><Value>10,95</Value></Valute></ValCurs>`;
    const t = parse(xml);
    expect(t.perUnit.EUR).toBeUndefined();
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.warnings.some((x) => x.includes('Дубль EUR'))).toBe(true);
  });

  it('дробный Nominal («1,5») не угадывается: запись отбрасывается с предупреждением, остальные целы', () => {
    const xml = `<ValCurs Date="10.10.2026">
      <Valute><CharCode>UZS</CharCode><Nominal>1,5</Nominal><Value>8,5</Value></Valute>
      <Valute><CharCode>KZT</CharCode><Nominal>100,00</Nominal><Value>2,1</Value></Valute>
      <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>10,95</Value></Valute></ValCurs>`;
    const t = parse(xml);
    expect(t.perUnit.UZS).toBeUndefined();
    expect(t.warnings.some((x) => x.includes('UZS') && x.includes('Nominal'))).toBe(true);
    expect(t.perUnit.KZT).toBeCloseTo(0.021, 12); // '100,00' — просто 100
    expect(t.perUnit.USD).toBe(10.95);
  });

  it('TJS в списке игнорируется: опорный курс всегда ровно 1', () => {
    const xml = `<ValCurs Date="10.10.2026">
      <Valute><CharCode>TJS</CharCode><Value>5</Value></Valute>
      <Valute><CharCode>USD</CharCode><Value>10,95</Value></Valute></ValCurs>`;
    expect(parse(xml).perUnit.TJS).toBe(1);
  });

  it('огромные числа (400 цифр, 1e23, 1e-16) отбрасываются, остаётся нормальная запись', () => {
    const t = parse(NBT_HUGE_NUMBERS);
    expect(Object.keys(t.perUnit)).toEqual(['TJS', 'JPY']);
    expect(t.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('все курсы негодные → ошибка, а не пустая таблица', () => {
    expect(() => parse(NBT_ALL_GARBAGE)).toThrow(RateParseError);
    expect(() => parse(NBT_ALL_GARBAGE)).toThrow(/корректного курса/);
  });

  it('предупреждений не больше лимита, даже если мусора тысячи', () => {
    const junk = Array.from({ length: 500 }, (_, i) => `<Valute><CharCode>${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i / 26) | 0) % 26)}Z</CharCode><Value>0</Value></Valute>`).join('');
    const t = parse(`<ValCurs Date="10.10.2026">${junk}<Valute><CharCode>USD</CharCode><Value>10,95</Value></Valute></ValCurs>`);
    expect(t.warnings.length).toBeLessThanOrEqual(31);
  });
});

describe('parseNbtXml: плохие ответы', () => {
  it.each([
    ['пустая строка', '', /Пустой ответ/],
    ['одни пробелы', ' \n\t ', /Пустой ответ/],
    ['HTML вместо XML (doctype)', NBT_HTML, /HTML/],
    ['HTML без doctype', '<html><body>Bad gateway</body></html>', /HTML/],
    ['обычный текст', 'Service Unavailable', /не похож на XML/],
    ['XML без курсов', '<ValCurs Date="10.10.2026"></ValCurs>', /Не найдено ни одного курса/],
    ['нет даты', NBT_NO_DATE, /нет даты/],
    ['две разные даты', NBT_TWO_DATES, /несколько разных дат/],
    ['дата из будущего', NBT_FUTURE, /из будущего/],
    ['нечитаемая дата', NBT_VALUTE_STYLE.replace('10.10.2026', '32.13.2026'), /Не удалось разобрать дату/],
  ])('%s → RateParseError', (_name, xml, re) => {
    expect(() => parse(xml)).toThrow(RateParseError);
    expect(() => parse(xml)).toThrow(re);
  });

  it('не строка → RateParseError', () => {
    expect(() => parseNbtXml(null as unknown as string)).toThrow(RateParseError);
  });

  it('дата «завтра» допустима (часовые пояса), «послезавтра» — нет', () => {
    expect(parse(NBT_VALUTE_STYLE.replace('10.10.2026', '11.10.2026')).asOf).toBe('2026-10-11');
    expect(() => parse(NBT_VALUTE_STYLE.replace('10.10.2026', '12.10.2026'))).toThrow(/из будущего/);
  });

  it('слишком глубокая вложенность и слишком большой ответ', () => {
    expect(() => parse('<a>'.repeat(200) + 'x')).toThrow(/вложенность/);
    expect(() => parse(`<a>${'x'.repeat(5_000_001)}</a>`)).toThrow(/слишком большой/);
  });

  it('десятки тысяч элементов (мусор / атака) отвергаются быстро, не съедая память', () => {
    const started = Date.now();
    expect(() => parse(`<a>${'<b/>'.repeat(200_000)}</a>`)).toThrow(/Слишком много элементов/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('патологические входы разбираются за линейное время', () => {
    const started = Date.now();
    for (const junk of ['<'.repeat(1_000_000), '&'.repeat(1_000_000), '<a b="'.repeat(100_000), '<!--'.repeat(100_000), '<![CDATA['.repeat(50_000), '<!DOCTYPE x ['.repeat(50_000), '</x>'.repeat(200_000)]) {
      try {
        parse(junk);
      } catch (e) {
        expect(e).toBeInstanceOf(RateParseError);
      }
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('оборванный посередине XML: либо разобрался по тому, что есть, либо понятная ошибка — никогда не другое исключение', () => {
    for (let cut = 0; cut < NBT_VALUTE_STYLE.length; cut += 7) {
      try {
        const t = parse(NBT_VALUTE_STYLE.slice(0, cut));
        expect(Object.values(t.perUnit).every(isRateValue)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(RateParseError);
      }
    }
  });

  it('свойство: на любой строке — только RateParseError или корректная таблица', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        try {
          const t = parseNbtXml(s, NOW);
          expect(t.perUnit.TJS).toBe(1);
          expect(Object.values(t.perUnit).every(isRateValue)).toBe(true);
          expect(t.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        } catch (e) {
          expect(e).toBeInstanceOf(RateParseError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('свойство: порча образца (вырезанный кусок, вставленный мусор) не даёт плохих чисел', () => {
    fc.assert(
      fc.property(
        fc.nat(NBT_VALUTE_STYLE.length),
        fc.nat(120),
        fc.string({ maxLength: 20 }),
        (start, len, junk) => {
          const xml = NBT_VALUTE_STYLE.slice(0, start) + junk + NBT_VALUTE_STYLE.slice(start + len);
          try {
            const t = parseNbtXml(xml, NOW);
            expect(Object.values(t.perUnit).every(isRateValue)).toBe(true);
            expect(t.perUnit.TJS).toBe(1);
          } catch (e) {
            expect(e).toBeInstanceOf(RateParseError);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('несколько тысяч записей разбираются быстро', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => {
      const code = `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (((i / 26) | 0) % 26))}${String.fromCharCode(65 + (((i / 676) | 0) % 26))}`;
      return `<Valute><CharCode>${code}</CharCode><Nominal>1</Nominal><Value>1,5</Value></Valute>`;
    }).join('');
    const started = Date.now();
    const t = parse(`<ValCurs Date="10.10.2026">${rows}</ValCurs>`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(Object.keys(t.perUnit).length).toBeGreaterThan(1000);
  });
});

describe('nbtProvider', () => {
  const opts = { now: () => NOW };

  it('запрашивает адрес Нацбанка без кэша и без cookie, передаёт signal и разбирает ответ', async () => {
    const fetchImpl = routeFetch(() => okResponse(NBT_VALUTE_STYLE, 'application/xml; charset=utf-8'));
    const ctrl = new AbortController();
    const table = await nbtProvider(fetchImpl, opts).fetchLatest(ctrl.signal);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]?.url).toBe(NBT_URL);
    expect(fetchImpl.calls[0]?.init).toMatchObject({ signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
    expect(table.source).toBe('nbt');
    expect(table.perUnit.USD).toBe(10.95);
  });

  it('id провайдера — «nbt»; адрес можно заменить', async () => {
    const fetchImpl = routeFetch(() => okResponse(NBT_VALUTE_STYLE));
    const p = nbtProvider(fetchImpl, { ...opts, url: 'https://example.test/rates.xml' });
    expect(p.id).toBe('nbt');
    await p.fetchLatest();
    expect(fetchImpl.calls[0]?.url).toBe('https://example.test/rates.xml');
  });

  it('историческая выдача в windows-1251 (по заголовку и по объявлению) разбирается', async () => {
    const asHeader = routeFetch(() => okResponse(encodeWin1251(NBT_VALUTE_STYLE), 'text/xml; charset=windows-1251'));
    expect((await nbtProvider(asHeader, opts).fetchLatest()).perUnit.EUR).toBe(12.78);
    const asDecl = routeFetch(() => okResponse(encodeWin1251(NBT_VALUTE_STYLE.replace('encoding="UTF-8"', 'encoding="windows-1251"'))));
    expect((await nbtProvider(asDecl, opts).fetchLatest()).perUnit.EUR).toBe(12.78);
  });

  it('HTTP-ошибка, отсутствие сети, HTML и пустой ответ — это отказ (rejects), а не пустая таблица', async () => {
    await expect(nbtProvider(routeFetch(() => failResponse(503)), opts).fetchLatest()).rejects.toThrow(/Источник курсов сейчас не работает \(ошибка 503\)/);
    await expect(
      nbtProvider(
        routeFetch(() => {
          throw new TypeError('Failed to fetch');
        }),
        opts,
      ).fetchLatest(),
    ).rejects.toThrow(/Нет связи с источником курсов/);
    await expect(nbtProvider(routeFetch(() => okResponse(NBT_HTML, 'text/html')), opts).fetchLatest()).rejects.toThrow(/HTML/);
    await expect(nbtProvider(routeFetch(() => okResponse('')), opts).fetchLatest()).rejects.toThrow(/Пустой ответ/);
  });

  it('уже отменённый signal: запрос даже не отправляется', async () => {
    const fetchImpl = routeFetch(() => okResponse(NBT_VALUTE_STYLE));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(nbtProvider(fetchImpl, opts).fetchLatest(ctrl.signal)).rejects.toThrow();
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
