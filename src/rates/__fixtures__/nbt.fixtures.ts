/*
 * !!! ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ — образцы составлены по предположению !!!
 * Это НЕ копии настоящих ответов nbt.tj: сеть при разработке была закрыта. Числа выдуманы.
 * Каждый образец проверяет одну ВОЗМОЖНУЮ раскладку разметки; настоящий ответ может отличаться от всех трёх.
 * Дата во всех образцах — 2026-10-10 (в тестах «сегодня» = 2026-10-10T12:00:00Z).
 */

const WARN = '<!-- ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ — образец составлен по предположению -->';

/** Раскладка 1: как у ЦБ РФ — корень с датой-атрибутом, <Valute> с дочерними полями, десятичная запятая, Nominal. */
export const NBT_VALUTE_STYLE = `<?xml version="1.0" encoding="UTF-8"?>
${WARN}
<ValCurs Date="10.10.2026" name="Образец: официальные курсы">
  <Valute ID="840"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>Доллар США</Name><Value>10,9500</Value></Valute>
  <Valute ID="978"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>Евро</Name><Value>12,7800</Value></Valute>
  <Valute ID="643"><NumCode>643</NumCode><CharCode>RUB</CharCode><Nominal>1</Nominal><Name>Российский рубль</Name><Value>0,1189</Value></Valute>
  <Valute ID="398"><NumCode>398</NumCode><CharCode>KZT</CharCode><Nominal>100</Nominal><Name>Тенге</Name><Value>2,0500</Value></Valute>
  <Valute ID="860"><NumCode>860</NumCode><CharCode>UZS</CharCode><Nominal>10000</Nominal><Name>Узбекский сум</Name><Value>8,5000</Value></Valute>
  <Valute ID="392"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal><Name>Иена</Name><Value>7,2000</Value></Valute>
</ValCurs>`;

/** Раскладка 2: дата — дочерний элемент в формате ISO, поля в <Currency>, десятичная точка. */
export const NBT_CHILD_STYLE = `<?xml version="1.0" encoding="utf-8"?>
${WARN}
<Rates>
  <Date>2026-10-10</Date>
  <Currency><Code>USD</Code><Nominal>1</Nominal><Rate>10.95</Rate></Currency>
  <Currency><Code>EUR</Code><Nominal>1</Nominal><Rate>12.78</Rate></Currency>
  <Currency><Code>RUB</Code><Nominal>10</Nominal><Rate>1.189</Rate></Currency>
  <Currency><Code>KGS</Code><Nominal>100</Nominal><Rate>12.5</Rate></Currency>
</Rates>`;

/** Раскладка 3: всё атрибутами, имена в нижнем регистре, самозакрывающиеся теги, пробелы-разделители тысяч. */
export const NBT_ATTR_STYLE = `<?xml version='1.0'?>
${WARN}
<rates date="10.10.2026">
  <currency code="USD" nominal="1" value="10.95"/>
  <currency code="EUR" nominal="1" value='12.78'/>
  <currency code="UZS" nominal="1 000" value="0,85"/>
  <currency code="KZT" nominal="100" value="2.05" />
</rates>`;

/** Мусор вперемешку с нормальными записями: должны остаться только USD, GBP, JPY. */
export const NBT_GARBAGE = `<?xml version="1.0" encoding="UTF-8"?>
${WARN}
<ValCurs Date="10.10.2026">
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>10,95</Value></Valute>
  <Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>0</Value></Valute>
  <Valute><CharCode>RUB</CharCode><Nominal>1</Nominal><Value>-0,12</Value></Valute>
  <Valute><CharCode>KZT</CharCode><Nominal>100</Nominal><Value>н/д</Value></Valute>
  <Valute><CharCode>GBP</CharCode><Nominal>1</Nominal><Value>14,50</Value></Valute>
  <Valute><CharCode>GBP</CharCode><Nominal>1</Nominal><Value>99,00</Value></Valute>
  <Valute><CharCode>CNY</CharCode><Nominal>0</Nominal><Value>1,50</Value></Valute>
  <Valute><CharCode>CHF</CharCode><Nominal>сто</Nominal><Value>13,00</Value></Valute>
  <Valute><CharCode>TRY</CharCode><Nominal>1</Nominal><Value>1e5</Value></Valute>
  <Valute><Code>784</Code><Nominal>1</Nominal><Value>2,98</Value></Valute>
  <Valute><CharCode>JPY</CharCode><Nominal>100</Nominal><Value>7,20</Value></Valute>
  <Valute><CharCode>TJS</CharCode><Nominal>1</Nominal><Value>1,00</Value></Valute>
</ValCurs>`;

/** Огромные числа: только JPY нормальный. */
export const NBT_HUGE_NUMBERS = `<?xml version="1.0"?>
${WARN}
<ValCurs Date="10.10.2026">
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>${'9'.repeat(400)}</Value></Valute>
  <Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>99999999999999999999999</Value></Valute>
  <Valute><CharCode>RUB</CharCode><Nominal>${'9'.repeat(400)}</Nominal><Value>1</Value></Valute>
  <Valute><CharCode>GBP</CharCode><Nominal>1</Nominal><Value>0,0000000000000001</Value></Valute>
  <Valute><CharCode>JPY</CharCode><Nominal>100</Nominal><Value>7,20</Value></Valute>
</ValCurs>`;

/** Ни одной пригодной записи. */
export const NBT_ALL_GARBAGE = `<?xml version="1.0"?>
${WARN}
<ValCurs Date="10.10.2026">
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>0</Value></Valute>
  <Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>abc</Value></Valute>
</ValCurs>`;

export const NBT_HTML = `<!DOCTYPE html>
<html><head><title>403 Forbidden</title></head><body><h1>Доступ запрещён</h1><p>Попробуйте позже</p></body></html>`;

export const NBT_NO_DATE = `<?xml version="1.0"?>
${WARN}
<ValCurs><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>10,95</Value></Valute></ValCurs>`;

export const NBT_TWO_DATES = `<?xml version="1.0"?>
${WARN}
<ValCurs Date="10.10.2026">
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>10,95</Value><Date>09.10.2026</Date></Valute>
</ValCurs>`;

export const NBT_FUTURE = NBT_VALUTE_STYLE.replace('Date="10.10.2026"', 'Date="10.10.2036"');

/** С объявлением DOCTYPE, пользовательскими сущностями, CDATA и числовыми кодами — ничего из этого не должно ломать разбор. */
export const NBT_WITH_DOCTYPE = `<?xml version="1.0"?>
<!DOCTYPE ValCurs [ <!ENTITY lol "lol"> <!ENTITY lol2 "&lol;&lol;&lol;&lol;"> ]>
${WARN}
<ValCurs Date="10.10.2026" name="&lol2; &amp; &#1044;">
  <Valute><CharCode><![CDATA[USD]]></CharCode><Nominal>1</Nominal><Value>10,95</Value></Valute>
</ValCurs>`;
