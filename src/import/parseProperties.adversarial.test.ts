import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { amountToMinor, scanAmount } from './amount';
import { parseCsv } from './csv';
import { decodeBytes } from './decode';
import { parseZenmoney } from './parse';
import { ImportFileError } from './types';

/** Случайные проверки разбора: CSV (кавычки, переводы строк, разделители), суммы (никогда не читаются иначе, чем записаны), отсутствие неожиданных исключений. */

const cellArb = fc.oneof(
  fc.string({ maxLength: 12, unit: fc.constantFrom('a', 'б', ' ', ',', ';', '\t', '"', '\n', '\r', '1', '😀', '=', ' ') }),
  fc.constantFrom('', ' ', 'x', '"', '""', 'a"b', '\n', '\r\n', ';', ','),
);

describe('csv round trip', () => {
  it('serialize(parse) == identity for properly quoted files', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(',', ';', '\t'),
        fc.constantFrom('\n', '\r\n', '\r'),
        fc.boolean(),
        fc.array(fc.array(cellArb, { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 6 }),
        (delim, eol, bom, rows) => {
          const width = rows[0]!.length;
          const norm = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? 'z'));
          // header: чтобы определение разделителя сработало, первая строка должна содержать разделитель вне кавычек
          norm[0] = norm[0]!.map((c, i) => (c.trim() === '' ? `h${i}` : c));
          const quote = (c: string) => '"' + c.replace(/"/g, '""') + '"';
          const text = (bom ? '﻿' : '') + norm.map((r) => r.map(quote).join(delim)).join(eol) + eol;
          const out = parseCsv(text);
          const got = out.records.map((r) => r.cells);
          // полностью пустая строка из одной ячейки пропускается парсером; здесь ячеек >= 2, так что строки не теряются
          // номера строк: физическая строка начала записи (CRLF — один перевод)
          const breaks = (t: string) => (t.match(/\r\n|\r|\n/g) ?? []).length;
          let line = 1;
          const wantLines: number[] = [];
          for (const r of norm) {
            wantLines.push(line);
            line += breaks(r.map(quote).join(delim)) + breaks(eol);
          }
          expect(out.records.map((r) => r.line)).toEqual(wantLines);
          expect(out.delimiter).toBe(delim);
          expect(got).toEqual(norm.filter((r) => !(r.length === 1 && r[0]!.trim() === '')));
        },
      ),
      { numRuns: 2000 },
    );
  });
});

function group(int: string, sep: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

describe('amount: никогда не читает иначе, чем записано', () => {
  it('форматы с разделителями дают то же число или отказ', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.constantFrom('TJS', 'JPY'),
        fc.constantFrom(',', '.'),
        fc.constantFrom('', ' ', ' ', ' ', ',', '.', "'"),
        fc.boolean(),
        fc.constantFrom('', '+', ' ', '0'),
        (minor, cur, dec, thousands, trimFrac, prefix) => {
          const exp = cur === 'JPY' ? 0 : 2;
          const s = minor.toString().padStart(exp + 1, '0');
          const int = s.slice(0, s.length - exp);
          let frac = exp ? s.slice(-exp) : '';
          if (trimFrac && frac.endsWith('0')) frac = frac.replace(/0+$/, '');
          if (thousands === dec) return; // формат, который никто не пишет
          const text = prefix + group(int, thousands) + (frac ? dec + frac : '');
          const scan = scanAmount(text);
          if (scan.kind !== 'number') return; // отказ — допустим
          const r = amountToMinor(scan, cur);
          if (!r.ok) return;
          // читаем ли ровно то же число (без подмены в 10/100/1000 раз)
          const wantMinor = BigInt(int + frac.padEnd(exp, '0'));
          expect(BigInt(r.minor), text).toBe(wantMinor);
        },
      ),
      { numRuns: 20000 },
    );
  });

  it('случайные строки из цифр и знаков: если число принято, оно совпадает с «обычным» чтением', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('0', '1', '2', '5', '9', ',', '.', ' ', '-', '+', 'e', "'", ' '), minLength: 1, maxLength: 14 }), (text) => {
        const scan = scanAmount(text);
        if (scan.kind !== 'number') return;
        const r = amountToMinor(scan, 'TJS');
        if (!r.ok) return;
        // независимая проверка: убираем пробелы; одна точка/запятая с 1–2 знаками после — это дробь; без знаков — целое;
        // всё остальное принято только как группы по три цифры
        const clean = text.replace(/[\s ']/g, '').replace(/^\+/, '');
        let want: bigint | null = null;
        let m: RegExpExecArray | null;
        if ((m = /^(\d+)$/.exec(clean))) want = BigInt(m[1]!) * 100n;
        else if ((m = /^(\d*)[.,](\d{1,2})$/.exec(clean))) want = BigInt((m[1] || '0') + m[2]!.padEnd(2, '0'));
        else if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/.exec(clean))) want = BigInt(m[1]!.replace(/,/g, '') + m[2]!.padEnd(2, '0'));
        else if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(clean))) want = BigInt(m[1]!.replace(/\./g, '') + m[2]!.padEnd(2, '0'));
        else if ((m = /^(\d{1,3}(?:[.,]\d{3}){2,})$/.exec(clean)) && !/[.,]/.test(clean.replace(/[.,]/, '').replace(/[.,]/g, '').slice(0, 0))) {
          const sep = clean.includes(',') ? ',' : '.';
          if (!clean.includes(sep === ',' ? '.' : ',')) want = BigInt(clean.split(sep).join('')) * 100n;
        }
        expect(want === null ? 'не ожидали числа' : BigInt(r.minor), text).toBe(want === null ? 'не ожидали числа' : want);
      }),
      { numRuns: 50000 },
    );
  });
});

const HEAD = 'date,outcomeAccountName,outcome,outcomeCurrencyShortTitle\n';

describe('нет неожиданных исключений', () => {
  it('произвольные байты', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        try {
          const { text, encoding } = decodeBytes(bytes);
          parseZenmoney(text, encoding);
        } catch (e) {
          expect(e instanceof ImportFileError, String(e)).toBe(true);
        }
      }),
      { numRuns: 5000 },
    );
  });
  it('произвольный текст после правильного заголовка', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('0', '1', '5', ',', ';', '.', '"', '\n', '\r', ' ', 'a', 'Я', '-', '😀', '\ud83d', '\u0000', 'T', ':', '/'), maxLength: 200 }), (body) => {
        try {
          const p = parseZenmoney(HEAD + body);
          expect(p.rows.length + p.review.length + p.skipped.length).toBe(p.totalRecords);
          for (const r of p.rows) {
            expect(Number.isSafeInteger((r.outcome ?? r.income)!.amountMinor)).toBe(true);
          }
        } catch (e) {
          expect(e instanceof ImportFileError, String(e)).toBe(true);
        }
      }),
      { numRuns: 20000 },
    );
  });
});
