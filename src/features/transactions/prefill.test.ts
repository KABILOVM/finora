import { describe, expect, it } from 'vitest';
import { formFromPrefill, prefillOfForm, type TxPrefill } from './prefill';
import { emptyForm, NOTE_MAX } from './txForm';

const wallets = [{ id: 'cash' }, { id: 'card' }, { id: 'usd' }];
const cats = [
  { id: 'food', kind: 'expense' as const, archivedAt: null },
  { id: 'old', kind: 'expense' as const, archivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'pay', kind: 'income' as const, archivedAt: null },
];
const base = emptyForm('cash');

const p = (over: Partial<TxPrefill> = {}): TxPrefill => ({
  kind: 'expense',
  walletId: 'card',
  toWalletId: null,
  amountMinor: 1500,
  categoryId: 'food',
  note: 'Кофе',
  ...over,
});

describe('formFromPrefill', () => {
  it('расход: сумма, кошелёк, категория, заметка; дата — «сегодня»', () => {
    const f = formFromPrefill(p(), base, wallets, cats);
    expect(f).toMatchObject({ kind: 'expense', walletId: 'card', amountMinor: 1500, categoryId: 'food', note: 'Кофе', date: { mode: 'today' } });
  });

  it('кошелька нет в списке (в архиве или удалён) — берём кошелёк формы по умолчанию', () => {
    expect(formFromPrefill(p({ walletId: 'gone' }), base, wallets, cats).walletId).toBe('cash');
  });

  it('категория в архиве, чужого вида или несуществующая — без категории', () => {
    for (const categoryId of ['old', 'pay', 'nope']) expect(formFromPrefill(p({ categoryId }), base, wallets, cats).categoryId).toBeNull();
    expect(formFromPrefill(p({ kind: 'income', categoryId: 'pay' }), base, wallets, cats).categoryId).toBe('pay');
  });

  it('перевод: «куда» проверяется; совпало с «откуда» или пропало — первый другой кошелёк', () => {
    const t = (over: Partial<TxPrefill>) => formFromPrefill(p({ kind: 'transfer', categoryId: null, ...over }), base, wallets, cats);
    expect(t({ toWalletId: 'usd' })).toMatchObject({ kind: 'transfer', walletId: 'card', toWalletId: 'usd', categoryId: null });
    expect(t({ toWalletId: 'card' }).toWalletId).toBe('cash');
    expect(t({ toWalletId: 'gone' }).toWalletId).toBe('cash');
    expect(t({ toWalletId: null }).toWalletId).toBe('cash');
  });

  it('комиссия перевода переносится, если меньше суммы', () => {
    const t = (feeMinor: number) => formFromPrefill(p({ kind: 'transfer', toWalletId: 'cash', feeMinor }), base, wallets, cats);
    expect(t(50)).toMatchObject({ feeOpen: true, feeMode: 'amount', feeAmount: 50 });
    expect(t(1500)).toMatchObject({ feeOpen: false, feeAmount: null });
    expect(t(0)).toMatchObject({ feeOpen: false });
  });

  it('мусор в состоянии перехода не ломает форму', () => {
    expect(formFromPrefill(null, base, wallets, cats)).toBe(base);
    expect(formFromPrefill('x', base, wallets, cats)).toBe(base);
    expect(formFromPrefill({ kind: 'weird' }, base, wallets, cats)).toBe(base);
    const f = formFromPrefill({ kind: 'expense', walletId: 7, amountMinor: -5, categoryId: {}, note: 42 }, base, wallets, cats);
    expect(f).toMatchObject({ kind: 'expense', walletId: 'cash', amountMinor: null, categoryId: null, note: '' });
    expect(formFromPrefill(p({ amountMinor: 1.5 }), base, wallets, cats).amountMinor).toBeNull();
    expect(formFromPrefill(p({ amountMinor: Number.MAX_SAFE_INTEGER + 1 }), base, wallets, cats).amountMinor).toBeNull();
  });

  it('длинная заметка обрезается до NOTE_MAX', () => {
    expect(formFromPrefill(p({ note: 'я'.repeat(NOTE_MAX + 50) }), base, wallets, cats).note).toHaveLength(NOTE_MAX);
  });
});

describe('prefillOfForm', () => {
  const form = { ...emptyForm('card'), amountMinor: 1500, categoryId: 'food', note: '  Кофе ' };

  it('копирует поля и срезает заметку', () => {
    expect(prefillOfForm(form, null)).toEqual({ kind: 'expense', walletId: 'card', toWalletId: null, amountMinor: 1500, categoryId: 'food', note: 'Кофе' });
  });

  it('пустая сумма не превращается в число: принимающая сторона её отбросит', () => {
    const out = prefillOfForm({ ...form, amountMinor: null }, null);
    expect(out.amountMinor).toBe(0);
    expect(formFromPrefill(out, emptyForm('cash'), wallets, cats).amountMinor).toBeNull();
  });

  it('перевод: комиссия переносится, только если включена и положительна; категории у перевода нет', () => {
    const t = { ...form, kind: 'transfer' as const, toWalletId: 'cash', feeOpen: true };
    expect(prefillOfForm(t, 50)).toMatchObject({ kind: 'transfer', toWalletId: 'cash', categoryId: null, feeMinor: 50 });
    expect(prefillOfForm(t, 0).feeMinor).toBeUndefined();
    expect(prefillOfForm(t, null).feeMinor).toBeUndefined();
    expect(prefillOfForm({ ...t, feeOpen: false }, 50).feeMinor).toBeUndefined();
    // у расхода комиссия добавлена к сумме при внесении, отдельно не переносится
    expect(prefillOfForm({ ...form, feeOpen: true }, 50).feeMinor).toBeUndefined();
  });

  it('форма → предзаполнение → форма даёт то же самое', () => {
    const t = { ...emptyForm('card', 'transfer'), toWalletId: 'usd', amountMinor: 1000, feeOpen: true };
    const back = formFromPrefill(prefillOfForm(t, 20), emptyForm('cash'), wallets, cats);
    expect(back).toMatchObject({ kind: 'transfer', walletId: 'card', toWalletId: 'usd', amountMinor: 1000, feeOpen: true, feeAmount: 20 });
  });
});
