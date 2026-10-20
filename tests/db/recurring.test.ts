import { describe, expect, it } from 'vitest';
import { uuidV5, ValidationError, FxRequiredError } from '@/db';
import { basics, makeStore } from './helpers';

const rule = { kind: 'expense', amountMinor: 5_000, frequency: 'monthly', startOn: '2026-10-15' } as const;

describe('RecurringRepo.create', () => {
  it('создаёт правило с умолчаниями: шаг 1, без конца, без автопроведения', async () => {
    const store = await makeStore({ deviceId: 'device-r-1' });
    const { cash, food } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id, categoryId: food.id, note: 'Аренда' });
    expect(r).toMatchObject({
      kind: 'expense', walletId: cash.id, toWalletId: null, amountMinor: 5_000, toAmountMinor: null, categoryId: food.id, debtId: null, note: 'Аренда',
      frequency: 'monthly', intervalN: 1, startOn: '2026-10-15', endOn: null, autoPost: 0, archivedAt: null, deletedAt: null,
      dirty: 1, serverSeq: null, deviceId: 'device-r-1', dirtyGroups: [],
    });
    expect(await store.db.recurring_rules.get(r.id)).toEqual(r);
  });

  it('перевод: сумма зачисления выводится в одной валюте и обязательна между валютами', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const other = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const same = await store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 1_000, frequency: 'weekly', startOn: '2026-10-05' });
    expect(same.toAmountMinor).toBe(1_000);
    const fee = await store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 1_000, toAmountMinor: 990, frequency: 'weekly', startOn: '2026-10-05' });
    expect(fee.toAmountMinor).toBe(990);
    await expect(store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 1_000, frequency: 'weekly', startOn: '2026-10-05' })).rejects.toThrow(/Укажите сумму зачисления/);
    const exch = await store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 1_090, toAmountMinor: 100, frequency: 'weekly', startOn: '2026-10-05' });
    expect(exch.toAmountMinor).toBe(100);
    await expect(store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: other.id, amountMinor: 1_000, toAmountMinor: 1_001, frequency: 'weekly', startOn: '2026-10-05' })).rejects.toThrow(/не может быть больше/);
  });

  it.each([
    ['перевод на тот же кошелёк', (w: string) => ({ kind: 'transfer', walletId: w, toWalletId: w, toAmountMinor: 1 }), /отличаться/],
    ['перевод без кошелька зачисления', () => ({ kind: 'transfer' }), /кошелёк зачисления/],
    ['категория у перевода', (_w: string, c: string, o: string) => ({ kind: 'transfer', toWalletId: o, toAmountMinor: 1, categoryId: c }), /не бывает категории/],
    ['сумма 0', () => ({ amountMinor: 0 }), /больше нуля/],
    ['сумма больше 1e15', () => ({ amountMinor: 1_000_000_000_000_001 }), /слишком велика/],
    ['шаг 0', () => ({ intervalN: 0 }), /Шаг повторения/],
    ['шаг 1001', () => ({ intervalN: 1001 }), /Шаг повторения/],
    ['шаг дробный', () => ({ intervalN: 1.5 }), /Шаг повторения/],
    ['частота', () => ({ frequency: 'hourly' }), /Частота/],
    ['начало не дата', () => ({ startOn: '2026-02-30' }), /настоящая дата/],
    ['начало до 2000', () => ({ startOn: '1999-12-31' }), /допустимы даты/],
    ['конец раньше начала', () => ({ endOn: '2026-10-14' }), /раньше начала/],
    ['конец после 2100', () => ({ endOn: '2100-01-02' }), /допустимы даты/],
    ['автопроведение 2', () => ({ autoPost: 2 }), /Автопроведение/],
    ['автопроведение true', () => ({ autoPost: true }), /Автопроведение/],
    ['заметка 501', () => ({ note: 'я'.repeat(501) }), /Заметка/],
    ['лишнее поле', () => ({ dirty: 0 }), /менять нельзя/],
  ])('отвергает: %s', async (_n, mk, re) => {
    const store = await makeStore();
    const { cash, food, usd } = await basics(store);
    await expect(store.recurring.create({ ...rule, walletId: cash.id, ...(mk(cash.id, food.id, usd.id) as object) } as never)).rejects.toThrow(re);
    expect(await store.db.recurring_rules.count()).toBe(0);
  });

  it('кошелёк и категория: живые, категория подходит по виду, кошелёк не в архиве', async () => {
    const store = await makeStore();
    const { cash, food, salary } = await basics(store);
    await expect(store.recurring.create({ ...rule, walletId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' })).rejects.toThrow(/Кошелёк не найден/);
    await expect(store.recurring.create({ ...rule, walletId: cash.id, categoryId: salary.id })).rejects.toThrow(/не подходит/);
    await store.wallets.archive(cash.id);
    await expect(store.recurring.create({ ...rule, walletId: cash.id, categoryId: food.id })).rejects.toThrow(/в архиве/);
    expect(await store.db.recurring_rules.count()).toBe(0);
  });

  it('долг: жив, той же валюты; только для расхода/дохода', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const d = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    const ok = await store.recurring.create({ ...rule, walletId: cash.id, debtId: d.id });
    expect(ok.debtId).toBe(d.id);
    await expect(store.recurring.create({ ...rule, walletId: usd.id, debtId: d.id })).rejects.toThrow(/не совпадает с валютой долга/);
    await expect(store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, toAmountMinor: 1, amountMinor: 10, frequency: 'daily', startOn: '2026-10-01', debtId: d.id })).rejects.toThrow(/не бывает долга/);
    await expect(store.recurring.create({ ...rule, walletId: cash.id, debtId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' })).rejects.toThrow(/Долг не найден/);
  });

  it('явный id: повтор — ошибка', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await store.recurring.create({ ...rule, walletId: cash.id }, { id: 'rule-1' });
    await expect(store.recurring.create({ ...rule, walletId: cash.id }, { id: 'rule-1' })).rejects.toThrow(/уже существует/);
  });
});

describe('RecurringRepo.update / archive / restore', () => {
  it('update по группам; пустая правка не пишет; смена вида сбрасывает лишнее', async () => {
    const store = await makeStore();
    const { cash, food, salary } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id, categoryId: food.id });
    expect((await store.recurring.update(r.id, { amountMinor: 5_000 })).clientUpdatedAt).toBe(r.clientUpdatedAt);
    const u = await store.recurring.update(r.id, { amountMinor: 6_000, intervalN: 2, autoPost: 1, note: 'x' });
    expect(u).toMatchObject({ amountMinor: 6_000, intervalN: 2, autoPost: 1, note: 'x' });
    expect(u.dirtyGroups).toEqual(['money', 'schedule', 'mode', 'note']);
    const inc = await store.recurring.update(r.id, { kind: 'income', categoryId: salary.id });
    expect(inc).toMatchObject({ kind: 'income', categoryId: salary.id });
    await expect(store.recurring.update(r.id, { categoryId: food.id })).rejects.toThrow(/не подходит/);
    await expect(store.recurring.update(r.id, { startOn: '2026-10-20', endOn: '2026-10-10' })).rejects.toThrow(/раньше начала/);
    await expect(store.recurring.update('нет', { note: 'x' })).rejects.toThrow(/не найден/);
  });

  it('архив: правило перестаёт создавать операции, возврат из архива работает; повтор безопасен', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const a = await store.recurring.archive(r.id);
    expect(a.archivedAt).not.toBeNull();
    expect((await store.recurring.archive(r.id)).clientUpdatedAt).toBe(a.clientUpdatedAt);
    await expect(store.transactions.createFromRule(r.id, '2026-10-15')).rejects.toThrow(/в архиве/);
    const b = await store.recurring.restore(r.id);
    expect(b.archivedAt).toBeNull();
    expect((await store.transactions.createFromRule(r.id, '2026-10-15')).recurringRuleId).toBe(r.id);
  });

  it('архивное правило можно править, пока кошелёк не меняют; архив кошелька не мешает архивации правила', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await store.wallets.archive(cash.id);
    expect((await store.recurring.update(r.id, { note: 'после архива кошелька' })).note).toBe('после архива кошелька');
    expect((await store.recurring.archive(r.id)).archivedAt).not.toBeNull();
  });

  it('валюту кошелька с регулярным платежом менять нельзя', async () => {
    const store = await makeStore();
    const w = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await store.settings.ensure({ baseCurrency: 'TJS' });
    await store.recurring.create({ ...rule, walletId: w.id });
    await expect(store.wallets.update(w.id, { currency: 'USD' })).rejects.toThrow(/Нельзя менять валюту/);
  });
});

describe('TransactionsRepo.createFromRule', () => {
  it('id = v5(правило, дата); поля из правила; recurringRuleId проставлен', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id, categoryId: food.id, note: 'Аренда' });
    const t = await store.transactions.createFromRule(r, '2026-11-15');
    expect(t.id).toBe(await uuidV5(r.id, '2026-11-15'));
    expect(t).toMatchObject({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, categoryId: food.id, occurredOn: '2026-11-15', note: 'Аренда', recurringRuleId: r.id, debtId: null, baseAmountMinor: 5_000, fxSource: 'same', deletedAt: null, dirty: 1 });
    // допускается и id строкой
    const t2 = await store.transactions.createFromRule(r.id, '2026-12-15');
    expect(t2.id).toBe(await uuidV5(r.id, '2026-12-15'));
  });

  it('идемпотентность: повторный и параллельный вызовы дают одну операцию', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const [a, b] = await Promise.all([store.transactions.createFromRule(r, '2026-10-15'), store.transactions.createFromRule(r, '2026-10-15')]);
    const c = await store.transactions.createFromRule(r, '2026-10-15');
    expect(await store.db.transactions.count()).toBe(1);
    expect(a.id).toBe(b.id);
    expect(c.clientUpdatedAt).toBe(a.clientUpdatedAt);
  });

  it('повтор возвращает существующую операцию как есть — и после правки, и после удаления (удалённую не воскрешает)', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const t = await store.transactions.createFromRule(r, '2026-10-15');
    await store.transactions.update(t.id, { amountMinor: 7_777 });
    expect((await store.transactions.createFromRule(r, '2026-10-15')).amountMinor).toBe(7_777);
    await store.transactions.softDelete(t.id);
    const again = await store.transactions.createFromRule(r, '2026-10-15');
    expect(again.deletedAt).not.toBeNull();
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('дата вне расписания — ошибка, ничего не пишется', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id, endOn: '2027-03-15' });
    for (const bad of ['2026-10-16', '2026-09-15', '2027-04-15']) {
      await expect(store.transactions.createFromRule(r, bad)).rejects.toThrow(/не входит в расписание/);
    }
    await expect(store.transactions.createFromRule(r, '2026-02-30')).rejects.toThrow(/настоящая дата/);
    await expect(store.transactions.createFromRule(r, 'завтра' as never)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('зажим месяца: правило с 31 числом проводится 28 февраля, а не 31 (его нет)', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id, startOn: '2026-01-31' });
    await expect(store.transactions.createFromRule(r, '2026-02-27')).rejects.toThrow(/не входит в расписание/);
    expect((await store.transactions.createFromRule(r, '2026-02-28')).occurredOn).toBe('2026-02-28');
    expect((await store.transactions.createFromRule(r, '2026-03-31')).occurredOn).toBe('2026-03-31');
  });

  it('несуществующее, удалённое правило и мусорный id — ошибки', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await expect(store.transactions.createFromRule('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', '2026-10-15')).rejects.toThrow(/не найден/);
    await expect(store.transactions.createFromRule('не-uuid', '2026-10-15')).rejects.toThrow(/UUID/);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await store.db.recurring_rules.put({ ...r, deletedAt: '2026-10-10T00:00:00.000Z' });
    await expect(store.transactions.createFromRule(r, '2026-10-15')).rejects.toThrow(/удалён/);
  });

  it('подтверждение с другой суммой/заметкой; у перевода сумма зачисления считается заново', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const w2 = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const r = await store.recurring.create({ ...rule, walletId: cash.id, note: 'свет' });
    const t = await store.transactions.createFromRule(r, '2026-10-15', { amountMinor: 6_200, note: 'свет (больше обычного)' });
    expect(t).toMatchObject({ amountMinor: 6_200, note: 'свет (больше обычного)', baseAmountMinor: 6_200 });
    const tr = await store.recurring.create({ kind: 'transfer', walletId: cash.id, toWalletId: w2.id, amountMinor: 1_000, toAmountMinor: 990, frequency: 'weekly', startOn: '2026-10-05' });
    const t1 = await store.transactions.createFromRule(tr, '2026-10-05');
    expect(t1).toMatchObject({ amountMinor: 1_000, toAmountMinor: 990, baseAmountMinor: 10 });
    const t2 = await store.transactions.createFromRule(tr, '2026-10-12', { amountMinor: 2_000 });
    expect(t2).toMatchObject({ amountMinor: 2_000, toAmountMinor: 2_000, baseAmountMinor: 0 });
    await expect(store.transactions.createFromRule(r, '2026-11-15', { currency: 'USD' } as never)).rejects.toThrow(/менять нельзя/);
  });

  it('кошелёк в небазовой валюте: нужен курс (FxRequiredError), с курсом — снимок как у обычной операции', async () => {
    const store = await makeStore();
    const { usd } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: usd.id, amountMinor: 1_000 });
    await expect(store.transactions.createFromRule(r, '2026-10-15')).rejects.toBeInstanceOf(FxRequiredError);
    const t = await store.transactions.createFromRule(r, '2026-10-15', { fx: { rate: 11, source: 'manual' } });
    expect(t).toMatchObject({ amountMinor: 1_000, baseAmountMinor: 11_000, fxRate: 11, fxSource: 'manual' });
  });

  it('платёж по долгу: debtId переносится из правила', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const d = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-10-01' });
    const r = await store.recurring.create({ ...rule, walletId: cash.id, debtId: d.id, amountMinor: 30_000 });
    expect((await store.transactions.createFromRule(r, '2026-10-15')).debtId).toBe(d.id);
  });

  it('кошелёк правила в архиве/удалён: операция не создаётся, ошибка по-русски', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await store.wallets.archive(cash.id);
    await expect(store.transactions.createFromRule(r, '2026-10-15')).rejects.toThrow(/в архиве/);
  });
});

describe('TransactionsRepo.createFromRule: фактическая дата оплаты (occurredOn)', () => {
  it('операция записывается на дату оплаты, а id остаётся от даты по расписанию: тот же платёж не проведут дважды', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id }); // 15-го каждого месяца
    const t = await store.transactions.createFromRule(r.id, '2026-11-15', { occurredOn: '2026-11-18' });
    expect(t.occurredOn).toBe('2026-11-18');
    expect(t.id).toBe(await uuidV5(r.id, '2026-11-15'));
    expect(t.recurringRuleId).toBe(r.id);
    // повтор — по любой из двух дат ничего не пишет и возвращает ту же строку
    expect((await store.transactions.createFromRule(r.id, '2026-11-15')).id).toBe(t.id);
    expect((await store.transactions.createFromRule(r.id, '2026-11-15', { occurredOn: '2026-11-20' })).occurredOn).toBe('2026-11-18');
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('дата оплаты может быть в другом месяце, чем дата по расписанию', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const t = await store.transactions.createFromRule(r.id, '2026-10-15', { occurredOn: '2026-11-02' });
    expect(t.occurredOn).toBe('2026-11-02');
  });

  it('дата по расписанию по-прежнему должна входить в расписание; мусорная дата оплаты — ошибка, ничего не пишется', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await expect(store.transactions.createFromRule(r.id, '2026-11-16', { occurredOn: '2026-11-18' })).rejects.toThrow(/не входит в расписание/);
    await expect(store.transactions.createFromRule(r.id, '2026-11-15', { occurredOn: '2026-13-45' })).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('без occurredOn всё как раньше: операция на дату по расписанию', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    expect((await store.transactions.createFromRule(r.id, '2026-11-15')).occurredOn).toBe('2026-11-15');
  });
});

describe('TransactionsRepo.skipOccurrence', () => {
  it('создаёт операцию с тем же id сразу удалённой; createFromRule потом возвращает её же и не воскрешает', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const sk = await store.transactions.skipOccurrence(r, '2026-10-15');
    expect(sk.id).toBe(await uuidV5(r.id, '2026-10-15'));
    expect(sk.deletedAt).not.toBeNull();
    expect(sk).toMatchObject({ dirty: 1, recurringRuleId: r.id, amountMinor: 5_000 });
    expect(sk.deletedAt).toBe(sk.clientUpdatedAt);
    expect((await store.transactions.createFromRule(r, '2026-10-15')).deletedAt).not.toBeNull();
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('пропущенный платёж не влияет на остаток и итоги', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await store.transactions.skipOccurrence(r, '2026-10-15');
    const { computeBalances } = await import('@/domain/balances');
    expect(computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id)).toBe(100_000);
  });

  it('повтор безопасен; уже проведённый платёж пропустить нельзя', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const a = await store.transactions.skipOccurrence(r, '2026-10-15');
    const b = await store.transactions.skipOccurrence(r, '2026-10-15');
    expect(b.clientUpdatedAt).toBe(a.clientUpdatedAt);
    await store.transactions.createFromRule(r, '2026-11-15');
    await expect(store.transactions.skipOccurrence(r, '2026-11-15')).rejects.toThrow(/уже проведён/);
  });

  it('дата вне расписания — ошибка; кошелёк в небазовой валюте требует курс; «вернуть» пропуск можно через restore', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    await expect(store.transactions.skipOccurrence(r, '2026-10-16')).rejects.toThrow(/не входит в расписание/);
    const ru = await store.recurring.create({ ...rule, walletId: usd.id, amountMinor: 100 });
    await expect(store.transactions.skipOccurrence(ru, '2026-10-15')).rejects.toBeInstanceOf(FxRequiredError);
    expect((await store.transactions.skipOccurrence(ru, '2026-10-15', { fx: { rate: 10, source: 'manual' } })).deletedAt).not.toBeNull();
    const sk = await store.transactions.skipOccurrence(r, '2026-10-15');
    const back = await store.transactions.restore(sk.id);
    expect(back.deletedAt).toBeNull();
  });
});

describe('TransactionsRepo.create с recurringRuleId', () => {
  it('id выводится сам; чужой id — ошибка; правка не может сменить правило', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const r = await store.recurring.create({ ...rule, walletId: cash.id });
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-15', recurringRuleId: r.id });
    expect(t.id).toBe(await uuidV5(r.id, '2026-10-15'));
    const dup = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-15', recurringRuleId: r.id });
    expect(dup.id).toBe(t.id);
    expect(await store.db.transactions.count()).toBe(1);
    await expect(store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-11-15', recurringRuleId: r.id }, { id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' })).rejects.toThrow(/выведен из регулярного платежа и даты/);
    await expect(store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-11-16', recurringRuleId: r.id })).rejects.toThrow(/не входит в расписание/);
    await expect(store.transactions.update(t.id, { recurringRuleId: null })).rejects.toThrow(/менять нельзя/);
    // дату проведённой операции править можно: id остаётся прежним, «слот» занят
    const moved = await store.transactions.update(t.id, { occurredOn: '2026-10-17' });
    expect(moved.id).toBe(t.id);
    expect((await store.transactions.createFromRule(r, '2026-10-15')).occurredOn).toBe('2026-10-17');
  });
});
