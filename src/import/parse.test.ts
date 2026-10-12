import { afterEach, describe, expect, it } from 'vitest';
import { makeBigCsv } from './__fixtures__/bigCsv';
import { fixtureBytes, fixtureText } from './__fixtures__/load';
import { decodeBytes } from './decode';
import { NAME_MAX, NOTE_MAX, parseZenmoney, splitCategory } from './parse';
import { ImportFileError } from './types';

const fixture = fixtureText;

const HEAD =
  'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const parse = (...rows: string[]) => parseZenmoney([HEAD, ...rows].join('\n') + '\n');

describe('splitCategory', () => {
  it('«Родитель / Ребёнок»', () => {
    expect(splitCategory('Еда / Кафе')).toEqual(['Еда', 'Кафе']);
    expect(splitCategory('  Еда   /   Кафе ')).toEqual(['Еда', 'Кафе']);
  });
  it('без разделителя, пусто и слэш внутри слова', () => {
    expect(splitCategory('Еда')).toEqual(['Еда']);
    expect(splitCategory('')).toEqual([]);
    expect(splitCategory('   ')).toEqual([]);
    expect(splitCategory('Кафе/рестораны')).toEqual(['Кафе/рестораны']);
  });
  it('глубже двух уровней: всё лишнее — в «ребёнка»', () => {
    expect(splitCategory('A / B / C')).toEqual(['A', 'B / C']);
  });
  it('пустые части выбрасываются', () => {
    expect(splitCategory('Еда / ')).toEqual(['Еда']);
    expect(splitCategory(' / Еда')).toEqual(['Еда']);
  });
});

describe('parseZenmoney: образец basic.csv', () => {
  const p = parseZenmoney(fixture('basic.csv'));

  it('счётчики', () => {
    expect(p.totalRecords).toBe(16);
    expect(p.rows).toHaveLength(10);
    expect(p.skipped.map((s) => [s.line, s.code])).toEqual([
      [12, 'zero'],
      [13, 'no-date'],
    ]);
    expect(p.review.map((r) => [r.line, r.code])).toEqual([
      [14, 'amount-big'],
      [15, 'amount-ambiguous'],
      [16, 'amount-unreadable'],
      [17, 'date'],
    ]);
    expect(p.delimiter).toBe(',');
    expect(p.encoding).toBe('utf-8');
  });

  it('причины понятны словами и называют значение из файла', () => {
    const msg = Object.fromEntries(p.review.map((r) => [r.code, r.message]));
    expect(msg['amount-ambiguous']).toMatch(/«1,000»/);
    expect(msg['amount-unreadable']).toMatch(/«abc»/);
    expect(msg['date']).toMatch(/нет в календаре: «2023-02-29»/);
    expect(msg['amount-big']).toMatch(/слишком большая/);
  });

  it('расход с категорией и заметкой «получатель — комментарий»', () => {
    const r = p.rows[1]!;
    expect(r).toMatchObject({ line: 3, date: '2026-09-02', kind: 'expense', categoryPath: ['Продукты'], note: 'Корвон — Хлеб и молоко' });
    expect(r.outcome).toMatchObject({ amountMinor: 12050, account: { name: 'Карта Алиф', currency: 'TJS' } });
    expect(r.income).toBeNull();
  });

  it('иерархия категорий и кавычки в комментарии', () => {
    expect(p.rows[2]).toMatchObject({ categoryPath: ['Еда', 'Кафе'], note: 'Чойхона — Обед, "с коллегами"' });
  });

  it('одинаковые строки остаются двумя операциями с разными ключами', () => {
    expect(p.rows[2]!.idKey).not.toBe(p.rows[3]!.idKey);
    expect(p.rows[2]!.idKey.replace(/#\d+$/, '')).toBe(p.rows[3]!.idKey.replace(/#\d+$/, ''));
    expect(new Set(p.rows.map((r) => r.idKey)).size).toBe(p.rows.length);
  });

  it('перевод без комиссии, с комиссией и обмен валют', () => {
    const [plain, fee, exchange] = [p.rows[4]!, p.rows[5]!, p.rows[6]!];
    expect(plain).toMatchObject({ kind: 'transfer', categoryPath: [] });
    expect(plain.outcome!.amountMinor).toBe(100000);
    expect(plain.income!.amountMinor).toBe(100000);
    expect(fee.outcome!.amountMinor - fee.income!.amountMinor).toBe(500);
    expect(exchange.outcome!.account.currency).toBe('TJS');
    expect(exchange.income).toMatchObject({ amountMinor: 10000, account: { currency: 'USD' } });
  });

  it('доход в долларах и 29 февраля високосного года', () => {
    expect(p.rows[8]).toMatchObject({ kind: 'income', outcome: null });
    expect(p.rows[8]!.income).toMatchObject({ amountMinor: 2550, account: { currency: 'USD' } });
    expect(p.rows[9]).toMatchObject({ date: '2024-02-29', kind: 'income' });
  });
});

describe('parseZenmoney: образец semicolon-ru.csv (BOM, CRLF, точка с запятой, запятая в числах)', () => {
  const bytes = fixtureBytes('semicolon-ru.csv');
  it('файл на самом деле начинается с BOM и содержит CRLF', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain('\r\n');
  });

  const p = parseZenmoney(fixture('semicolon-ru.csv'));
  it('все строки разобраны', () => {
    expect(p.delimiter).toBe(';');
    expect(p.rows).toHaveLength(5 - 1);
    expect(p.review).toEqual([]);
    expect(p.skipped).toEqual([]);
  });
  it('перевод строки внутри кавычек не ломает строки и очищается в заметке', () => {
    expect(p.rows[0]).toMatchObject({ line: 2, date: '2025-03-05', note: 'Маршрутка — Дорога; домой' });
    expect(p.rows[1]!.line).toBe(4);
  });
  it('суммы: запятая, пробел-тысячи, точка-тысячи + запятая-доли; пустая сумма = нет суммы', () => {
    expect(p.rows[0]!.outcome!.amountMinor).toBe(750);
    expect(p.rows[1]!.outcome!.amountMinor).toBe(123456);
    expect(p.rows[2]!.income!.amountMinor).toBe(150000);
    expect(p.rows[3]!.kind).toBe('transfer');
  });
  it('дата с временем и иерархия категорий', () => {
    expect(p.rows[1]).toMatchObject({ date: '2025-03-06', categoryPath: ['Продукты', 'Овощи'] });
  });
});

describe('parseZenmoney: отказ и пределы', () => {
  it('не Дзен-мани: говорим словами и перечисляем столбцы', () => {
    expect(() => parseZenmoney(fixture('not-zenmoney.csv'))).toThrow(/Не похоже на файл Дзен-мани\. Нашли столбцы: Имя, Телефон, Почта/);
    expect(() => parseZenmoney(fixture('not-zenmoney.csv'))).toThrow(ImportFileError);
  });

  it('пустой файл и только заголовок', () => {
    expect(() => parseZenmoney('')).toThrow(/Файл пустой/);
    expect(() => parseZenmoney('\n\n')).toThrow(/Файл пустой/);
    const p = parseZenmoney(HEAD + '\n');
    expect(p.rows).toEqual([]);
    expect(p.totalRecords).toBe(0);
  });

  it('больше 10 МБ — отказ', () => {
    expect(() => parseZenmoney('a'.repeat(10 * 1024 * 1024 + 1))).toThrow(/больше 10 МБ/);
  });

  it('50 000 строк проходит, 50 001 — отказ', () => {
    const p = parseZenmoney(makeBigCsv(50_000));
    expect(p.totalRecords).toBe(50_000);
    expect(() => parseZenmoney(makeBigCsv(50_001))).toThrow(/больше 50 000 строк/);
  });
});

describe('parseZenmoney: логика строки', () => {
  it('расход, доход, перевод, пропуск по нулям', () => {
    const p = parse(
      '2025-01-10,Еда,,,Карта,10.00,TJS,,0,',
      '2025-01-10,Зарплата,,,,0,,Карта,20.00,TJS',
      '2025-01-10,,,,Карта,30.00,TJS,Наличные,30.00,TJS',
      '2025-01-10,Еда,,,Карта,0,TJS,Наличные,0,TJS',
    );
    expect(p.rows.map((r) => r.kind)).toEqual(['expense', 'income', 'transfer']);
    expect(p.skipped.map((s) => s.code)).toEqual(['zero']);
  });

  it('категория у перевода игнорируется', () => {
    const p = parse('2025-01-10,Еда,,,Карта,30.00,TJS,Наличные,30.00,TJS');
    expect(p.rows[0]!.categoryPath).toEqual([]);
  });

  it('перевод на тот же счёт — «нужно проверить»', () => {
    const p = parse('2025-01-10,,,,Карта,30.00,TJS,карта ,30.00,TJS');
    expect(p.review.map((r) => r.code)).toEqual(['same-account']);
    expect(p.rows).toEqual([]);
  });

  it('один счёт в двух валютах — два разных счёта', () => {
    const p = parse('2025-01-10,,,,Карта,30.00,TJS,Карта,3.00,USD');
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.outcome!.account.key).not.toBe(p.rows[0]!.income!.account.key);
  });

  it('нет валюты, непонятная валюта, нет счёта', () => {
    const p = parse(
      '2025-01-10,Еда,,,Карта,10.00,,,0,',
      '2025-01-10,Еда,,,Карта,10.00,монетки,,0,',
      '2025-01-10,Еда,,,,10.00,TJS,,0,',
    );
    expect(p.review.map((r) => r.code)).toEqual(['currency', 'currency', 'account']);
    expect(p.review[0]!.message).toBe('Не указана валюта списания');
    expect(p.review[1]!.message).toMatch(/Непонятная валюта списания: «монетки»/);
  });

  it('лишняя запятая в тексте без кавычек сдвигает столбцы — строка идёт в «нужно проверить», а не импортируется со сдвигом', () => {
    const p = parse('2025-01-10,Еда,Магазин, Мир,молоко,Карта,10.00,TJS,,0,', '2025-01-11,Еда,,,Карта,10.00,TJS,,0,');
    expect(p.review).toHaveLength(1);
    expect(p.review[0]).toMatchObject({ line: 2, code: 'columns' });
    expect(p.rows).toHaveLength(1);
  });

  it('строка короче заголовка — тоже на проверку', () => {
    const p = parse('2025-01-10,Еда,,,Карта,10.00');
    expect(p.review.map((r) => r.code)).toEqual(['columns']);
  });

  it('полностью пустые ячейки (только разделители) не считаются строкой', () => {
    const p = parse(',,,,,,,,,', '2025-01-10,Еда,,,Карта,10.00,TJS,,0,');
    expect(p.totalRecords).toBe(1);
  });

  it('отрицательная сумма, степень, переполнение, лишние знаки — на проверку', () => {
    const p = parse(
      '2025-01-10,,,,Карта,-5,TJS,,0,',
      '2025-01-10,,,,Карта,1e15,TJS,,0,',
      '2025-01-10,,,,Карта,99999999999999999999,TJS,,0,',
      '2025-01-10,,,,Карта,10.0051,TJS,,0,',
      '2025-01-10,,,,Карта,1.000,TJS,,0,',
    );
    expect(p.review.map((r) => r.code)).toEqual(['amount-negative', 'amount-unreadable', 'amount-big', 'amount-precision', 'amount-ambiguous']);
    expect(p.rows).toEqual([]);
  });

  it('предел суммы: 10 000 000 000 000,00 можно, на копейку больше — нет', () => {
    const p = parse('2025-01-10,,,,Карта,10000000000000.00,TJS,,0,', '2025-01-10,,,,Карта,10000000000000.01,TJS,,0,');
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.outcome!.amountMinor).toBe(1_000_000_000_000_000);
    expect(p.review.map((r) => r.code)).toEqual(['amount-big']);
  });

  it('суммы и валюты в разной записи дают один и тот же ключ строки', () => {
    const a = parse('2025-01-10,Еда,,,Карта,1 234,50,TJS,,0,'.replace('1 234,50', '"1 234,50"'));
    const b = parse('2025-01-10,Еда,,,Карта,1234.5,tjs,,0,');
    expect(a.rows[0]!.idKey).toBe(b.rows[0]!.idKey);
  });

  it('та же дата в двух форматах — один ключ', () => {
    const a = parse('2025-01-10,Еда,,,Карта,10,TJS,,0,');
    const b = parse('10.01.2025 08:30,Еда,,,Карта,10,TJS,,0,');
    expect(a.rows[0]!.idKey).toBe(b.rows[0]!.idKey);
  });

  it('дата вне диапазона — на проверку с отдельным кодом', () => {
    const p = parse('1999-12-31,Еда,,,Карта,10,TJS,,0,', '2100-01-02,Еда,,,Карта,10,TJS,,0,', '2100-01-01,Еда,,,Карта,10,TJS,,0,');
    expect(p.review.map((r) => r.code)).toEqual(['date-range', 'date-range']);
    expect(p.rows).toHaveLength(1);
  });
});

describe('parseZenmoney: текст', () => {
  it('длинная заметка обрезается до лимита репозитория с пометкой «…»', () => {
    const p = parse(`2025-01-10,Еда,,${'я'.repeat(800)},Карта,10,TJS,,0,`);
    const note = p.rows[0]!.note;
    expect(note.length).toBe(NOTE_MAX);
    expect(note.endsWith('…')).toBe(true);
    expect(p.notesTruncated).toBe(1);
  });

  it('заметка ровно по лимиту не трогается', () => {
    const p = parse(`2025-01-10,Еда,,${'я'.repeat(NOTE_MAX)},Карта,10,TJS,,0,`);
    expect(p.rows[0]!.note.length).toBe(NOTE_MAX);
    expect(p.rows[0]!.note.endsWith('…')).toBe(false);
    expect(p.notesTruncated).toBe(0);
  });

  it('обрезка не рвёт смайлик пополам', () => {
    const p = parse(`2025-01-10,Еда,,${'я'.repeat(NOTE_MAX - 2)}😀😀,Карта,10,TJS,,0,`);
    const note = p.rows[0]!.note;
    expect(note.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(note)).toBe(false);
    expect(note.endsWith('…')).toBe(true);
  });

  it('длинные названия счетов и категорий обрезаются до 60', () => {
    const p = parse(`2025-01-10,${'К'.repeat(80)},,,${'С'.repeat(90)},10,TJS,,0,`);
    expect(p.rows[0]!.outcome!.account.name).toHaveLength(NAME_MAX);
    expect(p.rows[0]!.categoryPath[0]).toHaveLength(NAME_MAX);
    expect(p.namesTruncated).toBe(2);
  });

  it('нулевой символ, одинокий суррогат, переводы строк и табы очищаются', () => {
    const p = parse(`2025-01-10,Еда,,"a\u0000b\ud83dc\td\ne",Карта,10,TJS,,0,`);
    // NUL, перевод строки и таб становятся пробелами, одинокая половинка смайлика исчезает
    expect(p.rows[0]!.note).toBe('a bc d e');
  });

  it('только получатель или только комментарий', () => {
    const p = parse('2025-01-10,Еда,Магазин,,Карта,10,TJS,,0,', '2025-01-10,Еда,,Просто так,Карта,10,TJS,,0,', '2025-01-10,Еда,,,Карта,10,TJS,,0,');
    expect(p.rows.map((r) => r.note)).toEqual(['Магазин', 'Просто так', '']);
  });
});

describe('parseZenmoney: другие виды файла', () => {
  /** Windows-1251: А–я = 0xC0–0xFF, Ё = 0xA8, ё = 0xB8. */
  const cp1251 = (s: string): Uint8Array =>
    Uint8Array.from(Array.from(s), (ch) => {
      const c = ch.charCodeAt(0);
      if (c < 0x80) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      if (c === 0x401) return 0xa8;
      if (c === 0x451) return 0xb8;
      throw new Error(`нет в cp1251: ${ch}`);
    });

  it('табуляция как разделитель, русские заголовки, точка и запятая', () => {
    const rows = [
      ['Дата', 'Категория', 'Получатель', 'Комментарий', 'Счёт списания', 'Сумма списания', 'Валюта списания', 'Счёт зачисления', 'Сумма зачисления', 'Валюта зачисления'],
      ['2025-03-01', 'Еда', '', 'обед', 'Карта', '12,5', 'TJS', '', '', ''],
      ['01.03.2025', 'Еда', '', 'ужин', 'Карта', '7.25', 'TJS', '', '0', ''],
    ];
    const p = parseZenmoney(rows.map((r) => r.join('\t')).join('\n'));
    expect(p.delimiter).toBe('\t');
    expect(p.rows.map((r) => r.outcome!.amountMinor)).toEqual([1250, 725]);
    expect(p.review).toEqual([]);
  });

  it('файл в Windows-1251 (Excel) читается целиком, включая «ё» в названиях', () => {
    const text = [
      'date;categoryName;payee;comment;outcomeAccountName;outcome;outcomeCurrencyShortTitle;incomeAccountName;income;incomeCurrencyShortTitle',
      '2025-03-01;Ёлки;Магазин;подарок;Счёт Ёж;10,50;TJS;;0;',
    ].join('\r\n');
    const decoded = decodeBytes(cp1251(text));
    expect(decoded.encoding).toBe('windows-1251');
    const p = parseZenmoney(decoded.text, decoded.encoding);
    expect(p.encoding).toBe('windows-1251');
    expect(p.rows[0]).toMatchObject({ categoryPath: ['Ёлки'], note: 'Магазин — подарок' });
    expect(p.rows[0]!.outcome!.account.name).toBe('Счёт Ёж');
  });

  it('кавычки вокруг всех полей, включая заголовок', () => {
    const q = (cells: string[]) => cells.map((c) => `"${c}"`).join(',');
    const text = [
      q(['date', 'categoryName', 'payee', 'comment', 'outcomeAccountName', 'outcome', 'outcomeCurrencyShortTitle', 'incomeAccountName', 'income', 'incomeCurrencyShortTitle']),
      q(['2025-03-01', 'Еда', '', 'с "кавычкой" внутри'.replace(/"/g, '""'), 'Карта', '1,000.50', 'TJS', '', '0', '']),
    ].join('\n');
    const p = parseZenmoney(text);
    expect(p.rows[0]).toMatchObject({ note: 'с "кавычкой" внутри' });
    expect(p.rows[0]!.outcome!.amountMinor).toBe(100050);
  });
});

describe('часовой пояс устройства не влияет на разбор', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('один и тот же результат в разных поясах, в том числе у линии перемены дат', () => {
    const text = fixture('basic.csv') + '2026-03-29 23:59:59,Еда,,,Наличные,1.00,TJS,,0,,,,\n' + '2026-03-29T00:00:00Z,Еда,,,Наличные,2.00,TJS,,0,,,,\n';
    const results = ['UTC', 'Asia/Dushanbe', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles', 'Europe/Moscow'].map((tz) => {
      process.env.TZ = tz;
      const p = parseZenmoney(text);
      return JSON.stringify(p.rows.map((r) => [r.date, r.idKey]));
    });
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain('"2026-03-29"');
    expect(results[0]).toContain('"2024-02-29"');
  });
});
