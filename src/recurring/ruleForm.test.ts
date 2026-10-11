import { describe, expect, it } from 'vitest';
import type { RecurringRule } from '@/domain/types';
import type { ReceivedView } from '@/features/transactions/useTxFormController';
import {
  checkRuleForm,
  emptyRuleForm,
  formFromRule,
  historyNote,
  parseInterval,
  previewDates,
  ruleErrorField,
  ruleFormPatch,
  type RuleCheckContext,
  type RuleFormState,
} from './ruleForm';

const TODAY = '2026-10-11';
const W = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const tjs = { name: 'Нал', currency: 'TJS' };
const usd = { name: 'Доллары', currency: 'USD' };

const form = (over: Partial<RuleFormState> = {}): RuleFormState => ({ ...emptyRuleForm(W, TODAY), amountMinor: 5_000, ...over });
const ctx = (over: Partial<RuleCheckContext> = {}): RuleCheckContext => ({ wallet: tjs, toWallet: null, debt: undefined, received: null, ...over });

describe('parseInterval', () => {
  it('целое от 1 до 1000', () => {
    expect(parseInterval('1')).toBe(1);
    expect(parseInterval(' 12 ')).toBe(12);
    expect(parseInterval('1000')).toBe(1000);
    for (const bad of ['', '0', '1001', '-1', '1.5', '1,5', 'abc', '١٢', '00000', '１']) expect(parseInterval(bad)).toBeNull();
  });
});

describe('checkRuleForm', () => {
  it('верная форма превращается в данные для репозитория (расход)', () => {
    const r = checkRuleForm(form({ note: '  Аренда  ', categoryId: 'c1', autoPost: true, intervalText: '2' }), ctx());
    expect(r).toEqual({
      ok: true,
      input: {
        kind: 'expense',
        walletId: W,
        amountMinor: 5_000,
        note: 'Аренда',
        frequency: 'monthly',
        intervalN: 2,
        startOn: TODAY,
        endOn: null,
        autoPost: 1,
        toWalletId: null,
        toAmountMinor: null,
        categoryId: 'c1',
        debtId: null,
      },
    });
  });

  it('подсказки по полям: сумма, кошелёк, шаг, даты', () => {
    const r = checkRuleForm(form({ walletId: null, amountMinor: null, intervalText: '0', startOn: '' }), ctx({ wallet: undefined }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      wallet: 'Выберите кошелёк',
      amount: 'Введите сумму',
      interval: 'Введите целое число от 1 до 1000',
      startOn: 'Укажите дату',
    });
  });

  it('сумма ноль; заметка длиннее 500', () => {
    const r = checkRuleForm(form({ amountMinor: 0, note: 'я'.repeat(501) }), ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.amount).toBe('Сумма должна быть больше нуля');
    expect(r.errors.note).toMatch(/не длиннее 500/);
  });

  it('дата окончания: раньше начала — ошибка, равная начальной — можно', () => {
    const early = checkRuleForm(form({ hasEnd: true, endOn: '2026-10-10' }), ctx());
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors.endOn).toMatch(/раньше первого платежа/);
    const same = checkRuleForm(form({ hasEnd: true, endOn: TODAY }), ctx());
    expect(same.ok).toBe(true);
    const missing = checkRuleForm(form({ hasEnd: true, endOn: '' }), ctx());
    expect(missing.ok).toBe(false);
    // выключили «конец» — прежняя дата в форме ни на что не влияет
    const off = checkRuleForm(form({ hasEnd: false, endOn: '2000-01-01' }), ctx());
    expect(off.ok && off.input.endOn).toBeNull();
  });

  it('даты вне 2000…2100 и несуществующие', () => {
    for (const bad of ['1999-12-31', '2100-01-02', '2026-02-30']) {
      const r = checkRuleForm(form({ startOn: bad }), ctx());
      expect(r.ok).toBe(false);
    }
    expect(checkRuleForm(form({ startOn: '2000-01-01' }), ctx()).ok).toBe(true);
    expect(checkRuleForm(form({ startOn: '2100-01-01' }), ctx()).ok).toBe(true);
  });

  it('перевод: нужен второй кошелёк, разные кошельки, сумма зачисления', () => {
    const noTo = checkRuleForm(form({ kind: 'transfer', toWalletId: null }), ctx());
    expect(noTo.ok).toBe(false);
    if (!noTo.ok) expect(noTo.errors.toWallet).toBe('Выберите, куда переводить');
    const same = checkRuleForm(form({ kind: 'transfer', toWalletId: W }), ctx({ toWallet: tjs }));
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.toWallet).toMatch(/должны быть разными/);
  });

  it('перевод в одной валюте без комиссии: зачисление = списанию; между валютами — зачисление обязательно', () => {
    const fee: ReceivedView = { mode: 'fee', show: false, value: 5_000, suggested: 5_000, lookup: null, from: 'TJS', to: 'TJS' };
    const ok = checkRuleForm(form({ kind: 'transfer', toWalletId: W2 }), ctx({ toWallet: tjs, received: fee }));
    expect(ok.ok && ok.input).toMatchObject({ kind: 'transfer', toWalletId: W2, toAmountMinor: 5_000, categoryId: null, debtId: null });
    const cross: ReceivedView = { mode: 'cross', show: true, value: null, suggested: null, lookup: null, from: 'TJS', to: 'USD' };
    const bad = checkRuleForm(form({ kind: 'transfer', toWalletId: W2 }), ctx({ toWallet: usd, received: cross }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.toAmount).toBe('Курса нет — введите, сколько денег пришло');
  });

  it('платёж по долгу: валюта кошелька должна совпасть с валютой долга — подсказка ДО сохранения', () => {
    const debt = { counterparty: 'Иван', currency: 'USD' };
    const r = checkRuleForm(form({ debtId: 'd1' }), ctx({ debt }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.debt).toMatch(/Валюта кошелька «Нал» \(TJS\) не совпадает с валютой долга «Иван» \(USD\)/);
    const ok = checkRuleForm(form({ debtId: 'd1' }), ctx({ wallet: usd, debt }));
    expect(ok.ok && ok.input.debtId).toBe('d1');
    const gone = checkRuleForm(form({ debtId: 'd1' }), ctx({ debt: undefined }));
    expect(gone.ok).toBe(false);
  });

  it('у перевода долга и категории нет, даже если они остались в форме', () => {
    const rec: ReceivedView = { mode: 'fee', show: false, value: 5_000, suggested: 5_000, lookup: null, from: 'TJS', to: 'TJS' };
    const r = checkRuleForm(form({ kind: 'transfer', toWalletId: W2, categoryId: 'c1', debtId: 'd1' }), ctx({ toWallet: tjs, received: rec }));
    expect(r.ok && r.input).toMatchObject({ categoryId: null, debtId: null });
  });
});

describe('formFromRule / ruleFormPatch', () => {
  const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
    id: 'r1',
    createdAt: '2026-10-01T00:00:00.000Z',
    clientUpdatedAt: '2026-10-01T00:00:00.000Z',
    deviceId: 'd',
    deletedAt: null,
    kind: 'expense',
    walletId: W,
    toWalletId: null,
    amountMinor: 5_000,
    toAmountMinor: null,
    categoryId: 'c1',
    debtId: null,
    note: 'Аренда',
    frequency: 'monthly',
    intervalN: 1,
    startOn: '2026-10-05',
    endOn: null,
    autoPost: 0,
    archivedAt: null,
    ...over,
  });

  it('форма из правила и обратно: ничего не менял — патч пуст', () => {
    const r = rule({ endOn: '2027-01-01', autoPost: 1, intervalN: 3 });
    const f = formFromRule(r, () => 'TJS');
    expect(f).toMatchObject({ hasEnd: true, endOn: '2027-01-01', autoPost: true, intervalText: '3' });
    const c = checkRuleForm(f, ctx());
    expect(c.ok).toBe(true);
    if (c.ok) expect(ruleFormPatch(c.input, r)).toEqual({});
  });

  it('в патче только изменённое', () => {
    const r = rule();
    const f = { ...formFromRule(r, () => 'TJS'), amountMinor: 6_000, autoPost: true, note: 'Аренда квартиры' };
    const c = checkRuleForm(f, ctx());
    expect(c.ok && ruleFormPatch(c.input, r)).toEqual({ amountMinor: 6_000, autoPost: 1, note: 'Аренда квартиры' });
  });

  it('конец расписания убрали — в патче endOn: null; перевод всегда несёт сумму зачисления', () => {
    const r = rule({ endOn: '2027-01-01' });
    const c1 = checkRuleForm({ ...formFromRule(r, () => 'TJS'), hasEnd: false }, ctx());
    expect(c1.ok && ruleFormPatch(c1.input, r)).toEqual({ endOn: null });

    const t = rule({ kind: 'transfer', toWalletId: W2, toAmountMinor: 4_900, categoryId: null });
    const rec: ReceivedView = { mode: 'fee', show: true, value: 4_900, suggested: 5_000, lookup: null, from: 'TJS', to: 'TJS' };
    const c2 = checkRuleForm(formFromRule(t, () => 'TJS'), ctx({ toWallet: tjs, received: rec }));
    expect(c2.ok && ruleFormPatch(c2.input, t)).toEqual({ toAmountMinor: 4_900 });
  });

  it('комиссия у правила в одной валюте открывает поле «Получено» сама', () => {
    const t = rule({ kind: 'transfer', toWalletId: W2, toAmountMinor: 4_900, categoryId: null });
    expect(formFromRule(t, () => 'TJS').feeOpen).toBe(true);
    expect(formFromRule({ ...t, toAmountMinor: 5_000 }, () => 'TJS').feeOpen).toBe(false);
    expect(formFromRule(t, (id) => (id === W ? 'TJS' : 'USD')).feeOpen).toBe(false);
  });
});

describe('previewDates', () => {
  it('ближайшие 4 даты, считая с сегодняшнего дня', () => {
    expect(previewDates(form({ frequency: 'monthly', startOn: '2026-01-05' }), TODAY)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
  });

  it('начало в будущем — считаем от начала; сегодня — тоже входит', () => {
    expect(previewDates(form({ frequency: 'daily', startOn: '2026-10-20' }), TODAY, 2)).toEqual(['2026-10-20', '2026-10-21']);
    expect(previewDates(form({ frequency: 'daily', startOn: '2026-10-01' }), TODAY, 2)).toEqual([TODAY, '2026-10-12']);
  });

  it('конец расписания обрезает список; прошедшее расписание — пусто', () => {
    expect(previewDates(form({ frequency: 'daily', startOn: '2026-10-11', hasEnd: true, endOn: '2026-10-12' }), TODAY)).toEqual([TODAY, '2026-10-12']);
    expect(previewDates(form({ frequency: 'daily', startOn: '2026-01-01', hasEnd: true, endOn: '2026-02-01' }), TODAY)).toEqual([]);
  });

  it('31-е число: короткие месяцы — последний день', () => {
    expect(previewDates(form({ frequency: 'monthly', startOn: '2026-01-31' }), '2026-10-31', 4)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
    expect(previewDates(form({ frequency: 'monthly', startOn: '2026-01-31' }), '2027-01-31', 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('шаг и даты нечитаемы — пусто, а не падение', () => {
    expect(previewDates(form({ intervalText: '' }), TODAY)).toEqual([]);
    expect(previewDates(form({ startOn: 'abc' }), TODAY)).toEqual([]);
    expect(previewDates(form({ hasEnd: true, endOn: '2026-10-01' }), TODAY)).toEqual([]); // конец раньше начала
  });
});

describe('ruleErrorField: сообщение репозитория → поле', () => {
  it.each([
    ['Укажите сумму зачисления: у кошельков разные валюты', 'toAmount'],
    ['Перевод: укажите кошелёк зачисления', 'toWallet'],
    ['Кошелёк «Карта» в архиве: выберите другой или верните его из архива', 'wallet'],
    ['Кошелёк зачисления «Карта» в архиве: выберите другой', 'toWallet'],
    ['Сумма: должна быть больше нуля', 'amount'],
    ['Сумма слишком велика: допустимо не больше 1 000', 'amount'],
    ['Категория «Еда» удалена', 'category'],
    ['Категория «Зарплата» не подходит: она для доходов', 'category'],
    ['Долг «Иван» в архиве: верните его из архива или выберите другой', 'debt'],
    ['Валюта кошелька «Нал» (TJS) не совпадает с валютой долга «Иван» (USD)', 'debt'],
    ['Шаг повторения: допустимо от 1 до 1 000', 'interval'],
    ['Начало расписания: допустимы даты с 2000-01-01 по 2100-01-01', 'startOn'],
    ['Конец расписания не может быть раньше начала', 'endOn'],
    ['Заметка: не длиннее 500 символов', 'note'],
    ['что-то совсем другое', 'form'],
  ])('%s → %s', (message, field) => {
    expect(ruleErrorField(message)).toBe(field);
  });
});

describe('historyNote', () => {
  it('предупреждение только для «Проводить само» с началом в прошлом', () => {
    expect(historyNote({ autoPost: true, startOn: '2026-10-01' }, TODAY)).toMatch(/Просроченных/);
    expect(historyNote({ autoPost: true, startOn: TODAY }, TODAY)).toBeNull();
    expect(historyNote({ autoPost: true, startOn: '2026-12-01' }, TODAY)).toBeNull();
    expect(historyNote({ autoPost: false, startOn: '2026-10-01' }, TODAY)).toBeNull();
  });
});
