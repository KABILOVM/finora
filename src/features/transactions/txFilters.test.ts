import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  activeFilterLabels,
  dayTotal,
  defaultFilters,
  filtersFromParams,
  filtersToParams,
  matchesSearch,
  NO_CATEGORY,
  totalsByCurrency,
  transactionsQuery,
  transferFeeMinor,
  walletOpsQuery,
  withKind,
  type ListFilters,
  type SearchLookups,
} from './txFilters';

describe('фильтры из шита «Фильтры»: чистая логика', () => {
  it('activeFilterCount: считает только то, что лежит в шите (кошелёк, вид, категория)', () => {
    expect(activeFilterCount({ walletId: '', kind: '', categoryId: '' })).toBe(0);
    expect(activeFilterCount({ walletId: 'w1', kind: '', categoryId: '' })).toBe(1);
    expect(activeFilterCount({ walletId: 'w1', kind: 'expense', categoryId: '' })).toBe(2);
    expect(activeFilterCount({ walletId: 'w1', kind: 'income', categoryId: '__none__' })).toBe(3); // «Без категории» — тоже фильтр
  });

  it('withKind: категория другого вида и любая при «Переводы» сбрасывается, подходящая остаётся', () => {
    const base = { walletId: 'w1', kind: '' as const, categoryId: 'c1' };
    expect(withKind(base, 'income', 'expense')).toEqual({ walletId: 'w1', kind: 'income', categoryId: '' });
    expect(withKind(base, 'expense', 'expense')).toEqual({ walletId: 'w1', kind: 'expense', categoryId: 'c1' });
    expect(withKind(base, 'transfer', 'expense')).toEqual({ walletId: 'w1', kind: 'transfer', categoryId: '' });
    expect(withKind(base, '', 'expense')).toEqual({ walletId: 'w1', kind: '', categoryId: 'c1' });
    // «Без категории» (вида нет) к расходам и доходам подходит
    expect(withKind({ ...base, categoryId: '__none__' }, 'income', undefined).categoryId).toBe('__none__');
  });

  it('activeFilterLabels: названия включённых фильтров по порядку', () => {
    const wallets = [{ id: 'w1', name: 'Карта' }];
    const categories = [{ id: 'c1', name: 'Еда' }];
    expect(activeFilterLabels({ walletId: '', kind: '', categoryId: '' }, wallets, categories)).toEqual([]);
    expect(activeFilterLabels({ walletId: 'w1', kind: 'expense', categoryId: 'c1' }, wallets, categories)).toEqual(['Карта', 'Расходы', 'Еда']);
    expect(activeFilterLabels({ walletId: '', kind: '', categoryId: '__none__' }, wallets, categories)).toEqual(['Без категории']);
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
  it('перевод между валютами ищется и по сумме зачисления', () => {
    expect(hit(move, '110')).toBe(true);
    expect(hit(move, '10')).toBe(true); // 10 $ на счёте зачисления
  });
});

describe('фильтры в адресе: filtersToParams ↔ filtersFromParams', () => {
  const today = '2026-10-15';
  const back = (f: ListFilters) => ({ ...defaultFilters(today), ...filtersFromParams(filtersToParams(f), today) });

  it('обычные фильтры — пустой адрес', () => {
    expect(filtersToParams(defaultFilters(today)).toString()).toBe('');
  });
  it.each<[string, Partial<ListFilters>]>([
    ['прошлый месяц', { period: 'prev' }],
    ['всё время', { period: 'all' }],
    ['другой месяц (не текущий)', { period: 'month', month: '2026-03' }],
    ['«Другой месяц», пока выбран именно текущий — не превращается в «Этот месяц»', { period: 'month', month: '2026-10' }],
    ['кошелёк, вид, категория', { walletId: 'w-1', kind: 'expense', categoryId: 'c-1' }],
    ['без категории', { categoryId: NO_CATEGORY, kind: 'income' }],
  ])('туда и обратно: %s', (_, patch) => {
    const f = { ...defaultFilters(today), ...patch };
    expect(back(f)).toEqual(f);
  });
  it('поиск в адрес не попадает', () => {
    expect(filtersToParams({ ...defaultFilters(today), search: 'обед' }).toString()).toBe('');
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

