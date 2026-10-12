import { describe, expect, it } from 'vitest';
import { checkDraft, matchByName, normalizeAiExpenses, type DictContext, type DraftExpense } from './expensesAi';

const ctx: DictContext = {
  wallets: [
    { id: 'w1', name: 'Наличные', currency: 'TJS' },
    { id: 'w2', name: 'Карта Алиф', currency: 'TJS' },
    { id: 'w3', name: 'Доллары', currency: 'USD' },
  ],
  categories: [
    { id: 'c1', name: 'Продукты' },
    { id: 'c2', name: 'Транспорт' },
  ],
  defaultWalletId: 'w1',
  today: '2026-10-12',
};

describe('matchByName', () => {
  it('ищет без учёта регистра и ё, а неоднозначное «содержит» не угадывает', () => {
    expect(matchByName('карта алиф', ctx.wallets)?.id).toBe('w2');
    expect(matchByName('Алиф', ctx.wallets)?.id).toBe('w2');
    expect(matchByName('', ctx.wallets)).toBeNull();
    expect(matchByName('а', [{ name: 'Банк' }, { name: 'Налог' }])).toBeNull();
  });
});

describe('normalizeAiExpenses', () => {
  it('собирает строки: счёт, категория, дата, комиссия', () => {
    const [a, b, c] = normalizeAiExpenses(
      [
        { title: 'такси', amount: 25, wallet: '', category: 'Транспорт', fee: 0, date: '2026-10-11', note: '' },
        { title: 'продукты', amount: 300.5, wallet: 'карта алиф', category: 'Еда', fee: 5, date: '', note: 'в Корзинке' },
        { title: 'кофе', amount: 6, wallet: 'доллары', category: '', fee: 0, date: 'вчера', note: '' },
      ],
      ctx,
    );
    expect(a).toMatchObject({ title: 'Такси', amountText: '25', walletId: 'w1', walletGuessed: true, categoryId: 'c2', date: '2026-10-11', feeText: '' });
    expect(b).toMatchObject({ walletId: 'w2', walletGuessed: false, amountText: '300,5', feeText: '5', categoryId: '', newCategory: 'Еда', date: '2026-10-12', note: 'в Корзинке' });
    expect(c).toMatchObject({ walletId: 'w3', categoryId: '', newCategory: '', date: '2026-10-12' });
    expect([a!.rid, b!.rid, c!.rid]).toEqual([1, 2, 3]);
  });
  it('отбрасывает мусор и не падает на чужом ответе', () => {
    expect(normalizeAiExpenses('x', ctx)).toEqual([]);
    expect(normalizeAiExpenses([null, 5, { title: '', amount: 0 }, { title: 'ок', amount: -3 }, { title: 'нан', amount: NaN }], ctx).map((d) => [d.title, d.amountText])).toEqual([
      ['Ок', ''],
      ['Нан', ''],
    ]);
  });
});

describe('checkDraft', () => {
  const d: DraftExpense = { rid: 1, title: 'x', amountText: '12,5', feeText: '1,5', walletId: 'w1', categoryId: '', newCategory: '', date: '2026-10-12', note: '', walletGuessed: false };
  it('сумма списания = расход + комиссия', () => {
    expect(checkDraft(d, 'TJS')).toEqual({ totalMinor: 1400, feeMinor: 150, error: null });
  });
  it('находит ошибки', () => {
    expect(checkDraft({ ...d, amountText: '' }, 'TJS').error).toMatch(/сумму/);
    expect(checkDraft({ ...d, feeText: 'abc' }, 'TJS').error).toMatch(/Комиссия/);
    expect(checkDraft(d, undefined).error).toMatch(/счёт/);
    expect(checkDraft({ ...d, date: '2026-02-30' as never }, 'TJS').error).toMatch(/дату/);
  });
});
