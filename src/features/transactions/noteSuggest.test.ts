import { describe, expect, it } from 'vitest';
import { buildNoteIndex, NOTE_SUGGEST_DAYS, NOTE_SUGGEST_LIMIT, normNote, suggestNotes, type NoteEntry } from './noteSuggest';

const TODAY = '2026-10-11';

type Row = Parameters<typeof buildNoteIndex>[0][number];

const row = (over: Partial<Row> = {}): Row => ({
  kind: 'expense',
  walletId: 'card',
  categoryId: 'food',
  amountMinor: 1500,
  note: 'Кофе',
  occurredOn: '2026-10-05',
  debtId: null,
  recurringRuleId: null,
  fxSource: null,
  deletedAt: null,
  ...over,
});

const entry = (over: Partial<NoteEntry> = {}): NoteEntry => ({
  kind: 'expense',
  note: 'Кофе',
  norm: 'кофе',
  categoryId: 'food',
  walletId: 'card',
  amountMinor: 1500,
  count: 1,
  lastOn: '2026-10-05',
  ...over,
});

describe('normNote', () => {
  it('без регистра, без лишних пробелов, «ё» как «е»', () => {
    expect(normNote('  Ёлка   Новогодняя ')).toBe('елка новогодняя');
    expect(normNote('')).toBe('');
  });
});

describe('buildNoteIndex', () => {
  it('одно сочетание вид+заметка+категория+кошелёк — одна запись со счётчиком, последней суммой и датой', () => {
    const idx = buildNoteIndex(
      [row({ occurredOn: '2026-10-01', amountMinor: 1000 }), row({ occurredOn: '2026-10-09', amountMinor: 1700 }), row({ occurredOn: '2026-10-03', amountMinor: 1200 })],
      TODAY,
    );
    expect(idx).toEqual([entry({ count: 3, amountMinor: 1700, lastOn: '2026-10-09' })]);
  });

  it('разные категории или кошельки с одной заметкой — разные записи; регистр заметки не различает', () => {
    const idx = buildNoteIndex([row({ note: 'кофе' }), row({ note: 'КОФЕ', categoryId: 'fun' }), row({ walletId: 'cash' })], TODAY);
    expect(idx).toHaveLength(3);
    expect(buildNoteIndex([row({ note: 'кофе' }), row({ note: 'Кофе ' })], TODAY)).toHaveLength(1);
  });

  it('не попадают: пустая заметка, удалённые, переводы, долги, регулярные, корректировки, будущее, старше окна', () => {
    expect(NOTE_SUGGEST_DAYS).toBe(365);
    const junk: Row[] = [
      row({ note: '  ' }),
      row({ deletedAt: '2026-10-02T00:00:00.000Z' }),
      row({ kind: 'transfer' }),
      row({ debtId: 'd1' }),
      row({ recurringRuleId: 'r1' }),
      row({ fxSource: 'adjust' }),
      row({ occurredOn: '2026-10-12' }),
      row({ occurredOn: '2025-10-10' }), // 366 дней назад
    ];
    expect(buildNoteIndex(junk, TODAY)).toEqual([]);
    expect(buildNoteIndex([row({ occurredOn: '2025-10-11' })], TODAY)).toHaveLength(1); // ровно 365 — граница включена
  });
});

describe('suggestNotes', () => {
  const idx: NoteEntry[] = [
    entry({ note: 'Кофе', norm: 'кофе', count: 5 }),
    entry({ note: 'Кофе с собой', norm: 'кофе с собой', count: 2, amountMinor: 2000 }),
    entry({ note: 'Чай и кофе', norm: 'чай и кофе', count: 9 }),
    entry({ note: 'Такси', norm: 'такси', categoryId: 'taxi', count: 3 }),
    entry({ kind: 'income', note: 'Кофейня: возврат', norm: 'кофейня: возврат', categoryId: 'refund' }),
  ];

  it('пустой запрос и вид «перевод» подсказок не дают', () => {
    expect(suggestNotes(idx, 'expense', '')).toEqual([]);
    expect(suggestNotes(idx, 'expense', '   ')).toEqual([]);
    expect(suggestNotes(idx, 'transfer', 'ко')).toEqual([]);
  });

  it('начало заметки — раньше начала слова; внутри слов не ищем; вид учитывается', () => {
    const got = suggestNotes(idx, 'expense', 'ко').map((e) => e.note);
    // «Кофе» (5) и «Кофе с собой» (2) — с начала заметки; «Чай и кофе» — только по слову, хоть и повторялась чаще
    expect(got).toEqual(['Кофе', 'Кофе с собой', 'Чай и кофе']);
    expect(suggestNotes(idx, 'expense', 'офе')).toEqual([]);
    expect(suggestNotes(idx, 'income', 'ко').map((e) => e.note)).toEqual(['Кофейня: возврат']);
  });

  it('регистр, пробелы и «ё» не мешают', () => {
    expect(suggestNotes(idx, 'expense', '  КОФЕ  с').map((e) => e.note)).toEqual(['Кофе с собой']);
    expect(suggestNotes([entry({ note: 'Ёлка', norm: 'елка' })], 'expense', 'ёл')).toHaveLength(1);
    expect(suggestNotes([entry({ note: 'Ёлка', norm: 'елка' })], 'expense', 'ел')).toHaveLength(1);
  });

  it('точное совпадение тоже предлагается: оно подставляет категорию и кошелёк', () => {
    expect(suggestNotes(idx, 'expense', 'такси').map((e) => e.note)).toEqual(['Такси']);
  });

  it('не больше limit; порядок не зависит от порядка входа', () => {
    expect(NOTE_SUGGEST_LIMIT).toBe(3);
    const many = Array.from({ length: 8 }, (_, i) => entry({ note: `Кофе ${i}`, norm: `кофе ${i}`, count: i }));
    expect(suggestNotes(many, 'expense', 'ко')).toHaveLength(3);
    expect(suggestNotes(many, 'expense', 'ко', 5)).toHaveLength(5);
    const a = suggestNotes(many, 'expense', 'ко').map((e) => e.note);
    expect(suggestNotes([...many].reverse(), 'expense', 'ко').map((e) => e.note)).toEqual(a);
    expect(a).toEqual(['Кофе 7', 'Кофе 6', 'Кофе 5']);
  });

  it('при равенстве счёта свежее — выше; одна заметка в двух кошельках — две подсказки', () => {
    const tie = [entry({ walletId: 'a', lastOn: '2026-09-01', count: 2 }), entry({ walletId: 'b', lastOn: '2026-10-01', count: 2 })];
    expect(suggestNotes(tie, 'expense', 'кофе').map((e) => e.walletId)).toEqual(['b', 'a']);
  });
});
