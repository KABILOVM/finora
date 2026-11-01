import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  activeFilterLabels,
  boundMinor,
  dayTotal,
  defaultFilters,
  filtersFromParams,
  filtersToParams,
  EMPTY_SHEET_FILTERS,
  matchesAmountRange,
  matchesSearch,
  matchesSource,
  NO_CATEGORY,
  normalizeAmountText,
  periodRange,
  toTxFilter,
  totalsByCurrency,
  transactionsQuery,
  transferFeeMinor,
  walletOpsQuery,
  withKind,
  withPeriod,
  withRangeDate,
  type ListFilters,
  type SearchLookups,
  type SheetFilters,
} from './txFilters';

/** Фильтры шита: всё пусто, кроме указанного. */
const sf = (over: Partial<SheetFilters> = {}): SheetFilters => ({ ...EMPTY_SHEET_FILTERS, ...over });

describe('фильтры из шита «Фильтры»: чистая логика', () => {
  it('activeFilterCount: считает только то, что лежит в шите (кошелёк, вид, категория, сумма, «откуда»)', () => {
    expect(activeFilterCount(sf())).toBe(0);
    expect(activeFilterCount(sf({ walletId: 'w1' }))).toBe(1);
    expect(activeFilterCount(sf({ walletId: 'w1', kind: 'expense' }))).toBe(2);
    expect(activeFilterCount(sf({ walletId: 'w1', kind: 'income', categoryId: '__none__' }))).toBe(3); // «Без категории» — тоже фильтр
    // обе границы суммы — один фильтр
    expect(activeFilterCount(sf({ amountFrom: '100' }))).toBe(1);
    expect(activeFilterCount(sf({ amountFrom: '100', amountTo: '500' }))).toBe(1);
    expect(activeFilterCount(sf({ source: 'recurring' }))).toBe(1);
    expect(activeFilterCount(sf({ walletId: 'w1', kind: 'expense', categoryId: 'c1', amountTo: '5', source: 'debt' }))).toBe(5);
  });

  it('withKind: категория другого вида и любая при «Переводы» сбрасывается, подходящая остаётся', () => {
    const base = sf({ walletId: 'w1', categoryId: 'c1' });
    expect(withKind(base, 'income', 'expense')).toEqual(sf({ walletId: 'w1', kind: 'income' }));
    expect(withKind(base, 'expense', 'expense')).toEqual(sf({ walletId: 'w1', kind: 'expense', categoryId: 'c1' }));
    expect(withKind(base, 'transfer', 'expense')).toEqual(sf({ walletId: 'w1', kind: 'transfer' }));
    expect(withKind(base, '', 'expense')).toEqual(sf({ walletId: 'w1', categoryId: 'c1' }));
    // «Без категории» (вида нет) к расходам и доходам подходит
    expect(withKind({ ...base, categoryId: '__none__' }, 'income', undefined).categoryId).toBe('__none__');
    // сумма и «откуда» смена вида не трогает
    expect(withKind(sf({ amountFrom: '5', source: 'debt' }), 'transfer', undefined)).toMatchObject({ amountFrom: '5', source: 'debt' });
  });

  it('activeFilterLabels: названия включённых фильтров по порядку', () => {
    const wallets = [{ id: 'w1', name: 'Карта' }];
    const categories = [{ id: 'c1', name: 'Еда' }];
    expect(activeFilterLabels(sf(), wallets, categories)).toEqual([]);
    expect(activeFilterLabels(sf({ walletId: 'w1', kind: 'expense', categoryId: 'c1' }), wallets, categories)).toEqual(['Карта', 'Расходы', 'Еда']);
    expect(activeFilterLabels(sf({ categoryId: '__none__' }), wallets, categories)).toEqual(['Без категории']);
  });

  it('activeFilterLabels: сумма и «откуда» — после категории; сумма с запятой, как её пишет человек', () => {
    const none = { wallets: [], categories: [] };
    const labels = (f: SheetFilters) => activeFilterLabels(f, none.wallets, none.categories);
    expect(labels(sf({ amountFrom: '100' }))).toEqual(['Сумма от 100']);
    expect(labels(sf({ amountTo: '12.5' }))).toEqual(['Сумма до 12,5']);
    expect(labels(sf({ amountFrom: '100', amountTo: '500' }))).toEqual(['Сумма 100–500']);
    expect(labels(sf({ source: 'recurring' }))).toEqual(['Регулярные платежи']);
    expect(labels(sf({ source: 'debt', kind: 'expense', amountFrom: '1' }))).toEqual(['Расходы', 'Сумма от 1', 'По долгам']);
  });
});

describe('нормализация и границы суммы', () => {
  it.each([
    ['', ''],
    ['1500', '1500'],
    ['1 500', '1500'],
    ['1\u00a0500', '1500'],
    ['12,5', '12.5'],
    ['12.50', '12.5'],
    ['12,0', '12'],
    ['007', '7'],
    ['0', '0'],
    ['.5', '0.5'],
    [',5', '0.5'],
    ['5.', '5'],
  ])('normalizeAmountText(%j) → %j', (input, out) => {
    expect(normalizeAmountText(input)).toBe(out);
  });

  it.each(['abc', '-5', '1e3', '1.2.3', '1,2,3', '12.34567', '1234567890123', '.', ',', '5 р'])('normalizeAmountText(%j) → null: это не сумма', (input) => {
    expect(normalizeAmountText(input)).toBeNull();
  });

  it('boundMinor: «от» округляется вверх, «до» — вниз по знакам валюты', () => {
    expect(boundMinor('12,5', 'TJS', 'up')).toBe(1250);
    expect(boundMinor('12,5', 'TJS', 'down')).toBe(1250);
    expect(boundMinor('12,345', 'TJS', 'up')).toBe(1235);
    expect(boundMinor('12,345', 'TJS', 'down')).toBe(1234);
    expect(boundMinor('12,340', 'TJS', 'up')).toBe(1234); // нули в хвосте границу не двигают
    expect(boundMinor('100', 'JPY', 'up')).toBe(100); // у иены знаков нет
    expect(boundMinor('100,5', 'JPY', 'up')).toBe(101);
    expect(boundMinor('100,5', 'JPY', 'down')).toBe(100);
    expect(boundMinor('abc', 'TJS', 'up')).toBeNull();
    expect(boundMinor('', 'TJS', 'up')).toBeNull();
  });
});

describe('matchesAmountRange и matchesSource', () => {
  const cur = (id: string) => ({ a: 'TJS', b: 'USD' })[id as 'a' | 'b'];
  const tx = (walletId: string, amountMinor: number) => ({ walletId, amountMinor });

  it('границы включительно; без границ подходит всё', () => {
    expect(matchesAmountRange(tx('a', 5000), '', '', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 5000), '50', '', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 4999), '50', '', cur)).toBe(false);
    expect(matchesAmountRange(tx('a', 5000), '', '50', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 5001), '', '50', cur)).toBe(false);
    expect(matchesAmountRange(tx('a', 5000), '50', '50', cur)).toBe(true);
  });

  it('сумма сравнивается в валюте кошелька операции, а не одним числом на всех', () => {
    // 100 с. (10000 дирамов) и 100 $ (10000 центов) — оба «100»
    expect(matchesAmountRange(tx('a', 10_000), '100', '100', cur)).toBe(true);
    expect(matchesAmountRange(tx('b', 10_000), '100', '100', cur)).toBe(true);
    expect(matchesAmountRange(tx('b', 10_000), '101', '', cur)).toBe(false);
  });

  it('границы с лишними знаками: «от 12,345» не пропускает 12,34 и пропускает 12,35', () => {
    expect(matchesAmountRange(tx('a', 1234), '12,345', '', cur)).toBe(false);
    expect(matchesAmountRange(tx('a', 1235), '12,345', '', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 1234), '', '12,345', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 1235), '', '12,345', cur)).toBe(false);
  });

  it('кошелёк неизвестен — под границы не подходит; ноль и крупные суммы', () => {
    expect(matchesAmountRange(tx('zzz', 100), '1', '', cur)).toBe(false);
    expect(matchesAmountRange(tx('a', 0), '0', '0', cur)).toBe(true);
    expect(matchesAmountRange(tx('a', 999_999_999_999), '', '9999999999,99', cur)).toBe(true);
  });

  it('matchesSource: регулярные — рождены правилом, «по долгам» — с debtId; «все» — любые', () => {
    const rule = { recurringRuleId: 'r1', debtId: null };
    const debt = { recurringRuleId: null, debtId: 'd1' };
    const plain = { recurringRuleId: null, debtId: null };
    expect([rule, debt, plain].map((t) => matchesSource(t, 'recurring'))).toEqual([true, false, false]);
    expect([rule, debt, plain].map((t) => matchesSource(t, 'debt'))).toEqual([false, true, false]);
    expect([rule, debt, plain].map((t) => matchesSource(t, ''))).toEqual([true, true, true]);
    expect(matchesSource({}, 'recurring')).toBe(false); // поля нет совсем (старая запись)
  });
});

describe('totalsByCurrency', () => {
  const cur = (id: string) => ({ a: 'TJS', b: 'USD' })[id as 'a' | 'b'];
  it('суммирует доходы и расходы по валютам счетов, пропуская переводы и долги', () => {
    const r = totalsByCurrency(
      [
        { kind: 'expense', walletId: 'a', amountMinor: 500 },
        { kind: 'expense', walletId: 'a', amountMinor: 250 },
        { kind: 'expense', walletId: 'b', amountMinor: 2000 },
        { kind: 'income', walletId: 'b', amountMinor: 9000 },
        { kind: 'transfer', walletId: 'a', amountMinor: 100 },
        { kind: 'expense', walletId: 'a', amountMinor: 700, debtId: 'd' },
      ],
      cur,
    );
    expect(r).toEqual([
      { currency: 'TJS', incomeMinor: 0, expenseMinor: 750, feeMinor: 0 },
      { currency: 'USD', incomeMinor: 9000, expenseMinor: 2000, feeMinor: 0 },
    ]);
  });

  describe('комиссии переводов', () => {
    const wallets = (id: string) => ({ a: 'TJS', b: 'TJS', c: 'USD' })[id as 'a' | 'b' | 'c'];
    // 100 списали с «a», 97,50 зачислили на «b»: комиссия 2,50 — расход
    const fee = { kind: 'transfer' as const, walletId: 'a', toWalletId: 'b', amountMinor: 10_000, toAmountMinor: 9750 };

    it('transferFeeMinor: разница списания и зачисления при одной валюте; обмен валют и перевод без комиссии — 0', () => {
      expect(transferFeeMinor(fee, wallets)).toBe(250);
      expect(transferFeeMinor({ ...fee, toAmountMinor: 10_000 }, wallets)).toBe(0);
      expect(transferFeeMinor({ ...fee, toWalletId: 'c', toAmountMinor: 900 }, wallets)).toBe(0); // обмен: комиссии по определению нет
      expect(transferFeeMinor({ ...fee, toAmountMinor: null }, wallets)).toBe(0);
      expect(transferFeeMinor({ ...fee, kind: 'expense' }, wallets)).toBe(0);
    });

    it('комиссия входит в расходы валюты и показана отдельно; сам перевод — нет', () => {
      const r = totalsByCurrency([{ kind: 'expense', walletId: 'a', amountMinor: 500 }, fee, { ...fee, toAmountMinor: 10_000 }], wallets);
      expect(r).toEqual([{ currency: 'TJS', incomeMinor: 0, expenseMinor: 750, feeMinor: 250 }]);
    });

    it('перевод без расходов и доходов: в итоге только комиссия', () => {
      expect(totalsByCurrency([fee], wallets)).toEqual([{ currency: 'TJS', incomeMinor: 0, expenseMinor: 250, feeMinor: 250 }]);
    });

    it('список по кошельку: комиссию за перевод НА этот кошелёк платил другой — её нет', () => {
      expect(totalsByCurrency([fee], wallets, 'b')).toEqual([]);
      expect(totalsByCurrency([fee], wallets, 'a')).toEqual([{ currency: 'TJS', incomeMinor: 0, expenseMinor: 250, feeMinor: 250 }]);
    });

    it('dayTotal по кошельку: чужая комиссия не входит в итог дня', () => {
      const t = { kind: 'transfer' as const, walletId: 'a', baseCurrency: 'TJS', baseAmountMinor: 250 };
      expect(dayTotal([t], 'TJS')?.netMinor).toBe(-250);
      expect(dayTotal([t], 'TJS', 'a')?.netMinor).toBe(-250);
      expect(dayTotal([t], 'TJS', 'b')?.netMinor).toBe(0);
    });
  });
});

describe('matchesSearch: заметка, категория, кошелёк, сумма', () => {
  const look: SearchLookups = {
    walletName: (id) => ({ w1: 'Наличные', w2: 'Карта Alif', w3: 'Доллары' })[id],
    categoryName: (id) => ({ c1: 'Еда', c2: 'Зарплата' })[id],
    currencyOf: (id) => ({ w1: 'TJS', w2: 'TJS', w3: 'USD' })[id] as 'TJS' | 'USD' | undefined,
  };
  const lunch = { kind: 'expense' as const, walletId: 'w1', toWalletId: null, categoryId: 'c1', amountMinor: 150_050, toAmountMinor: null, note: 'Обед с Рустамом' };
  const move = { kind: 'transfer' as const, walletId: 'w1', toWalletId: 'w3', categoryId: null, amountMinor: 11_000, toAmountMinor: 1000, note: '' };
  const hit = (tx: Parameters<typeof matchesSearch>[0], q: string) => matchesSearch(tx, q, look);

  it('пустой запрос подходит всему', () => {
    expect(hit(lunch, '')).toBe(true);
    expect(hit(lunch, '   ')).toBe(true);
  });
  it('заметка, категория и кошелёк — без учёта регистра', () => {
    expect(hit(lunch, 'РУСТАМ')).toBe(true);
    expect(hit(lunch, 'еда')).toBe(true);
    expect(hit(lunch, 'налич')).toBe(true);
    expect(hit(lunch, 'карта')).toBe(false);
  });
  it('«Без категории» ищется у расхода без категории, но не у перевода', () => {
    const none = { ...lunch, categoryId: null };
    expect(hit(none, 'без категории')).toBe(true);
    expect(hit(move, 'без категории')).toBe(false);
  });
  it('перевод ищется по обоим кошелькам', () => {
    expect(hit(move, 'доллар')).toBe(true);
    expect(hit(move, 'налич')).toBe(true);
  });
  it('сумма: начало числа, пробелы и запятая не мешают', () => {
    expect(hit(lunch, '1500')).toBe(true);
    expect(hit(lunch, '1 500,50')).toBe(true);
    expect(hit(lunch, '1500.5')).toBe(true);
    expect(hit(lunch, '15')).toBe(true);
    expect(hit(lunch, '500')).toBe(false); // «500» — не начало 1500,50
    expect(hit(lunch, '1500,51')).toBe(false);
  });
  it('то, что видно в строке: «Долг» у движения по долгу (а не «без категории»), «Регулярный платёж», «комиссия»', () => {
    const debt = { ...lunch, categoryId: null, debtId: 'd1' };
    expect(hit(debt, 'долг')).toBe(true);
    expect(hit(debt, 'без категории')).toBe(false);
    expect(hit({ ...lunch, recurringRuleId: 'r1' }, 'регулярный')).toBe(true);
    expect(hit(lunch, 'регулярный')).toBe(false);
    const fee = { kind: 'transfer' as const, walletId: 'w1', toWalletId: 'w2', categoryId: null, amountMinor: 10_000, toAmountMinor: 9800, note: '' };
    expect(hit(fee, 'комиссия')).toBe(true);
    expect(hit(move, 'комиссия')).toBe(false); // обмен валют — комиссии нет
  });
  it('перевод между валютами ищется и по сумме зачисления', () => {
    expect(hit(move, '110')).toBe(true);
    expect(hit(move, '10')).toBe(true); // 10 $ на счёте зачисления
  });
});

describe('фильтры в адресе: filtersToParams ↔ filtersFromParams', () => {
  const today = '2026-10-15';
  const back = (f: ListFilters) => ({ ...defaultFilters(today), ...filtersFromParams(filtersToParams(f, today), today) });

  it('обычные фильтры — пустой адрес', () => {
    expect(filtersToParams(defaultFilters(today), today).toString()).toBe('');
  });
  it.each<[string, Partial<ListFilters>]>([
    ['прошлый месяц', { period: 'prev' }],
    ['всё время', { period: 'all' }],
    ['другой месяц (не текущий)', { period: 'month', month: '2026-03' }],
    ['«Другой месяц», пока выбран именно текущий — не превращается в «Этот месяц»', { period: 'month', month: '2026-10' }],
    ['запомненный месяц при «Всё время» и «Этот месяц» не теряется', { period: 'all', month: '2026-07' }],
    ['…и при обычном периоде «Этот месяц»', { period: 'this', month: '2026-07' }],
    ['кошелёк, вид, категория', { walletId: 'w-1', kind: 'expense', categoryId: 'c-1' }],
    ['без категории', { categoryId: NO_CATEGORY, kind: 'income' }],
    ['сумма от и до', { amountFrom: '100', amountTo: '12.5' }],
    ['только «от»', { amountFrom: '0.5' }],
    ['регулярные платежи', { source: 'recurring' }],
    ['по долгам вместе с кошельком', { source: 'debt', walletId: 'w-1' }],
  ])('туда и обратно: %s', (_, patch) => {
    const f = { ...defaultFilters(today), ...patch };
    expect(back(f)).toEqual(f);
  });
  it('запомненный месяц пишется вместе с явным периодом: адрес не читается как «Другой месяц»', () => {
    expect(filtersToParams({ ...defaultFilters(today), period: 'this', month: '2026-07' }, today).toString()).toBe('period=this&month=2026-07');
    expect(filtersToParams({ ...defaultFilters(today), period: 'month', month: '2026-07' }, today).toString()).toBe('period=month&month=2026-07');
  });
  it('поиск в адрес не попадает', () => {
    expect(filtersToParams({ ...defaultFilters(today), search: 'обед' }, today).toString()).toBe('');
  });
  it('явный period главнее month; period=month без месяца пропускается', () => {
    expect(filtersFromParams(new URLSearchParams('period=all&month=2026-03'), today)).toEqual({ period: 'all', month: '2026-03' });
    expect(filtersFromParams(new URLSearchParams('period=month'), today)).toEqual({});
    expect(filtersFromParams(new URLSearchParams('period=чушь'), today)).toEqual({});
  });
  it('кошелёк: id принимается, мусор — нет; ссылка с чипа кошелька', () => {
    expect(filtersFromParams(new URLSearchParams('wallet=w-1'), today)).toEqual({ walletId: 'w-1' });
    expect(filtersFromParams(new URLSearchParams('wallet=a%20b'), today)).toEqual({});
    expect(filtersFromParams(new URLSearchParams(walletOpsQuery('w-1')), today)).toEqual({ walletId: 'w-1', period: 'all' });
  });
});

describe('filtersFromParams: фильтры из адреса', () => {
  const q = (s: string) => new URLSearchParams(s);
  const today = '2026-10-15';

  it('нет параметров — ничего не меняет', () => {
    expect(filtersFromParams(q(''), today)).toEqual({});
  });
  it('месяц: другой — period «month», сегодняшний — «this»', () => {
    expect(filtersFromParams(q('month=2026-09'), today)).toEqual({ period: 'month', month: '2026-09' });
    expect(filtersFromParams(q('month=2026-10'), today)).toEqual({ period: 'this', month: '2026-10' });
  });
  it('категория: id, «none» — без категории', () => {
    expect(filtersFromParams(q('category=abc-123'), today)).toEqual({ categoryId: 'abc-123' });
    expect(filtersFromParams(q('category=none'), today)).toEqual({ categoryId: NO_CATEGORY });
  });
  it('вид операции', () => {
    expect(filtersFromParams(q('kind=expense'), today)).toEqual({ kind: 'expense' });
    expect(filtersFromParams(q('kind=transfer'), today)).toEqual({ kind: 'transfer' });
  });
  it('всё вместе', () => {
    expect(filtersFromParams(q('month=2026-08&category=c1&kind=expense'), today)).toEqual({ period: 'month', month: '2026-08', categoryId: 'c1', kind: 'expense' });
  });
  it.each([
    ['month=2026-13'],
    ['month=2026-9'],
    ['month=1999-12'],
    ['month=2101-01'],
    ['month=вчера'],
    ['month='],
    ['category=a b'],
    ['category=%3Cscript%3E'],
    ['category='],
    ['category=' + 'x'.repeat(65)],
    ['kind=все'],
    ['kind=EXPENSE'],
  ])('мусор «%s» пропускается', (s) => {
    expect(filtersFromParams(q(s), today)).toEqual({});
  });
});

describe('transactionsQuery: запрос для ссылки с готовыми фильтрами', () => {
  it('месяц, категория и вид', () => {
    expect(transactionsQuery({ month: '2026-10', categoryId: 'c1', kind: 'expense' })).toBe('month=2026-10&category=c1&kind=expense');
  });
  it('без категории — none; без категории и вида — только месяц', () => {
    expect(transactionsQuery({ month: '2026-10', categoryId: null })).toBe('month=2026-10&category=none');
    expect(transactionsQuery({ month: '2026-09' })).toBe('month=2026-09');
  });
  it('запрос разбирается обратно', () => {
    const query = transactionsQuery({ month: '2026-09', categoryId: 'c-1', kind: 'expense' });
    expect(filtersFromParams(new URLSearchParams(query), '2026-10-15')).toEqual({ period: 'month', month: '2026-09', categoryId: 'c-1', kind: 'expense' });
  });
});

describe('toTxFilter: фильтр по категории и подкатегории', () => {
  const cats = [
    { id: 'comm', parentId: null },
    { id: 'water', parentId: 'comm' },
    { id: 'light', parentId: 'comm' },
    { id: 'food', parentId: null },
  ];
  const f = (categoryId: string): ListFilters => ({ ...defaultFilters('2026-10-31'), categoryId });

  it('родитель показывает и операции подкатегорий', () => {
    const out = toTxFilter(f('comm'), '', '2026-10-31', cats);
    expect(out.categoryId).toBeUndefined();
    expect([...(out.categoryIds ?? [])].sort()).toEqual(['comm', 'light', 'water']);
  });

  it('категория без подкатегорий и подкатегория — только свои операции, как раньше', () => {
    expect(toTxFilter(f('food'), '', '2026-10-31', cats)).toMatchObject({ categoryId: 'food' });
    expect(toTxFilter(f('food'), '', '2026-10-31', cats).categoryIds).toBeUndefined();
    expect(toTxFilter(f('water'), '', '2026-10-31', cats)).toMatchObject({ categoryId: 'water' });
  });

  it('без списка категорий (по умолчанию) и «Без категории» — прежнее поведение', () => {
    expect(toTxFilter(f('comm'), '', '2026-10-31')).toMatchObject({ categoryId: 'comm' });
    expect(toTxFilter({ ...defaultFilters('2026-10-31'), categoryId: NO_CATEGORY }, '', '2026-10-31', cats)).toMatchObject({ categoryId: null });
  });
});

describe('периоды «7 дней», «30 дней» и «Свои даты»', () => {
  const today = '2026-10-15';

  it('periodRange: 7 и 30 дней — вместе с сегодняшним, через границу месяца и года', () => {
    expect(periodRange('7d', '', today)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(periodRange('30d', '', today)).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    expect(periodRange('7d', '', '2026-01-03')).toEqual({ from: '2025-12-28', to: '2026-01-03' });
    expect(periodRange('30d', '', '2024-03-10')).toEqual({ from: '2024-02-10', to: '2024-03-10' }); // високосный год
  });

  it('periodRange: свои даты берутся как заданы; не заданная граница ничего не ограничивает', () => {
    expect(periodRange('range', '', today, { from: '2026-09-01', to: '2026-09-10' })).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(periodRange('range', '', today, { from: '2026-09-01', to: '' })).toEqual({ from: '2026-09-01' });
    expect(periodRange('range', '', today)).toEqual({});
  });

  it('toTxFilter: даты своего периода попадают в запрос, у других периодов from/to игнорируются', () => {
    const base = { ...defaultFilters(today), from: '2026-09-01' as const, to: '2026-09-10' as const };
    expect(toTxFilter({ ...base, period: 'range' }, '', today)).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(toTxFilter({ ...base, period: 'all' }, '', today)).toEqual({});
    expect(toTxFilter({ ...base, period: '7d' }, '', today)).toEqual({ from: '2026-10-09', to: today });
  });

  it('в адресе: туда и обратно, адрес читаемый', () => {
    const back = (f: ListFilters) => ({ ...defaultFilters(today), ...filtersFromParams(filtersToParams(f, today), today) });
    for (const period of ['7d', '30d'] as const) {
      const f = { ...defaultFilters(today), period };
      expect(filtersToParams(f, today).toString()).toBe(`period=${period}`);
      expect(back(f)).toEqual(f);
    }
    const range = { ...defaultFilters(today), period: 'range' as const, from: '2026-09-01' as const, to: '2026-09-10' as const };
    expect(filtersToParams(range, today).toString()).toBe('period=range&from=2026-09-01&to=2026-09-10');
    expect(back(range)).toEqual(range);
    // даты запоминаются и при других периодах: они в адрес не пишутся, но и не мешают
    expect(filtersToParams({ ...range, period: 'all' }, today).toString()).toBe('period=all');
  });

  it('«Свои даты» без годных дат в адрес не пишутся (иначе адрес прочёлся бы как обычный список)', () => {
    expect(filtersToParams({ ...defaultFilters(today), period: 'range' }, today).toString()).toBe('');
    expect(filtersToParams({ ...defaultFilters(today), period: 'range', from: '2026-09-10', to: '2026-09-01' }, today).toString()).toBe('');
    expect(filtersToParams({ ...defaultFilters(today), period: 'range', month: '2026-07' }, today).toString()).toBe('period=this&month=2026-07');
  });

  it.each([
    ['нет границ', 'period=range'],
    ['нет конца', 'period=range&from=2026-09-01'],
    ['начало позже конца', 'period=range&from=2026-09-10&to=2026-09-01'],
    ['не дата', 'period=range&from=вчера&to=сегодня'],
    ['30 февраля', 'period=range&from=2026-02-30&to=2026-03-05'],
    ['год вне границ', 'period=range&from=1999-12-31&to=2026-03-05'],
    ['год вне границ (конец)', 'period=range&from=2026-03-05&to=2101-01-01'],
  ])('из адреса: %s — период пропускается', (_, query) => {
    expect(filtersFromParams(new URLSearchParams(query), today)).toEqual({});
  });

  it('из адреса: from и to без period=range ничего не меняют; граничные даты допустимы', () => {
    expect(filtersFromParams(new URLSearchParams('from=2026-09-01&to=2026-09-10'), today)).toEqual({});
    expect(filtersFromParams(new URLSearchParams('period=range&from=2000-01-01&to=2100-12-31'), today)).toEqual({
      period: 'range',
      from: '2000-01-01',
      to: '2100-12-31',
    });
    expect(filtersFromParams(new URLSearchParams('period=range&from=2026-09-05&to=2026-09-05'), today)).toMatchObject({ period: 'range' });
  });

  it('из адреса: «свои даты» вместе с кошельком и видом', () => {
    expect(filtersFromParams(new URLSearchParams('period=range&from=2026-09-01&to=2026-09-10&wallet=w-1&kind=expense'), today)).toEqual({
      period: 'range',
      from: '2026-09-01',
      to: '2026-09-10',
      walletId: 'w-1',
      kind: 'expense',
    });
  });

  it('withPeriod: «Свои даты» впервые открываются с начала месяца по сегодня, выбранные даты сохраняются', () => {
    const none = defaultFilters(today);
    expect(withPeriod(none, 'range', today)).toEqual({ period: 'range', from: '2026-10-01', to: today });
    expect(withPeriod({ from: '2026-09-01', to: '2026-09-10' }, 'range', today)).toEqual({ period: 'range' });
    expect(withPeriod({ from: '2026-09-10', to: '2026-09-01' }, 'range', today)).toEqual({ period: 'range', from: '2026-10-01', to: today });
    expect(withPeriod(none, '7d', today)).toEqual({ period: '7d' });
  });

  it('withRangeDate: начало позже конца и конец раньше начала подтягивают вторую границу', () => {
    const cur = { from: '2026-09-01' as const, to: '2026-09-10' as const };
    expect(withRangeDate(cur, 'from', '2026-09-05')).toEqual({ from: '2026-09-05' });
    expect(withRangeDate(cur, 'from', '2026-09-10')).toEqual({ from: '2026-09-10' });
    expect(withRangeDate(cur, 'from', '2026-09-20')).toEqual({ from: '2026-09-20', to: '2026-09-20' });
    expect(withRangeDate(cur, 'to', '2026-09-05')).toEqual({ to: '2026-09-05' });
    expect(withRangeDate(cur, 'to', '2026-08-20')).toEqual({ from: '2026-08-20', to: '2026-08-20' });
  });

  it('withRangeDate: пусто, не дата и год вне границ — без правки', () => {
    const cur = { from: '2026-09-01' as const, to: '2026-09-10' as const };
    for (const bad of ['', '2026-02-30', '0001-01-01', '2101-01-01', 'abc']) expect(withRangeDate(cur, 'from', bad)).toBeNull();
  });
});

describe('сумма и «откуда» в адресе', () => {
  const today = '2026-10-15';
  const q = (s: string) => new URLSearchParams(s);

  it('читаемый адрес: min, max, src', () => {
    const f = { ...defaultFilters(today), amountFrom: '100', amountTo: '12.5', source: 'recurring' as const };
    expect(filtersToParams(f, today).toString()).toBe('min=100&max=12.5&src=recurring');
  });

  it('из адреса: сумма и «откуда» принимаются', () => {
    expect(filtersFromParams(q('min=100&max=500&src=debt'), today)).toEqual({ amountFrom: '100', amountTo: '500', source: 'debt' });
    expect(filtersFromParams(q('min=0'), today)).toEqual({ amountFrom: '0' });
  });

  it.each([
    'min=abc',
    'min=-5',
    'min=1,5', // запятая в адресе не «чистая»: границы в адресе пишутся только через filtersToParams
    'min=1e3',
    'min=1234567890123',
    'max=5.12345',
    'src=чужое',
    'src=',
    'min=&max=',
  ])('из адреса: %s — пропускается', (query) => {
    expect(filtersFromParams(q(query), today)).toEqual({});
  });
});
