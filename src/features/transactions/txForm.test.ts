import { describe, expect, it } from 'vitest';
import { FxRequiredError } from '@/db';
import { TRANSFER_CREATES_MONEY_TEXT } from '@/db/validate';
import type { Transaction } from '@/domain/types';
import { describeTx, MISSING_WALLET } from './txDisplay';
import {
  changedFields,
  checkDate,
  emptyForm,
  errorField,
  firstOtherWallet,
  formatRate,
  formFromTx,
  fxSourceOf,
  parseRateText,
  pickDefaultWallet,
  rankByCount,
  resolveDate,
  ruDate,
} from './txForm';

describe('parseRateText', () => {
  it('принимает запятую и точку, пробелы-разделители тысяч', () => {
    expect(parseRateText('10,9')).toBe(10.9);
    expect(parseRateText('10.95')).toBe(10.95);
    expect(parseRateText(' 1 000 ')).toBe(1000);
    expect(parseRateText('1 000,5')).toBe(1000.5);
    expect(parseRateText('0,0917')).toBe(0.0917);
    expect(parseRateText('.5')).toBe(0.5);
    expect(parseRateText('7.')).toBe(7);
  });

  it('отвергает всё, что не положительное десятичное число', () => {
    for (const bad of ['', ' ', 'abc', '1e3', '-5', '+5', '0', '0,0', '1,2,3', '1.2.3', '1..2', '10,9 с.', '∞', 'NaN', '0x10', '१२']) {
      expect(parseRateText(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('границы курсового сервиса и не больше 10 знаков после запятой', () => {
    expect(parseRateText('1000000000')).toBe(1e9);
    expect(parseRateText('1000000001')).toBeNull();
    expect(parseRateText('0,000000001')).toBe(1e-9);
    expect(parseRateText('0,0000000001')).toBeNull(); // меньше нижней границы
    expect(parseRateText('1,12345678901')).toBeNull(); // 11 знаков
    expect(parseRateText('1,1234567890')).toBe(1.123456789);
  });
});

describe('formatRate', () => {
  it('округляет до четырёх значащих знаков и пишет запятой', () => {
    expect(formatRate(10.9)).toBe('10,9');
    expect(formatRate(10.95)).toBe('10,95');
    expect(formatRate(0.0917431)).toBe('0,091743');
    expect(formatRate(1090)).toBe('1 090');
    expect(formatRate(1)).toBe('1');
  });
  it('мусор — прочерк', () => {
    for (const bad of [0, -1, NaN, Infinity]) expect(formatRate(bad)).toBe('—');
  });
});

describe('даты', () => {
  const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

  it('«Сегодня» считается в момент сохранения, по местному времени', () => {
    expect(resolveDate({ mode: 'today' }, at(2026, 10, 10))).toBe('2026-10-10');
    // сразу после полуночи (в Таджикистане это ещё «вчера» по UTC) — всё равно местный день
    expect(resolveDate({ mode: 'today' }, at(2026, 10, 10, 0, 5))).toBe('2026-10-10');
    // шит открыли вечером, сохранили после полуночи — дата уже новая
    expect(resolveDate({ mode: 'today' }, at(2026, 10, 11, 0, 1))).toBe('2026-10-11');
  });

  it('выбранная дата возвращается как есть', () => {
    expect(resolveDate({ mode: 'date', value: '2025-05-05' }, at(2026, 10, 10))).toBe('2025-05-05');
  });

  it('checkDate: границы 2000-01-01 и 2100-01-01 включительно, дальше — нет', () => {
    for (const ok of ['2000-01-01', '2100-01-01', '2026-02-28', '2024-02-29']) expect(checkDate(ok), ok).toBeNull();
    for (const bad of ['1999-12-31', '2100-01-02', '0001-01-01', '9999-12-31']) {
      expect(checkDate(bad), bad).toBe('Дата должна быть между 2000 и 2100 годом');
    }
  });

  it('checkDate: пусто и несуществующие даты', () => {
    expect(checkDate('')).toBe('Укажите дату');
    for (const bad of ['2026-02-30', '2026-13-01', '2025-02-29', '2026-1-5', 'вчера', '2026-10-10T00:00', '10.10.2026']) {
      expect(checkDate(bad), bad).toBe('Такой даты нет: выберите её в календаре');
    }
  });

  it('ruDate', () => {
    expect(ruDate('2026-10-05')).toBe('05.10.2026');
    expect(ruDate('мусор')).toBe('мусор');
  });
});

describe('источник курса', () => {
  it('ручной — «manual»; известные источники сохраняются; незнакомый — «cached» (репозиторий другого не примет)', () => {
    expect(fxSourceOf({ source: 'nbt', manual: false })).toBe('nbt');
    expect(fxSourceOf({ source: 'server', manual: false })).toBe('server');
    expect(fxSourceOf({ source: 'api', manual: false })).toBe('api');
    expect(fxSourceOf({ source: 'nbt', manual: true })).toBe('manual');
    expect(fxSourceOf({ source: 'manual', manual: true })).toBe('manual');
    expect(fxSourceOf({ source: 'какой-то', manual: false })).toBe('cached');
  });
});

describe('выбор кошелька и порядок категорий', () => {
  const ws = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('последний использованный → по умолчанию из настроек → первый', () => {
    expect(pickDefaultWallet(ws, 'b', 'c')).toBe('b');
    expect(pickDefaultWallet(ws, null, 'c')).toBe('c');
    expect(pickDefaultWallet(ws, null, null)).toBe('a');
    expect(pickDefaultWallet([], null, null)).toBeNull();
  });
  it('кошелёк, которого нет в списке (архив, удалён), не подставляется', () => {
    expect(pickDefaultWallet(ws, 'zzz', 'c')).toBe('c');
    expect(pickDefaultWallet(ws, 'zzz', 'yyy')).toBe('a');
  });
  it('firstOtherWallet', () => {
    expect(firstOtherWallet(ws, 'a')).toBe('b');
    expect(firstOtherWallet(ws, null)).toBe('a');
    expect(firstOtherWallet([{ id: 'a' }], 'a')).toBeNull();
  });
  it('rankByCount: чаще — раньше; при равенстве прежний порядок; исходный список не меняется', () => {
    const cats = [{ id: 'food' }, { id: 'bus' }, { id: 'home' }, { id: 'fun' }];
    const counts = new Map([
      ['bus', 5],
      ['fun', 5],
      ['home', 1],
    ]);
    expect(rankByCount(cats, counts).map((c) => c.id)).toEqual(['bus', 'fun', 'home', 'food']);
    expect(cats.map((c) => c.id)).toEqual(['food', 'bus', 'home', 'fun']);
    expect(rankByCount(cats, new Map()).map((c) => c.id)).toEqual(['food', 'bus', 'home', 'fun']);
  });
});

describe('errorField: к какому полю относится сообщение репозитория', () => {
  const field = (m: string) => errorField(m);
  it('сообщения из репозитория попадают к своим полям', () => {
    expect(field('Сумма: должна быть больше нуля')).toBe('amount');
    expect(field('Сумма слишком велика: допустимо не больше 1 000 000 000 000 000')).toBe('amount');
    expect(field('Сумма слишком велика для пересчёта в базовую валюту')).toBe('amount');
    expect(field('Заметка: не длиннее 500 символов')).toBe('note');
    expect(field('Дата операции: допустимы даты с 2000-01-01 по 2100-01-01')).toBe('date');
    expect(field(new FxRequiredError('USD', 'TJS').message)).toBe('rate');
    expect(field('Курс: ожидалось число больше нуля')).toBe('rate');
    expect(field('Категория «Еда» не подходит: она для расходов')).toBe('category');
    expect(field('Кошелёк «Нал» в архиве: выберите другой или верните его из архива')).toBe('wallet');
    expect(field('Кошелёк не найден')).toBe('wallet');
  });
  it('перевод: кошелёк и сумма зачисления отличаются от списания', () => {
    expect(field('Кошелёк зачисления не найден')).toBe('toWallet');
    expect(field('Перевод: укажите кошелёк зачисления')).toBe('toWallet');
    expect(field('Перевод: кошелёк зачисления должен отличаться от кошелька списания')).toBe('toWallet');
    expect(field('Сумма зачисления: должна быть больше нуля')).toBe('toAmount');
    expect(field('Укажите сумму зачисления: у кошельков разные валюты')).toBe('toAmount');
    expect(field(TRANSFER_CREATES_MONEY_TEXT)).toBe('toAmount');
  });
  it('неизвестное — к форме целиком', () => {
    expect(field('Операция удалена: сначала восстановите её')).toBe('form');
    expect(field('что-то непонятное')).toBe('form');
    expect(field('')).toBe('form');
  });
  it('если поля сейчас нет на экране, сообщение уходит вниз формы и не теряется', () => {
    expect(errorField('Курс: ожидалось число', (f) => f !== 'rate')).toBe('form');
    expect(errorField('Заметка: слишком длинная', () => true)).toBe('note');
  });
});

describe('formFromTx', () => {
  const currencies: Record<string, string> = { a: 'TJS', b: 'TJS', u: 'USD' };
  const base: Transaction = {
    id: 't1',
    kind: 'transfer',
    walletId: 'a',
    toWalletId: 'b',
    amountMinor: 10_000,
    toAmountMinor: 9800,
    categoryId: null,
    occurredOn: '2026-10-05',
    note: 'комиссия',
    baseCurrency: 'TJS',
    baseAmountMinor: 0,
    fxRate: null,
    fxSource: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    clientUpdatedAt: '2026-10-05T10:00:00.000Z',
    deviceId: 'd',
    deletedAt: null,
  };
  const of = (t: Transaction) => formFromTx(t, (id) => currencies[id]);

  it('перевод с комиссией: поле «Получено» открыто и заполнено', () => {
    expect(of(base)).toMatchObject({
      kind: 'transfer',
      amountMinor: 10_000,
      walletId: 'a',
      toWalletId: 'b',
      toAmountOverride: 9800,
      feeOpen: true,
      date: { mode: 'date', value: '2026-10-05' },
      note: 'комиссия',
    });
  });
  it('перевод без комиссии: поле скрыто', () => {
    expect(of({ ...base, toAmountMinor: 10_000 }).feeOpen).toBe(false);
  });
  it('перевод между валютами: «Получено» уже введено, поле не про комиссию', () => {
    const f = of({ ...base, toWalletId: 'u', toAmountMinor: 900 });
    expect(f).toMatchObject({ toAmountOverride: 900, feeOpen: false });
  });
  it('расход: «Получено» не используется', () => {
    const f = of({ ...base, kind: 'expense', toWalletId: null, toAmountMinor: null, categoryId: 'c1' });
    expect(f).toMatchObject({ kind: 'expense', categoryId: 'c1', toAmountOverride: undefined, feeOpen: false });
  });
  it('emptyForm: сегодня, без суммы и категории', () => {
    expect(emptyForm('w1')).toMatchObject({ kind: 'expense', walletId: 'w1', amountMinor: null, categoryId: null, date: { mode: 'today' }, note: '' });
  });
});

describe('changedFields: что уходит в базу при правке', () => {
  const orig: Transaction = {
    id: 't1',
    createdAt: '2026-10-05T10:00:00.000Z',
    clientUpdatedAt: '2026-10-05T10:00:00.000Z',
    deviceId: 'dev-1',
    deletedAt: null,
    kind: 'expense',
    walletId: 'a',
    toWalletId: null,
    amountMinor: 1000,
    toAmountMinor: null,
    categoryId: 'c1',
    occurredOn: '2026-10-05',
    note: 'обед',
    baseCurrency: 'TJS',
    baseAmountMinor: 1000,
    fxRate: 1,
    fxSource: 'same',
  };
  const input = (over: Record<string, unknown> = {}) => ({
    kind: 'expense' as const,
    walletId: 'a',
    toWalletId: null,
    toAmountMinor: null,
    amountMinor: 1000,
    categoryId: 'c1',
    occurredOn: '2026-10-05',
    note: 'обед',
    ...over,
  });

  it('ничего не менял — пусто', () => {
    expect(changedFields(input(), orig)).toEqual({});
  });
  it('поменял только заметку — уходит только заметка (сумму могли исправить с другого устройства)', () => {
    expect(changedFields(input({ note: 'обед с коллегой' }), orig)).toEqual({ note: 'обед с коллегой' });
  });
  it('пробелы по краям старой заметки — не правка человека', () => {
    expect(changedFields(input(), { ...orig, note: '  обед ' })).toEqual({});
  });
  it('сумма с курсом: уходят сумма и курс', () => {
    const fx = { rate: 10.9, source: 'nbt' };
    expect(changedFields(input({ amountMinor: 2000, fx }), orig)).toEqual({ amountMinor: 2000, fx });
  });
  it('категория сброшена в «без категории» — это изменение (null), а не «не трогал»', () => {
    expect(changedFields(input({ categoryId: null }), orig)).toEqual({ categoryId: null });
  });
  it('перевод: сменилась сумма списания — «Получено» уходит вместе с ней, даже если число то же', () => {
    const transfer: Transaction = { ...orig, kind: 'transfer', toWalletId: 'b', toAmountMinor: 1000, categoryId: null, baseAmountMinor: 0, fxRate: null, fxSource: null };
    const t = (over: Record<string, unknown>) => input({ kind: 'transfer', toWalletId: 'b', toAmountMinor: 1000, categoryId: null, ...over });
    expect(changedFields(t({}), transfer)).toEqual({});
    expect(changedFields(t({ amountMinor: 2000 }), transfer)).toEqual({ amountMinor: 2000, toAmountMinor: 1000 });
    expect(changedFields(t({ toAmountMinor: 900 }), transfer)).toEqual({ toAmountMinor: 900 });
  });
  it('расход → перевод: вид, «Куда», «Получено» и сброшенная категория', () => {
    expect(changedFields(input({ kind: 'transfer', toWalletId: 'b', toAmountMinor: 1000, categoryId: null }), orig)).toEqual({
      kind: 'transfer',
      toWalletId: 'b',
      toAmountMinor: 1000,
      categoryId: null,
    });
  });
});

describe('describeTx: вид строки списка', () => {
  const wallets = new Map([
    ['w1', { name: 'Наличные', currency: 'TJS' }],
    ['w2', { name: 'Доллары', currency: 'USD' }],
    ['w3', { name: 'Карта', currency: 'TJS' }],
  ]);
  const cats = new Map([
    ['c1', { name: 'Еда', icon: '🍽️', color: '#f97316' }],
    ['c2', { name: 'Странная', icon: '?', color: 'красный' }],
  ]);
  const tx = (over: Partial<Parameters<typeof describeTx>[0]> = {}) => ({
    kind: 'expense' as const,
    walletId: 'w1',
    toWalletId: null,
    categoryId: 'c1',
    amountMinor: 1250,
    toAmountMinor: null,
    note: '  обед ',
    baseCurrency: 'TJS',
    ...over,
  });

  it('расход: минус, название категории, кошелёк и заметка', () => {
    expect(describeTx(tx(), wallets, cats)).toEqual({
      icon: '🍽️',
      color: '#f97316',
      title: 'Еда',
      subtitle: 'Наличные · обед',
      currency: 'TJS',
      signedMinor: -1250,
      tone: 'expense',
      second: null,
    });
  });
  it('доход: плюс; без категории — «Без категории» и нейтральный значок', () => {
    const v = describeTx(tx({ kind: 'income', categoryId: null, note: '' }), wallets, cats);
    expect(v).toMatchObject({ title: 'Без категории', icon: '➕', signedMinor: 1250, tone: 'income', subtitle: 'Наличные' });
    expect(describeTx(tx({ categoryId: null }), wallets, cats).icon).toBe('➖');
  });
  it('цвет категории, не похожий на #rrggbb, не используется', () => {
    expect(describeTx(tx({ categoryId: 'c2' }), wallets, cats).color).toBeNull();
  });
  it('перевод: «A → B», нейтральная сумма; между валютами — ещё и сколько пришло', () => {
    const same = describeTx(tx({ kind: 'transfer', categoryId: null, toWalletId: 'w3', toAmountMinor: 1250, note: '' }), wallets, cats);
    expect(same).toMatchObject({ title: 'Наличные → Карта', tone: 'none', signedMinor: 1250, second: null, subtitle: '' });
    const cross = describeTx(tx({ kind: 'transfer', categoryId: null, toWalletId: 'w2', toAmountMinor: 115 }), wallets, cats);
    expect(cross.second).toBe('→ 1,15 $');
  });
  it('кошелёк, которого больше нет, не роняет строку; валюта берётся из снимка операции', () => {
    const v = describeTx(tx({ walletId: 'gone', baseCurrency: 'TJS' }), wallets, cats);
    expect(v.subtitle).toContain(MISSING_WALLET);
    expect(v.currency).toBe('TJS');
    const t = describeTx(tx({ kind: 'transfer', walletId: 'gone', toWalletId: 'gone2', categoryId: null }), wallets, cats);
    expect(t.title).toBe(`${MISSING_WALLET} → ${MISSING_WALLET}`);
  });
});
