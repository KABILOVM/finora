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
  incomeCategories: [
    { id: 'i1', name: 'Зарплата' },
    { id: 'i2', name: 'Подарки' },
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
  it('«автораспределение»: расход-продукт без категории от ИИ идёт в «Продукты»; названную ИИ категорию и не-продукты не трогаем', () => {
    const [bread, milk, taxi, soap, own] = normalizeAiExpenses(
      [
        { title: 'хлеб', amount: 5, wallet: '', category: '', fee: 0, date: '', note: '' },
        { title: 'молока', amount: 13, wallet: '', category: 'Транспорт', fee: 0, date: '', note: '' }, // ИИ назвал категорию — главнее
        { title: 'такси', amount: 25, wallet: '', category: '', fee: 0, date: '', note: '' },
        { title: 'мыло', amount: 4, wallet: '', category: '', fee: 0, date: '', note: '' },
        { title: 'Курт сушёный', amount: 9, wallet: '', category: '', fee: 0, date: '', note: '' },
      ],
      ctx,
    );
    expect(bread).toMatchObject({ categoryId: 'c1', newCategory: '' });
    expect(milk).toMatchObject({ categoryId: 'c2' });
    expect(taxi).toMatchObject({ categoryId: '' });
    expect(soap).toMatchObject({ categoryId: '' });
    expect(own).toMatchObject({ categoryId: '' });
  });
  it('доход «хлеб» категорию расходов не получает; без категории «Продукты» ничего не подставляется', () => {
    const [income] = normalizeAiExpenses([{ kind: 'income', title: 'хлеб', amount: 5, category: '' }], ctx);
    expect(income).toMatchObject({ kind: 'income', categoryId: '' });
    const [none] = normalizeAiExpenses([{ title: 'хлеб', amount: 5, category: '' }], { ...ctx, categories: [{ id: 'c2', name: 'Транспорт' }] });
    expect(none).toMatchObject({ categoryId: '' });
  });
  it('отбрасывает мусор и не падает на чужом ответе', () => {
    expect(normalizeAiExpenses('x', ctx)).toEqual([]);
    expect(normalizeAiExpenses([null, 5, { title: '', amount: 0 }, { title: 'ок', amount: -3 }, { title: 'нан', amount: NaN }], ctx).map((d) => [d.title, d.amountText])).toEqual([
      ['Ок', ''],
      ['Нан', ''],
    ]);
  });
});

describe('normalizeAiExpenses: доходы и переводы', () => {
  it('доход: категория берётся из категорий доходов, счёт — тот, на который пришли деньги', () => {
    const [a, b] = normalizeAiExpenses(
      [
        { kind: 'income', title: 'зарплата', amount: 5000, wallet: 'карта алиф', toWallet: '', category: 'Зарплата', fee: 0, date: '', note: '' },
        { kind: 'income', title: 'бонус', amount: 300, wallet: '', toWallet: '', category: 'Премии', fee: 0, date: '', note: '' },
      ],
      ctx,
    );
    expect(a).toMatchObject({ kind: 'income', title: 'Зарплата', amountText: '5000', walletId: 'w2', categoryId: 'i1', newCategory: '', toWalletId: '' });
    expect(b).toMatchObject({ kind: 'income', categoryId: '', newCategory: 'Премии' });
  });

  it('доход не берёт категорию расходов с тем же названием', () => {
    const [a] = normalizeAiExpenses([{ kind: 'income', title: 'возврат', amount: 100, wallet: '', category: 'Продукты', fee: 0, date: '', note: '' }], ctx);
    expect(a).toMatchObject({ categoryId: '', newCategory: 'Продукты' });
  });

  it('перевод: откуда и куда — свои счета, категории нет, комиссия на месте', () => {
    const [a] = normalizeAiExpenses(
      [{ kind: 'transfer', title: 'снял наличные', amount: 1000, wallet: 'карта алиф', toWallet: 'наличные', category: 'Транспорт', fee: 5, date: '2026-10-11', note: '' }],
      ctx,
    );
    expect(a).toMatchObject({ kind: 'transfer', walletId: 'w2', toWalletId: 'w1', categoryId: '', newCategory: '', feeText: '5', date: '2026-10-11', title: 'Снял наличные' });
  });

  it('перевод: «куда» совпало с «откуда» или не названо — оставляем пустым, а без названия строка зовётся «Перевод»', () => {
    const [a, b] = normalizeAiExpenses(
      [
        { kind: 'transfer', title: '', amount: 100, wallet: 'наличные', toWallet: 'наличные', category: '', fee: 0, date: '', note: '' },
        { kind: 'transfer', title: 'на карту', amount: 100, wallet: 'доллары', toWallet: 'такого нет', category: '', fee: 0, date: '', note: '' },
      ],
      ctx,
    );
    expect(a).toMatchObject({ kind: 'transfer', title: 'Перевод', walletId: 'w1', toWalletId: '' });
    expect(b).toMatchObject({ walletId: 'w3', toWalletId: '' });
  });

  it('вид, которого нет в списке, — расход; старый ответ без kind тоже расход', () => {
    const rows = normalizeAiExpenses(
      [
        { kind: 'долг', title: 'а', amount: 1, wallet: '', category: '', fee: 0, date: '', note: '' },
        { title: 'б', amount: 2, wallet: '', category: '', fee: 0, date: '', note: '' },
      ],
      ctx,
    );
    expect(rows.map((r) => [r.kind, r.toWalletId])).toEqual([['expense', ''], ['expense', '']]);
  });
});

describe('checkDraft: доход и перевод', () => {
  const base: DraftExpense = { rid: 1, kind: 'expense', toWalletId: '', title: 'x', amountText: '100', feeText: '2', walletId: 'w1', categoryId: '', newCategory: '', date: '2026-10-12', note: '', walletGuessed: false };

  it('доход: комиссия не учитывается, даже если осталась от прежнего вида строки', () => {
    expect(checkDraft({ ...base, kind: 'income' }, 'TJS')).toEqual({ totalMinor: 10_000, feeMinor: 0, error: null });
  });

  it('перевод: списано сумма + комиссия, получено сумма', () => {
    expect(checkDraft({ ...base, kind: 'transfer', toWalletId: 'w2' }, 'TJS', 'TJS')).toEqual({ totalMinor: 10_200, feeMinor: 200, receivedMinor: 10_000, error: null });
  });

  it('перевод: нужен другой счёт назначения, и валюты должны совпадать', () => {
    const t = { ...base, kind: 'transfer' as const };
    expect(checkDraft({ ...t, toWalletId: '' }, 'TJS').error).toMatch(/Выберите счёт, куда/);
    expect(checkDraft({ ...t, toWalletId: 'w1' }, 'TJS', 'TJS').error).toMatch(/должен отличаться/);
    expect(checkDraft({ ...t, toWalletId: 'w3' }, 'TJS', 'USD').error).toMatch(/разных валютах/);
  });
});

describe('checkDraft', () => {
  const d: DraftExpense = { rid: 1, kind: 'expense', toWalletId: '', title: 'x', amountText: '12,5', feeText: '1,5', walletId: 'w1', categoryId: '', newCategory: '', date: '2026-10-12', note: '', walletGuessed: false };
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
