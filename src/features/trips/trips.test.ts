import { describe, expect, it } from 'vitest';
import { hasTag, listTrips, tagFromName, tagKey, tagLabel, tagsOf, tripReport, withTag, withoutTag, withoutTags, type TripTx } from './trips';

const BASE = 'TJS';
let seq = 0;
const tx = (over: Partial<TripTx> & { occurredOn: string; amountMinor: number }): TripTx => ({
  id: over.id ?? `t${String(++seq).padStart(4, '0')}`,
  kind: 'expense',
  walletId: 'w1',
  toWalletId: null,
  categoryId: 'food',
  baseAmountMinor: over.amountMinor,
  baseCurrency: BASE,
  note: '',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});
const currencies = new Map([
  ['w1', 'TJS'],
  ['wusd', 'USD'],
]) as ReadonlyMap<string, 'TJS' | 'USD'>;

describe('метки в заметках', () => {
  it('tagsOf: метка — это # и 2–40 букв/цифр/_/-, перед ней пробел или начало строки', () => {
    expect(tagsOf('кофе #Самарканд')).toEqual(['Самарканд']);
    expect(tagsOf('#Самарканд такси #Поездка_в_Бухару')).toEqual(['Самарканд', 'Поездка_в_Бухару']);
    expect(tagsOf('почта mail#abc')).toEqual([]);
    expect(tagsOf('# пробел')).toEqual([]);
    expect(tagsOf('#а')).toEqual([]);
    expect(tagsOf('#ab')).toEqual(['ab']);
    expect(tagsOf('номер #12')).toEqual(['12']);
    expect(tagsOf(`#${'я'.repeat(41)}`)).toEqual([]);
    expect(tagsOf(`#${'я'.repeat(40)}`)).toEqual(['я'.repeat(40)]);
  });

  it('tagKey: без регистра и «ё»; hasTag сравнивает по ключу', () => {
    expect(tagKey('Самарканд')).toBe(tagKey('САМАРКАНД'));
    expect(tagKey('Ёлка')).toBe(tagKey('елка'));
    expect(hasTag('кофе #самарканд', 'Самарканд')).toBe(true);
    expect(hasTag('кофе #самарканд2', 'Самарканд')).toBe(false);
  });

  it('tagFromName: пробелы → «_», лишние знаки убираются, слишком короткое/длинное — null', () => {
    expect(tagFromName(' Поездка в Самарканд ')).toBe('Поездка_в_Самарканд');
    expect(tagFromName('Дубай, 2026!')).toBe('Дубай_2026');
    expect(tagFromName('--Баку--')).toBe('Баку');
    expect(tagFromName('а')).toBeNull();
    expect(tagFromName('   ')).toBeNull();
    expect(tagFromName('!!!')).toBeNull();
    expect(tagFromName('я'.repeat(41))).toBeNull();
    expect(tagFromName('я'.repeat(40))).toBe('я'.repeat(40));
  });

  it('withoutTags: убирает метки и лишние пробелы', () => {
    expect(withoutTags('кофе #Самарканд')).toBe('кофе');
    expect(withoutTags('#Самарканд  плов   #Баку вкусный')).toBe('плов вкусный');
    expect(withoutTags('почта mail#abc')).toBe('почта mail#abc');
    expect(withoutTags('#Самарканд')).toBe('');
  });

  it('tagLabel возвращает пробелы', () => {
    expect(tagLabel('Поездка_в_Самарканд')).toBe('Поездка в Самарканд');
  });

  it('withTag: добавляет в конец, не дублирует (в том числе с другим регистром), не трогает заметку без метки', () => {
    expect(withTag('кофе', 'Самарканд')).toBe('кофе #Самарканд');
    expect(withTag('  кофе  ', 'Самарканд')).toBe('кофе #Самарканд');
    expect(withTag('', 'Самарканд')).toBe('#Самарканд');
    expect(withTag('кофе #самарканд', 'Самарканд')).toBe('кофе #самарканд');
    expect(withTag('кофе', null)).toBe('кофе');
  });

  it('withTag: если метка не влезает в заметку — заметка как есть', () => {
    const long = 'я'.repeat(495);
    expect(withTag(long, 'Самарканд_и_ещё_длинная_метка')).toBe(long);
  });
});

describe('withoutTag: убрать одну метку из заметки', () => {
  it('убирает метку в конце, в середине и в начале; остальные слова и метки остаются', () => {
    expect(withoutTag('кофе #Самарканд', 'Самарканд')).toBe('кофе');
    expect(withoutTag('кофе #Самарканд #работа', 'Самарканд')).toBe('кофе #работа');
    expect(withoutTag('#Самарканд кофе', 'Самарканд')).toBe('кофе');
    expect(withoutTag('кофе #Самарканд с молоком', 'Самарканд')).toBe('кофе с молоком');
    expect(withoutTag('#Самарканд', 'Самарканд')).toBe('');
  });

  it('без учёта регистра и «ё»; все вхождения', () => {
    expect(withoutTag('кофе #самарканд', 'Самарканд')).toBe('кофе');
    expect(withoutTag('ёлка #Ёлка', 'елка')).toBe('ёлка');
    expect(withoutTag('a #работа b #Работа', 'работа')).toBe('a b');
  });

  it('другая метка с тем же началом не трогается; метка — только целиком', () => {
    expect(withoutTag('кофе #Самарканд2 #Самарканд', 'Самарканд')).toBe('кофе #Самарканд2');
    expect(withoutTag('кофе #Самарканд', 'Сам')).toBe('кофе #Самарканд');
  });

  it('нет такой метки — заметка прежняя (кроме свёрнутых пробелов); «#» без слова не метка', () => {
    expect(withoutTag('кофе', 'Самарканд')).toBe('кофе');
    expect(withoutTag('кофе # 5', 'Самарканд')).toBe('кофе # 5');
  });

  it('withTag и withoutTag обратимы', () => {
    expect(withoutTag(withTag('кофе', 'Самарканд'), 'Самарканд')).toBe('кофе');
    expect(withTag(withoutTag('кофе #Самарканд', 'Самарканд'), 'Самарканд')).toBe('кофе #Самарканд');
  });
});

describe('listTrips', () => {
  const rows = [
    tx({ occurredOn: '2026-09-10', amountMinor: 10_000, note: 'такси #Самарканд' }),
    tx({ occurredOn: '2026-09-12', amountMinor: 5_000, note: 'плов #самарканд' }),
    tx({ occurredOn: '2026-09-12', amountMinor: 7_000, note: 'плов #самарканд' }),
    tx({ occurredOn: '2026-10-02', amountMinor: 20_000, note: 'отель #Баку' }),
    tx({ occurredOn: '2026-10-03', amountMinor: 1_000, note: 'без метки' }),
  ];

  it('группирует по ключу метки; недавние первыми; пишем самое частое написание', () => {
    const trips = listTrips(rows, BASE);
    expect(trips.map((t) => t.key)).toEqual(['баку', 'самарканд']);
    expect(trips[1]).toMatchObject({ label: 'самарканд', tag: 'самарканд', firstOn: '2026-09-10', lastOn: '2026-09-12', count: 3, expenseMinor: 22_000 });
  });

  it('удалённые, корректировки остатка и долги не считаются', () => {
    const extra = [
      tx({ occurredOn: '2026-09-11', amountMinor: 9_999, note: 'удалено #Самарканд', deletedAt: '2026-09-11T00:00:00.000Z' }),
      tx({ occurredOn: '2026-09-11', amountMinor: 9_999, note: '#Самарканд', debtId: 'd1' }),
    ];
    expect(listTrips([...rows, ...extra], BASE).find((t) => t.key === 'самарканд')).toMatchObject({ count: 3, expenseMinor: 22_000 });
  });

  it('доходы и переводы с меткой попадают в count, но не в расходы; траты в чужой основной валюте — тоже не в сумму', () => {
    const extra = [
      tx({ occurredOn: '2026-09-13', amountMinor: 50_000, kind: 'income', note: 'возврат #Самарканд' }),
      tx({ occurredOn: '2026-09-13', amountMinor: 3_000, baseCurrency: 'USD', note: 'старая #Самарканд' }),
    ];
    expect(listTrips([...rows, ...extra], BASE).find((t) => t.key === 'самарканд')).toMatchObject({ count: 5, expenseMinor: 22_000 });
  });

  it('одна операция с двумя метками входит в обе, с повтором одной метки — один раз', () => {
    const both = tx({ occurredOn: '2026-09-14', amountMinor: 100, note: '#Самарканд #Баку #самарканд' });
    const trips = listTrips([both], BASE);
    expect(trips.map((t) => [t.key, t.count])).toEqual([
      ['баку', 1],
      ['самарканд', 1],
    ]);
  });

  it('без меток — пусто', () => {
    expect(listTrips([tx({ occurredOn: '2026-09-14', amountMinor: 100, note: 'просто' })], BASE)).toEqual([]);
  });
});

describe('tripReport', () => {
  const rows = [
    tx({ id: 'a', occurredOn: '2026-09-10', amountMinor: 10_000, categoryId: 'taxi', note: 'такси #Самарканд' }),
    tx({ id: 'b', occurredOn: '2026-09-10', amountMinor: 4_000, categoryId: 'food', note: 'плов #Самарканд' }),
    tx({ id: 'c', occurredOn: '2026-09-13', amountMinor: 6_000, categoryId: 'food', note: '#Самарканд', walletId: 'wusd', baseAmountMinor: 60_000 }),
    tx({ id: 'd', occurredOn: '2026-10-01', amountMinor: 999, note: 'другая #Баку' }),
  ];

  it('считает дни включительно, расход в день, категории, дни, валюты и крупнейшие траты', () => {
    const r = tripReport(rows, 'самарканд', BASE, currencies)!;
    expect(r.days).toBe(4);
    expect(r.expenseMinor).toBe(74_000);
    expect(r.perDayMinor).toBe(18_500);
    expect(r.byCategory.map((c) => [c.categoryId, c.totalMinor])).toEqual([
      ['food', 64_000],
      ['taxi', 10_000],
    ]);
    expect(r.byDay).toEqual([
      { date: '2026-09-10', expenseMinor: 14_000 },
      { date: '2026-09-13', expenseMinor: 60_000 },
    ]);
    expect(r.byCurrency).toEqual([
      { currency: 'TJS', minor: 14_000 },
      { currency: 'USD', minor: 6_000 },
    ]);
    expect(r.biggest.map((b) => b.txId)).toEqual(['c', 'a', 'b']);
    expect(r.biggest[0]).toMatchObject({ amountMinor: 60_000, note: '', occurredOn: '2026-09-13' });
  });

  it('нет такой поездки — null; расходов в основной валюте нет — нули', () => {
    expect(tripReport(rows, 'нет', BASE, currencies)).toBeNull();
    const only = [tx({ occurredOn: '2026-09-10', amountMinor: 500, kind: 'income', note: '#Тест' })];
    const r = tripReport(only, 'тест', BASE, currencies)!;
    expect(r).toMatchObject({ days: 1, expenseMinor: 0, perDayMinor: 0, byCategory: [], byDay: [], byCurrency: [], biggest: [] });
  });

  it('расход ровно в одну дату — один день; деление вниз', () => {
    const one = [tx({ occurredOn: '2026-09-10', amountMinor: 1_001, note: '#Тест' }), tx({ occurredOn: '2026-09-12', amountMinor: 2, note: '#Тест' })];
    expect(tripReport(one, 'тест', BASE, currencies)!.perDayMinor).toBe(334);
  });

  it('траты в другой основной валюте считаются исключёнными', () => {
    const foreign = [...rows, tx({ occurredOn: '2026-09-11', amountMinor: 1_000, baseCurrency: 'USD', note: '#Самарканд' })];
    const r = tripReport(foreign, 'самарканд', BASE, currencies)!;
    expect(r.excludedCount).toBe(1);
    expect(r.expenseMinor).toBe(74_000);
  });
});

describe('оплата картой в другой валюте в отчёте поездки', () => {
  it('считается в валюте чека, а сколько списано с карты — в charged; обычные траты как раньше', () => {
    const txs = [
      tx({ occurredOn: '2026-10-01', amountMinor: 13_500, note: '#Дубай', foreignCurrency: 'AED', foreignAmountMinor: 5_000 }),
      tx({ occurredOn: '2026-10-01', amountMinor: 2_700, note: 'кофе #Дубай', foreignCurrency: 'AED', foreignAmountMinor: 1_000 }),
      tx({ occurredOn: '2026-10-02', amountMinor: 1_000, note: 'вода #Дубай' }),
    ];
    const r = tripReport(txs, 'дубай', BASE, currencies)!;
    expect(r.byCurrency).toEqual([
      { currency: 'TJS', minor: 1_000 },
      { currency: 'AED', minor: 6_000, charged: [{ currency: 'TJS', minor: 16_200 }] },
    ]);
    // расходы в основной валюте — по снимку (карта списала сомони)
    expect(r.expenseMinor).toBe(17_200);
  });
});
