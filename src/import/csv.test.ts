import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv';
import { ImportFileError } from './types';

const cells = (text: string) => parseCsv(text).records.map((r) => r.cells);

describe('parseCsv: разделители', () => {
  it('запятая', () => {
    expect(cells('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('точка с запятой: запятые в числах остаются внутри ячеек', () => {
    const r = parseCsv('a;b;c\n1,5;2,25;3\n');
    expect(r.delimiter).toBe(';');
    expect(r.records[1]!.cells).toEqual(['1,5', '2,25', '3']);
  });

  it('табуляция', () => {
    const r = parseCsv('a\tb\n1\t2\n');
    expect(r.delimiter).toBe('\t');
    expect(r.records[1]!.cells).toEqual(['1', '2']);
  });

  it('разделитель берётся из заголовка, а не из данных', () => {
    expect(detectDelimiter('a;b;c\n1,2,3,4,5,6\n')).toBe(';');
  });

  it('разделители внутри кавычек в заголовке не считаются', () => {
    expect(detectDelimiter('"a,b,c,d";e;f\n')).toBe(';');
  });

  it('нет ни одного разделителя — одна колонка', () => {
    const r = parseCsv('просто текст\nвторая строка\n');
    expect(r.records.map((x) => x.cells)).toEqual([['просто текст'], ['вторая строка']]);
  });

  it('строка sep=; от Excel задаёт разделитель и в данные не входит', () => {
    const r = parseCsv('sep=;\na;b\n1;2\n');
    expect(r.delimiter).toBe(';');
    expect(r.records).toHaveLength(2);
    expect(r.records[0]!.line).toBe(2);
  });
});

describe('parseCsv: кавычки и переводы строк', () => {
  it('BOM в начале убирается', () => {
    expect(cells('\ufeffa,b\n1,2')[0]).toEqual(['a', 'b']);
  });

  it('"" внутри кавычек — одна кавычка', () => {
    expect(cells('a,b\n"он сказал ""привет""",2')[1]).toEqual(['он сказал "привет"', '2']);
  });

  it('разделитель и перевод строки внутри кавычек', () => {
    const r = parseCsv('a,b\n"x,y\nz",2\n3,4\n');
    expect(r.records[1]!.cells).toEqual(['x,y\nz', '2']);
    expect(r.records[2]!.cells).toEqual(['3', '4']);
  });

  it('номера строк — физические строки файла, в том числе после многострочной ячейки', () => {
    const r = parseCsv('a,b\n"x\ny\nz",2\n3,4\n');
    expect(r.records.map((x) => x.line)).toEqual([1, 2, 5]);
  });

  it('CRLF, одиночный CR и LF считаются одним переводом строки', () => {
    expect(cells('a,b\r\n1,2\r\n3,4\r\n')).toHaveLength(3);
    expect(cells('a,b\r1,2\r3,4\r')).toHaveLength(3);
    expect(cells('a,b\n1,2\r\n3,4\r5,6')).toHaveLength(4);
  });

  it('CRLF внутри кавычек считается за одну строку', () => {
    const r = parseCsv('a,b\r\n"x\r\ny",2\r\n3,4\r\n');
    expect(r.records.map((x) => x.line)).toEqual([1, 2, 4]);
  });

  it('пустые строки пропускаются, последняя строка без перевода строки читается', () => {
    expect(cells('a,b\n\n1,2\n   \n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('пустая ячейка в конце строки сохраняется', () => {
    expect(cells('a,b,c\n1,2,')[1]).toEqual(['1', '2', '']);
  });

  it('пустая ячейка в кавычках — пустая строка, а не потеря столбца', () => {
    expect(cells('a,b,c\n"",2,""')[1]).toEqual(['', '2', '']);
  });

  it('пробелы перед открывающей кавычкой допустимы', () => {
    expect(cells('a,b\n1, "x,y"')[1]).toEqual(['1', 'x,y']);
  });

  it('кавычка посреди обычного поля — просто символ', () => {
    expect(cells('a,b\n5" гвозди,2')[1]).toEqual(['5" гвозди', '2']);
  });

  it('незакрытая кавычка — понятный отказ с номером строки, а не молчаливая порча остального файла', () => {
    const run = () => parseCsv('a,b\n1,2\n"не закрыто,3\n4,5\n');
    expect(run).toThrow(ImportFileError);
    expect(run).toThrow(/в строке 3 открыта кавычка/);
  });
});

describe('parseCsv: пределы', () => {
  const body = (n: number) => 'a,b\n' + Array.from({ length: n }, (_, i) => `${i},x`).join('\n');

  it('ровно максимум строк проходит, на одну больше — отказ с объяснением', () => {
    expect(parseCsv(body(5), { maxDataRows: 5 }).records).toHaveLength(6);
    expect(() => parseCsv(body(6), { maxDataRows: 5 })).toThrow(/больше 5 строк/);
  });

  it('50 000 строк по умолчанию: 50 000 проходит, 50 001 — нет', () => {
    expect(parseCsv(body(50_000)).records).toHaveLength(50_001);
    expect(() => parseCsv(body(50_001))).toThrow(/больше 50 000 строк/);
  });

  it('пустые строки в счёт не идут', () => {
    expect(parseCsv('a,b\n' + '\n'.repeat(60_000) + '1,2').records).toHaveLength(2);
  });
});
