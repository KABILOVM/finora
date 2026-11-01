import { describe, expect, it } from 'vitest';
import { MIN_NOTE_REPEATS, spendByNote, spendByTag, spendByWallet, spendTotal, walletSpendQuery, type SpendTx } from './spendGroups';

let seq = 0;
/** Расход 10 с. (1000) в TJS на 10 октября 2026 с кошелька «w1»; поля переопределяются. */
const tx = (over: Partial<SpendTx> = {}): SpendTx => ({
  id: `t${++seq}`,
  kind: 'expense',
  walletId: 'w1',
  categoryId: 'c1',
  amountMinor: 1000,
  baseAmountMinor: 1000,
  baseCurrency: 'TJS',
  occurredOn: '2026-10-10',
  note: '',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  fxSource: 'same',
  ...over,
});
const M = '2026-10';

describe('spendTotal: какие траты считаются', () => {
  it('только расходы месяца в основной валюте; долги, корректировки, удалённые, доходы и переводы не входят', () => {
    const rows = [
      tx({ baseAmountMinor: 1000 }),
      tx({ baseAmountMinor: 500, occurredOn: '2026-10-31' }),
      tx({ baseAmountMinor: 9999, occurredOn: '2026-09-30' }), // другой месяц
      tx({ baseAmountMinor: 9999, occurredOn: '2026-11-01' }),
      tx({ baseAmountMinor: 9999, kind: 'income' }),
      tx({ baseAmountMinor: 9999, kind: 'transfer', categoryId: null }),
      tx({ baseAmountMinor: 9999, debtId: 'd1' }),
      tx({ baseAmountMinor: 9999, fxSource: 'adjust' }),
      tx({ baseAmountMinor: 9999, deletedAt: '2026-10-11T00:00:00Z' }),
      tx({ baseAmountMinor: 9999, baseCurrency: 'USD' }),
    ];
    expect(spendTotal(rows, M, 'TJS')).toBe(1500);
  });

  it('суммы, которые не помещаются в безопасное целое, — RangeError (экран пишет «суммы слишком большие»)', () => {
    const big = Number.MAX_SAFE_INTEGER - 5;
    expect(() => spendTotal([tx({ baseAmountMinor: big }), tx({ baseAmountMinor: 100 })], M, 'TJS')).toThrow(RangeError);
  });
});

describe('spendByNote: по заметке', () => {
  it('одинаковые заметки — вместе: без учёта регистра, «ё» и пробелов по краям; сумма и число операций', () => {
    const rows = [
      tx({ note: 'Такси', baseAmountMinor: 3000, occurredOn: '2026-10-20' }), // написаний три, у всех по одному разу: берётся позднее
      tx({ note: 'такси', baseAmountMinor: 2000, occurredOn: '2026-10-10' }),
      tx({ note: '  ТАКСИ ', baseAmountMinor: 1000, occurredOn: '2026-10-05' }),
      tx({ note: 'Мёд', baseAmountMinor: 700 }),
      tx({ note: 'мед', baseAmountMinor: 300 }),
    ];
    const groups = spendByNote(rows, M, 'TJS');
    expect(groups.map((g) => [g.label, g.totalMinor, g.count])).toEqual([
      ['Такси', 6000, 3],
      ['Мёд', 1000, 2],
    ]);
  });

  it('метки #… в заметке не мешают: «такси #Самарканд» и «такси» — одна группа, метка в названии не показывается', () => {
    const groups = spendByNote([tx({ note: 'такси #Самарканд' }), tx({ note: 'такси' }), tx({ note: '#Самарканд такси' })], M, 'TJS');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'такси', count: 3, totalMinor: 3000 });
  });

  it('единичные траты (меньше MIN_NOTE_REPEATS) и траты без заметки в группы не входят', () => {
    expect(MIN_NOTE_REPEATS).toBe(2);
    const rows = [tx({ note: 'базар' }), tx({ note: 'кино' }), tx({ note: '' }), tx({ note: '' }), tx({ note: '#Самарканд' }), tx({ note: '#Самарканд' })];
    expect(spendByNote(rows, M, 'TJS')).toEqual([]); // «#Самарканд» без слов — пустая заметка
  });

  it('порядок: сумма ↓, затем число операций ↓, затем название', () => {
    const rows = [
      tx({ note: 'б', baseAmountMinor: 500 }),
      tx({ note: 'б', baseAmountMinor: 500 }),
      tx({ note: 'а', baseAmountMinor: 250 }),
      tx({ note: 'а', baseAmountMinor: 250 }),
      tx({ note: 'а', baseAmountMinor: 500 }),
      tx({ note: 'в', baseAmountMinor: 500 }),
      tx({ note: 'в', baseAmountMinor: 500 }),
    ];
    // «а»: 1000 за 3, «б» и «в»: 1000 за 2 → «а» первой (больше операций), «б» перед «в» по названию
    expect(spendByNote(rows, M, 'TJS').map((g) => g.label)).toEqual(['а', 'б', 'в']);
  });

  it('название — самое частое написание; при равенстве — то, что встретилось позже', () => {
    const often = [tx({ note: 'Базар', occurredOn: '2026-10-01' }), tx({ note: 'базар', occurredOn: '2026-10-02' }), tx({ note: 'базар', occurredOn: '2026-10-03' })];
    expect(spendByNote(often, M, 'TJS')[0]?.label).toBe('базар');
    const tie = [tx({ note: 'Базар', occurredOn: '2026-10-20' }), tx({ note: 'базар', occurredOn: '2026-10-05' })];
    expect(spendByNote(tie, M, 'TJS')[0]?.label).toBe('Базар');
  });

  it('другой месяц, долги, корректировки, удалённые и чужая валюта в группы не попадают', () => {
    const rows = [
      tx({ note: 'такси' }),
      tx({ note: 'такси', occurredOn: '2026-09-30' }),
      tx({ note: 'такси', debtId: 'd1' }),
      tx({ note: 'такси', fxSource: 'adjust' }),
      tx({ note: 'такси', deletedAt: '2026-10-11T00:00:00Z' }),
      tx({ note: 'такси', baseCurrency: 'USD' }),
    ];
    expect(spendByNote(rows, M, 'TJS')).toEqual([]); // осталась одна трата — меньше двух
  });
});

describe('spendByTag: по метке', () => {
  it('траты из разных категорий собираются одной меткой; регистр и «ё» не важны; в названии — # и пробелы вместо «_»', () => {
    const rows = [
      tx({ note: 'гостиница #Поездка_в_Самарканд', categoryId: 'c1', baseAmountMinor: 50_000 }),
      tx({ note: 'такси #поездка_в_самарканд', categoryId: 'c2', baseAmountMinor: 3000 }),
      tx({ note: 'ужин #Ёлка', baseAmountMinor: 2000 }),
      tx({ note: 'подарок #елка', baseAmountMinor: 1000 }),
    ];
    const groups = spendByTag(rows, M, 'TJS');
    expect(groups.map((g) => [g.label, g.totalMinor, g.count])).toEqual([
      ['#Поездка в Самарканд', 53_000, 2],
      ['#Ёлка', 3000, 2],
    ]);
  });

  it('несколько меток у одной траты — трата входит в каждую; одна метка дважды — один раз', () => {
    const groups = spendByTag([tx({ note: 'обед #работа #командировка', baseAmountMinor: 800 }), tx({ note: 'кофе #работа #работа', baseAmountMinor: 200 })], M, 'TJS');
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, [g.totalMinor, g.count]]));
    expect(byLabel).toEqual({ '#работа': [1000, 2], '#командировка': [800, 1] });
    // суммы меток вместе больше расходов месяца: так и должно быть
    expect(groups.reduce((s, g) => s + g.totalMinor, 0)).toBeGreaterThan(1000);
  });

  it('единичная метка — тоже группа; без меток — пусто; «#» без слова и слишком короткая метка меткой не считаются', () => {
    expect(spendByTag([tx({ note: 'обед #отпуск' })], M, 'TJS')).toHaveLength(1);
    expect(spendByTag([tx({ note: 'обед' }), tx({ note: 'цена #5' }), tx({ note: 'a # b' }), tx({ note: '' })], M, 'TJS')).toEqual([]);
  });
});

describe('spendByWallet: по кошельку', () => {
  const names: Record<string, string> = { w1: 'Наличные', w2: 'Карта' };
  const nameOf = (id: string) => names[id] ?? 'Кошелёк удалён';

  it('сколько ушло с каждого; сумма ↓; названия подставляет вызывающий', () => {
    const rows = [tx({ walletId: 'w1', baseAmountMinor: 1000 }), tx({ walletId: 'w2', baseAmountMinor: 4000 }), tx({ walletId: 'w2', baseAmountMinor: 1000 }), tx({ walletId: 'w9', baseAmountMinor: 100 })];
    expect(spendByWallet(rows, M, 'TJS', nameOf).map((g) => [g.key, g.label, g.totalMinor, g.count])).toEqual([
      ['w2', 'Карта', 5000, 2],
      ['w1', 'Наличные', 1000, 1],
      ['w9', 'Кошелёк удалён', 100, 1],
    ]);
  });

  it('сумма по кошелькам равна расходам месяца без комиссий переводов', () => {
    const rows = [tx({ walletId: 'w1', baseAmountMinor: 700 }), tx({ walletId: 'w2', baseAmountMinor: 300 }), tx({ kind: 'transfer', walletId: 'w1', baseAmountMinor: 50, categoryId: null })];
    const groups = spendByWallet(rows, M, 'TJS', nameOf);
    expect(groups.reduce((s, g) => s + g.totalMinor, 0)).toBe(spendTotal(rows, M, 'TJS'));
  });

  it('пустой месяц — пусто', () => {
    expect(spendByWallet([], M, 'TJS', nameOf)).toEqual([]);
  });
});

describe('walletSpendQuery', () => {
  it('месяц, кошелёк и вид «расход» — так страница «Операции» читает адрес', () => {
    expect(walletSpendQuery('2026-10', 'abc-123')).toBe('month=2026-10&wallet=abc-123&kind=expense');
  });

  it('значения кодируются: лишнего в адрес не попадёт', () => {
    expect(walletSpendQuery('2026-10', 'a&b=c')).toBe('month=2026-10&wallet=a%26b%3Dc&kind=expense');
  });
});
