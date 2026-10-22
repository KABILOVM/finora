import { describe, expect, it } from 'vitest';
import type { NoteEntry } from './noteSuggest';
import { parseQuickLine, type QuickLineContext } from './quickLine';

const wallets = [
  { id: 'cash', name: 'Наличные', currency: 'TJS' as const },
  { id: 'card', name: 'Карта', currency: 'TJS' as const },
  { id: 'usd', name: 'Доллары США', currency: 'USD' as const },
];
const categories = [
  { id: 'food', name: 'Еда', kind: 'expense' as const, archivedAt: null },
  { id: 'taxi', name: 'Такси', kind: 'expense' as const, archivedAt: null },
  { id: 'old', name: 'Старая', kind: 'expense' as const, archivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'pay', name: 'Зарплата', kind: 'income' as const, archivedAt: null },
];
const entry = (over: Partial<NoteEntry> = {}): NoteEntry => ({
  kind: 'expense',
  note: 'Кофе',
  norm: 'кофе',
  categoryId: 'food',
  walletId: 'card',
  amountMinor: 1500,
  count: 3,
  lastOn: '2026-10-05',
  ...over,
});

const ctx = (over: Partial<QuickLineContext> = {}): QuickLineContext => ({
  wallets,
  categories,
  noteIndex: [],
  kind: 'expense',
  currentWalletId: 'cash',
  today: '2026-10-15',
  ...over,
});

describe('parseQuickLine', () => {
  it('«такси 20 карта»: сумма и кошелёк из строки, категория по названию слова', () => {
    // слово «такси» — и есть категория «Такси», поэтому в заметке оно не дублируется
    expect(parseQuickLine('такси 20 карта', ctx())).toEqual({ note: '', amountMinor: 2000, walletId: 'card', categoryId: 'taxi', date: null });
  });

  it('привычная категория и кошелёк берутся из истории заметок', () => {
    const got = parseQuickLine('кофе 15', ctx({ noteIndex: [entry()] }));
    expect(got).toEqual({ note: 'кофе', amountMinor: 1500, walletId: 'card', categoryId: 'food', date: null });
  });

  it('кошелёк, названный в строке, главнее привычного из истории', () => {
    expect(parseQuickLine('кофе 15 наличные', ctx({ noteIndex: [entry()] }))).toMatchObject({ walletId: 'cash', categoryId: 'food' });
  });

  it('из нескольких записей истории берётся самая частая, при равенстве — свежая', () => {
    const idx = [entry({ categoryId: 'taxi', count: 1 }), entry({ categoryId: 'food', count: 4 })];
    expect(parseQuickLine('кофе 15', ctx({ noteIndex: idx }))?.categoryId).toBe('food');
    const tie = [entry({ categoryId: 'taxi', count: 2, lastOn: '2026-10-01' }), entry({ categoryId: 'food', count: 2, lastOn: '2026-10-09' })];
    expect(parseQuickLine('кофе 15', ctx({ noteIndex: tie }))?.categoryId).toBe('food');
  });

  it('категория в архиве или чужого вида из истории не подставляется', () => {
    expect(parseQuickLine('кофе 15', ctx({ noteIndex: [entry({ categoryId: 'old' })] }))?.categoryId).toBeNull();
    expect(parseQuickLine('кофе 15', ctx({ noteIndex: [entry({ categoryId: 'pay' })] }))?.categoryId).toBeNull();
  });

  it('слово совпало с названием категории внутри заметки: «такси в аэропорт 50»', () => {
    expect(parseQuickLine('такси в аэропорт 50', ctx())).toMatchObject({ note: 'такси в аэропорт', categoryId: 'taxi', amountMinor: 5000 });
  });

  it('название категории целиком — «еда 30»: заметка пустая', () => {
    expect(parseQuickLine('Еда 30', ctx())).toMatchObject({ note: '', categoryId: 'food', amountMinor: 3000 });
  });

  it('вид «доход» ищет категории дохода', () => {
    expect(parseQuickLine('зарплата 5000', ctx({ kind: 'income' }))).toMatchObject({ categoryId: 'pay', amountMinor: 500000 });
    expect(parseQuickLine('зарплата 5000', ctx())?.categoryId).toBeNull();
  });

  it('вид «перевод» и непонятные строки — ничего не предлагается', () => {
    expect(parseQuickLine('такси 20 карта', ctx({ kind: 'transfer' }))).toBeNull();
    expect(parseQuickLine('такси', ctx())).toBeNull(); // нет числа
    expect(parseQuickLine('20', ctx())).toBeNull(); // одно число, больше ничего
    expect(parseQuickLine('', ctx())).toBeNull();
    expect(parseQuickLine('билеты 2 по 15', ctx())).toBeNull(); // два числа: неясно, какое сумма
  });

  it('кошелёк: полное название, начало названия (от трёх букв, если оно одно), несколько слов', () => {
    expect(parseQuickLine('обед 30 нал', ctx())?.walletId).toBe('cash');
    expect(parseQuickLine('обед 30 карт', ctx())?.walletId).toBe('card');
    expect(parseQuickLine('обед 30 нал.', ctx())?.walletId).toBe('cash');
    expect(parseQuickLine('обед 30 доллары сша', ctx())?.walletId).toBe('usd');
    expect(parseQuickLine('обед 30 на', ctx())?.walletId).toBeNull(); // «на» — меньше трёх букв
  });

  it('два кошелька с одинаковым началом — кошелёк не угадываем', () => {
    const two = [...wallets, { id: 'card2', name: 'Карта 2', currency: 'TJS' as const }, { id: 'card3', name: 'Картон', currency: 'TJS' as const }];
    expect(parseQuickLine('обед 30 карт', ctx({ wallets: two }))?.walletId).toBeNull();
    // а полное название выбирает своё
    expect(parseQuickLine('обед 30 карта', ctx({ wallets: two }))?.walletId).toBe('card');
  });

  it('сумма читается в валюте кошелька: в долларах копейки — центы; без кошелька — валюта выбранного в форме', () => {
    expect(parseQuickLine('кофе 2,5 доллары сша', ctx())?.amountMinor).toBe(250);
    expect(parseQuickLine('кофе 2,5', ctx({ currentWalletId: 'usd' }))?.amountMinor).toBe(250);
    // «1,000» неоднозначно (тысяча или единица?) — не угадываем
    expect(parseQuickLine('кофе 1,000', ctx())).toBeNull();
    expect(parseQuickLine('кофе 0', ctx())).toBeNull();
  });

  it('«к» после числа — тысячи', () => {
    expect(parseQuickLine('аренда 2к', ctx())?.amountMinor).toBe(200000);
    expect(parseQuickLine('аренда 1,5к', ctx())?.amountMinor).toBe(150000);
    expect(parseQuickLine('аренда 1k', ctx())?.amountMinor).toBe(100000);
  });

  it('«вчера», «позавчера», «сегодня» задают дату и не попадают в заметку', () => {
    expect(parseQuickLine('кофе 15 вчера', ctx())).toMatchObject({ note: 'кофе', date: '2026-10-14' });
    expect(parseQuickLine('Позавчера кофе 15', ctx())).toMatchObject({ note: 'кофе', date: '2026-10-13' });
    expect(parseQuickLine('кофе 15 сегодня', ctx())).toMatchObject({ note: 'кофе', date: '2026-10-15' });
  });

  it('слова и числа могут стоять в любом порядке', () => {
    expect(parseQuickLine('20 такси карта', ctx())).toMatchObject({ amountMinor: 2000, walletId: 'card', categoryId: 'taxi' });
  });

  it('нет ни одного кошелька — ничего не предлагаем (нечем прочитать сумму)', () => {
    expect(parseQuickLine('кофе 15', ctx({ wallets: [], currentWalletId: null }))).toBeNull();
  });

  it('мусор и крайности не роняют разбор', () => {
    expect(parseQuickLine('кофе 99999999999999999999', ctx())).toBeNull();
    expect(parseQuickLine('  кофе    15   ', ctx())).toMatchObject({ note: 'кофе', amountMinor: 1500 });
    expect(parseQuickLine('кофе -15', ctx())).toBeNull(); // «-15» не число
    expect(parseQuickLine('кофе 1e3', ctx())).toBeNull();
  });
});
