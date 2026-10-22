import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/dates';
import { detectRecurring, MIN_REPEATS, normNote, WINDOW_DAYS, type SubRule, type SubTx } from './subscriptions';

const TODAY = '2026-10-15';
let n = 0;
const tx = (over: Partial<SubTx> = {}): SubTx => ({
  id: `t${++n}`,
  kind: 'expense',
  walletId: 'w1',
  amountMinor: 4_900,
  categoryId: null,
  occurredOn: '2026-10-03',
  note: 'Netflix',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  ...over,
});
const rule = (over: Partial<SubRule> = {}): SubRule => ({ kind: 'expense', walletId: 'w1', amountMinor: 4_900, categoryId: null, note: 'Netflix', archivedAt: null, deletedAt: null, ...over });
/** Серия платежей: даты, сумма и заметка. */
const series = (dates: string[], over: Partial<SubTx> = {}) => dates.map((occurredOn) => tx({ occurredOn, ...over }));
const monthly = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'];

describe('detectRecurring: что похоже на подписку', () => {
  it('ежемесячный платёж с заметкой: сумма, шаг, последний платёж и когда ждать следующий', () => {
    const [c] = detectRecurring(series(monthly), [], TODAY);
    expect(c).toMatchObject({ walletId: 'w1', note: 'Netflix', amountMinor: 4_900, frequency: 'monthly', intervalN: 1, count: 4, lastOn: '2026-10-03', nextOn: '2026-11-03' });
  });

  it('раз в неделю и раз в две недели', () => {
    const weekly = detectRecurring(series(['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'], { note: 'Спортзал' }), [], TODAY)[0]!;
    expect(weekly).toMatchObject({ frequency: 'weekly', intervalN: 1, nextOn: '2026-10-22' });
    const biweekly = detectRecurring(series(['2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15'], { note: 'Уборка' }), [], TODAY)[0]!;
    expect(biweekly).toMatchObject({ frequency: 'weekly', intervalN: 2, nextOn: '2026-10-29' });
  });

  it('раз в год не ищем: три годовых платежа не помещаются в окно истории', () => {
    expect(detectRecurring(series(['2024-10-10', '2025-10-10', '2026-10-10'], { note: 'Домен' }), [], TODAY)).toEqual([]);
  });

  it('даты гуляют на пару дней, суммы на 2% — всё равно подписка', () => {
    const txs = [
      tx({ occurredOn: '2026-07-02', amountMinor: 4_900 }),
      tx({ occurredOn: '2026-08-04', amountMinor: 4_950 }),
      tx({ occurredOn: '2026-09-03', amountMinor: 4_850 }),
      tx({ occurredOn: '2026-10-05', amountMinor: 5_000 }),
    ];
    const [c] = detectRecurring(txs, [], TODAY);
    expect(c).toMatchObject({ frequency: 'monthly', count: 4, amountMinor: 4_925 }); // медиана 4 900 и 4 950
  });

  it('следующий платёж не раньше сегодня: серия «отстала» на месяц — ждём ближайшую будущую дату по якорю', () => {
    const [c] = detectRecurring(series(['2026-06-20', '2026-07-20', '2026-08-20', '2026-09-20']), [], TODAY);
    expect(c!.lastOn).toBe('2026-09-20');
    expect(c!.nextOn).toBe('2026-10-20');
  });

  it('последний платёж — сегодня: следующий через шаг, а не сегодня же', () => {
    const [c] = detectRecurring(series(['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15']), [], TODAY);
    expect(c!.nextOn).toBe('2026-11-15');
  });
});

describe('detectRecurring: что подпиской не считается', () => {
  it('меньше трёх платежей', () => {
    expect(detectRecurring(series(['2026-09-03', '2026-10-03']), [], TODAY)).toEqual([]);
    expect(MIN_REPEATS).toBe(3);
  });

  it('промежутки неровные: не месяц и не неделя', () => {
    expect(detectRecurring(series(['2026-07-03', '2026-07-20', '2026-09-03', '2026-10-03']), [], TODAY)).toEqual([]);
    expect(detectRecurring(series(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']), [], TODAY)).toEqual([]); // каждый день
  });

  it('суммы сильно разные (больше 5% от медианы)', () => {
    const txs = [4_900, 7_000, 4_900, 12_000].map((amountMinor, i) => tx({ amountMinor, occurredOn: monthly[i]! }));
    expect(detectRecurring(txs, [], TODAY)).toEqual([]);
  });

  it('цена выросла: серия считается от повышения, если после него платежей хватает', () => {
    const txs = [
      tx({ amountMinor: 3_000, occurredOn: '2026-05-03' }),
      tx({ amountMinor: 3_000, occurredOn: '2026-06-03' }),
      tx({ amountMinor: 4_900, occurredOn: '2026-07-03' }),
      tx({ amountMinor: 4_900, occurredOn: '2026-08-03' }),
      tx({ amountMinor: 4_900, occurredOn: '2026-09-03' }),
      tx({ amountMinor: 4_900, occurredOn: '2026-10-03' }),
    ];
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 4_900, count: 4 });
  });

  it('прекратилось давно: последний платёж больше двух шагов назад', () => {
    expect(detectRecurring(series(['2026-02-03', '2026-03-03', '2026-04-03', '2026-05-03']), [], TODAY)).toEqual([]);
  });

  it('границы «давно»: ровно два шага (70 дней для месяца) ещё показываем, больше — нет', () => {
    // последний платёж 70 дней назад: 2026-08-06; 71 день назад: 2026-08-05
    const ok = series(['2026-05-06', '2026-06-06', '2026-07-06', '2026-08-06']);
    const stale = series(['2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05']);
    expect(detectRecurring(ok, [], TODAY)).toHaveLength(1);
    expect(detectRecurring(stale, [], TODAY)).toHaveLength(0);
  });

  it('не расходы и не траты: доходы, переводы, долги, удалённые, созданные регулярным платежом, будущие и старше окна', () => {
    for (const over of [
      { kind: 'income' as const },
      { kind: 'transfer' as const },
      { debtId: 'd1' },
      { deletedAt: '2026-10-01T00:00:00Z' },
      { recurringRuleId: 'r1' },
    ]) {
      expect(detectRecurring(series(monthly, over), [], TODAY), JSON.stringify(over)).toEqual([]);
    }
    expect(detectRecurring(series(['2026-11-03', '2026-12-03', '2027-01-03']), [], TODAY)).toEqual([]); // будущее
    const old = addDays(TODAY, -(WINDOW_DAYS + 40));
    expect(detectRecurring(series([old, addDays(old, 30), addDays(old, 60)]), [], TODAY)).toEqual([]);
  });

  it('два чека в один день — один платёж: серия из «трёх» с дублем не подписка', () => {
    expect(detectRecurring(series(['2026-09-03', '2026-10-03', '2026-10-03']), [], TODAY)).toEqual([]);
  });

  it('без заметки: по категории и точной сумме; без заметки и без категории — не смотрим', () => {
    expect(detectRecurring(series(monthly, { note: '', categoryId: 'cat' }), [], TODAY)).toHaveLength(1);
    expect(detectRecurring(series(monthly, { note: '', categoryId: null }), [], TODAY)).toEqual([]);
    const differing = [4_900, 4_950, 4_900, 4_950].map((amountMinor, i) => tx({ note: '', categoryId: 'cat', amountMinor, occurredOn: monthly[i]! }));
    expect(detectRecurring(differing, [], TODAY)).toEqual([]); // сумма — часть ключа без заметки
  });

  it('разные кошельки — разные серии', () => {
    const txs = [tx({ walletId: 'w1', occurredOn: '2026-08-03' }), tx({ walletId: 'w2', occurredOn: '2026-09-03' }), tx({ walletId: 'w1', occurredOn: '2026-10-03' })];
    expect(detectRecurring(txs, [], TODAY)).toEqual([]);
  });

  it('заметка без учёта регистра, пробелов и «ё»', () => {
    const txs = ['Netflix', ' netflix ', 'NETFLIX', 'Netflix'].map((note, i) => tx({ note, occurredOn: monthly[i]! }));
    expect(detectRecurring(txs, [], TODAY)).toHaveLength(1);
    expect(normNote('  ЁЖ   Ёж ')).toBe('еж еж');
  });
});

describe('detectRecurring: уже заведено регулярным платежом', () => {
  it('правило с той же заметкой и близкой суммой в том же кошельке — не показываем', () => {
    expect(detectRecurring(series(monthly), [rule()], TODAY)).toEqual([]);
    expect(detectRecurring(series(monthly), [rule({ note: 'netflix ', amountMinor: 5_000 })], TODAY)).toEqual([]);
  });

  it('то же по категории: правило без заметки, но с той же категорией и суммой', () => {
    expect(detectRecurring(series(monthly, { categoryId: 'cat' }), [rule({ note: 'Другое', categoryId: 'cat' })], TODAY)).toEqual([]);
  });

  it('не покрывают: архивное, удалённое, другой кошелёк, другая сумма, доход, другая заметка', () => {
    for (const r of [
      rule({ archivedAt: '2026-10-01T00:00:00Z' }),
      rule({ deletedAt: '2026-10-01T00:00:00Z' }),
      rule({ walletId: 'w2' }),
      rule({ amountMinor: 9_000 }),
      rule({ kind: 'income' }),
      rule({ note: 'Spotify' }),
    ]) {
      expect(detectRecurring(series(monthly), [r], TODAY), JSON.stringify(r)).toHaveLength(1);
    }
  });
});

describe('detectRecurring: порядок и свойства', () => {
  it('дорогие в пересчёте на год — первыми', () => {
    const cheap = series(monthly, { note: 'Музыка', amountMinor: 1_000 }); // 12 000 в год
    const pricey = series(['2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08'], { note: 'Спортзал', amountMinor: 3_000 }); // 156 000 в год
    expect(detectRecurring([...cheap, ...pricey], [], TODAY).map((c) => c.note)).toEqual(['Спортзал', 'Музыка']);
  });

  it('порядок входа не важен', () => {
    const txs = series(monthly);
    expect(detectRecurring([...txs].reverse(), [], TODAY)).toEqual(detectRecurring(txs, [], TODAY));
  });

  it('свойство: любой найденный кандидат — не меньше трёх платежей, следующий не раньше сегодня, сумма в пределах входных', () => {
    const arb = fc.array(
      fc.record({
        note: fc.constantFrom('Netflix', 'Спортзал', 'Такси', ''),
        wallet: fc.constantFrom('w1', 'w2'),
        amount: fc.integer({ min: 100, max: 100_000 }),
        ago: fc.integer({ min: 0, max: 380 }),
        cat: fc.constantFrom('c1', null),
      }),
      { maxLength: 40 },
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const txs = rows.map((r, i) => tx({ id: `p${i}`, note: r.note, walletId: r.wallet, amountMinor: r.amount, occurredOn: addDays(TODAY, -r.ago), categoryId: r.cat }));
        const min = Math.min(...txs.map((t) => t.amountMinor));
        const max = Math.max(...txs.map((t) => t.amountMinor));
        for (const c of detectRecurring(txs, [], TODAY)) {
          expect(c.count).toBeGreaterThanOrEqual(MIN_REPEATS);
          expect(c.nextOn >= TODAY).toBe(true);
          expect(c.lastOn <= TODAY).toBe(true);
          expect(c.amountMinor).toBeGreaterThanOrEqual(min);
          expect(c.amountMinor).toBeLessThanOrEqual(max);
        }
      }),
    );
  });

  it('свойство: любая регулярная серия с шагом в месяц без «шума» находится', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 10 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 100, max: 1_000_000 }), (count, day, amount) => {
        const last = addDays(TODAY, -(day % 20));
        const dates: string[] = [];
        // даты строим по календарю (месяц назад от последней), а не по 30 дней: так бывают и 28-, и 31-дневные промежутки
        const [y, m, d] = last.split('-').map(Number) as [number, number, number];
        for (let i = 0; i < count; i++) {
          const dt = new Date(Date.UTC(y, m - 1 - i, 1));
          const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
          dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`);
        }
        const found = detectRecurring(dates.reverse().map((occurredOn) => tx({ occurredOn, amountMinor: amount })), [], TODAY);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ frequency: 'monthly', count, amountMinor: amount });
      }),
    );
  });
});

describe('detectRecurring: годовая сумма и подорожание', () => {
  const amounts = (list: [string, number][], over: Partial<SubTx> = {}) => list.map(([occurredOn, amountMinor]) => tx({ occurredOn, amountMinor, ...over }));

  it('годовая сумма: месяц ×12, неделя ×52, две недели ×26', () => {
    expect(detectRecurring(series(monthly), [], TODAY)[0]!.yearlyMinor).toBe(4_900 * 12);
    expect(detectRecurring(series(['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'], { note: 'Спортзал', amountMinor: 3_000 }), [], TODAY)[0]!.yearlyMinor).toBe(3_000 * 52);
    expect(detectRecurring(series(['2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15'], { note: 'Уборка', amountMinor: 2_000 }), [], TODAY)[0]!.yearlyMinor).toBe(2_000 * 26);
  });

  it('цена не менялась — previousAmountMinor пуст', () => {
    expect(detectRecurring(series(monthly), [], TODAY)[0]!.previousAmountMinor).toBeNull();
  });

  it('подорожало: два платежа по 49, затем три по 59 — прежняя цена 49, нынешняя 59', () => {
    const txs = amounts([['2026-05-03', 4_900], ['2026-06-03', 4_900], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    const c = detectRecurring(txs, [], TODAY)[0]!;
    expect(c).toMatchObject({ amountMinor: 5_900, count: 3, previousAmountMinor: 4_900, yearlyMinor: 5_900 * 12 });
  });

  it('прежняя цена может быть и одним платежом', () => {
    const txs = amounts([['2026-06-03', 4_900], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 5_900, previousAmountMinor: 4_900 });
  });

  it('только что подорожавшая (меньше трёх платежей по новой цене): пока не подписка вовсе — ни одна свежая серия из трёх не складывается', () => {
    // это прежнее поведение: подтверждённой считается серия не короче MIN_REPEATS по текущей цене
    const txs = amounts([['2026-06-03', 4_900], ['2026-07-03', 4_900], ['2026-08-03', 4_900], ['2026-09-03', 5_900], ['2026-10-03', 5_900]]);
    expect(detectRecurring(txs, [], TODAY)).toEqual([]);
  });

  it('подешевело — не подорожание', () => {
    const txs = amounts([['2026-06-03', 5_900], ['2026-07-03', 4_900], ['2026-08-03', 4_900], ['2026-09-03', 4_900]]);
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 4_900, previousAmountMinor: null });
  });

  it('скачок больше чем вдвое (пробный период, другой тариф) — не подорожание', () => {
    const txs = amounts([['2026-06-03', 100], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 5_900, previousAmountMinor: null });
    // ровно вдвое ещё считается
    const double = amounts([['2026-06-03', 2_950], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    expect(detectRecurring(double, [], TODAY)[0]).toMatchObject({ previousAmountMinor: 2_950 });
  });

  it('прежний платёж не на шаге (пропуск в несколько месяцев) — не считается прежней ценой', () => {
    const txs = amounts([['2026-03-03', 4_900], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 5_900, previousAmountMinor: null });
  });

  it('разные суммы в «старой» серии: берётся медиана подряд идущих близких', () => {
    const txs = amounts([['2026-04-03', 4_000], ['2026-05-03', 4_900], ['2026-06-03', 4_950], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    // 4 950 и 4 900 близки (≤ 5%), 4 000 — нет: прежняя цена по двум ближайшим к новой серии
    expect(detectRecurring(txs, [], TODAY)[0]).toMatchObject({ amountMinor: 5_900, previousAmountMinor: 4_925 });
  });

  it('порядок входа не меняет результат', () => {
    const txs = amounts([['2026-05-03', 4_900], ['2026-06-03', 4_900], ['2026-07-03', 5_900], ['2026-08-03', 5_900], ['2026-09-03', 5_900]]);
    expect(detectRecurring([...txs].reverse(), [], TODAY)).toEqual(detectRecurring(txs, [], TODAY));
  });

  it('свойство: прежняя цена всегда ниже нынешней, но не меньше её половины; годовая сумма = сумма × число платежей в год', () => {
    const arb = fc.array(fc.record({ amount: fc.integer({ min: 100, max: 20_000 }), ago: fc.integer({ min: 0, max: 380 }) }), { minLength: 3, maxLength: 20 });
    fc.assert(
      fc.property(arb, (rows) => {
        const txs = rows.map((r, i) => tx({ id: `q${i}`, note: 'Подписка', amountMinor: r.amount, occurredOn: addDays(TODAY, -r.ago) }));
        for (const c of detectRecurring(txs, [], TODAY)) {
          const perYear = c.frequency === 'monthly' ? 12 : c.intervalN === 2 ? 26 : 52;
          expect(c.yearlyMinor).toBe(c.amountMinor * perYear);
          if (c.previousAmountMinor !== null) {
            expect(c.previousAmountMinor).toBeLessThan(c.amountMinor);
            expect(c.previousAmountMinor * 2).toBeGreaterThanOrEqual(c.amountMinor);
          }
        }
      }),
    );
  });
});
