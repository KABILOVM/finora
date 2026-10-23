import { describe, expect, it } from 'vitest';
import type { FxView, ReceivedView } from '@/features/transactions/useTxFormController';
import type { RateLookup } from '@/rates/types';
import { initialPostForm, noteWithReason, postErrorField, postNeedsFx, preparePost, reasonRequired, type PostFormState } from './postForm';
import { buildReceivedView, receivedAmount } from './received';

const rule = (over: Record<string, unknown> = {}) => ({
  kind: 'expense' as const,
  amountMinor: 5_000,
  toAmountMinor: null as number | null,
  note: 'Аренда',
  debtId: null as string | null,
  ...over,
});
const none: FxView = { kind: 'none' };
const base = (over: Partial<PostFormState> = {}): PostFormState => ({ amountMinor: 5_000, receivedOverride: undefined, feeOpen: false, note: 'Аренда', reason: '', rateText: '', ...over });
const tjs = { currency: 'TJS' };
const usd = { currency: 'USD' };
const lookup = (over: Partial<RateLookup> = {}): RateLookup => ({ rate: 10.9, source: 'nbt', asOf: '2026-10-10', stale: false, manual: false, ...over });

const args = (over: Record<string, unknown> = {}) => ({
  rule: rule(),
  form: base(),
  wallet: tjs,
  toWallet: null,
  base: 'TJS',
  received: null as ReceivedView | null,
  fx: none,
  ...over,
});

describe('preparePost: что уходит в createFromRule', () => {
  it('ничего не менял — параметров нет: платёж ровно такой, как в правиле', () => {
    expect(preparePost(args())).toEqual({ ok: true, opts: {} });
  });

  it('изменили сумму и заметку — уходят только они (заметка обрезается по краям)', () => {
    const r = preparePost(args({ form: base({ amountMinor: 6_500, note: '  Аренда за октябрь ' }) }));
    expect(r).toEqual({ ok: true, opts: { amountMinor: 6_500, note: 'Аренда за октябрь' } });
  });

  it('заметку очистили — уходит пустая заметка (это правка, а не «не трогал»)', () => {
    expect(preparePost(args({ form: base({ note: '' }) }))).toEqual({ ok: true, opts: { note: '' } });
  });

  it('сумма: пусто, ноль, длинная заметка', () => {
    const a = preparePost(args({ form: base({ amountMinor: null }) }));
    expect(a).toEqual({ ok: false, errors: { amount: 'Введите сумму' } });
    const b = preparePost(args({ form: base({ amountMinor: 0 }) }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.amount).toBe('Сумма должна быть больше нуля');
    const c = preparePost(args({ form: base({ note: 'я'.repeat(501) }) }));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errors.note).toMatch(/не длиннее 500/);
  });

  it('кошелёк в чужой валюте, курс найден: он уходит в операцию', () => {
    const fx: FxView = { kind: 'rate', lookup: lookup(), from: 'USD', to: 'TJS' };
    expect(preparePost(args({ wallet: usd, fx }))).toEqual({ ok: true, opts: { fx: { rate: 10.9, source: 'nbt' } } });
  });

  it('курса нет и поле пустое — не молчим: ошибка у поля «Курс», ничего не записываем', () => {
    const fx: FxView = { kind: 'missing', from: 'USD', to: 'TJS' };
    const r = preparePost(args({ wallet: usd, fx }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rate).toMatch(/Курса пока нет/);
  });

  it('курс набран руками — уходит как «manual» и просит запомнить', () => {
    const fx: FxView = { kind: 'missing', from: 'USD', to: 'TJS' };
    const r = preparePost(args({ wallet: usd, fx, form: base({ rateText: '10,9' }) }));
    expect(r).toEqual({ ok: true, opts: { fx: { rate: 10.9, source: 'manual' } }, typedRate: { from: 'USD', to: 'TJS', rate: 10.9 } });
  });

  it('перевод между валютами: сумму зачисления нельзя оставить пустой; введённая уходит вместе с суммой', () => {
    const tr = rule({ kind: 'transfer', amountMinor: 10_900, toAmountMinor: 1_000 });
    const view = (value: number | null): ReceivedView => ({ mode: 'cross', show: true, value, suggested: null, lookup: null, from: 'TJS', to: 'USD' });
    const bad = preparePost(args({ rule: tr, form: base({ amountMinor: 10_900 }), received: view(null) }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.toAmount).toBe('Курса нет — введите, сколько денег пришло');
    // сумма не менялась и «Получено» как в правиле — параметров нет
    expect(preparePost(args({ rule: tr, form: base({ amountMinor: 10_900 }), received: view(1_000) }))).toEqual({ ok: true, opts: {} });
    // сумма изменилась — «Получено» уходит явно (иначе репозиторий не знает, сколько зачислить)
    expect(preparePost(args({ rule: tr, form: base({ amountMinor: 21_800 }), received: view(2_000) }))).toEqual({
      ok: true,
      opts: { amountMinor: 21_800, toAmountMinor: 2_000 },
    });
  });

  it('перевод в одной валюте: комиссия не больше суммы, «Получено» > 0', () => {
    const tr = rule({ kind: 'transfer', amountMinor: 1_000, toAmountMinor: 990 });
    const fee = (value: number | null): ReceivedView => ({ mode: 'fee', show: true, value, suggested: 1_000, lookup: null, from: 'TJS', to: 'TJS' });
    const over = preparePost(args({ rule: tr, form: base({ amountMinor: 1_000 }), received: fee(1_001) }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.toAmount).toMatch(/не может быть больше списанного/);
    const zero = preparePost(args({ rule: tr, form: base({ amountMinor: 1_000 }), received: fee(0) }));
    expect(zero.ok).toBe(false);
  });
});

describe('initialPostForm / postNeedsFx / postErrorField', () => {
  it('форма из правила; у перевода с комиссией в одной валюте поле «Получено» открыто', () => {
    expect(initialPostForm(rule(), 'TJS', undefined)).toEqual(base());
    const tr = rule({ kind: 'transfer', amountMinor: 1_000, toAmountMinor: 990 });
    expect(initialPostForm(tr, 'TJS', 'TJS')).toMatchObject({ receivedOverride: 990, feeOpen: true });
    expect(initialPostForm(tr, 'TJS', 'USD')).toMatchObject({ receivedOverride: 990, feeOpen: false });
    expect(initialPostForm({ ...tr, toAmountMinor: 1_000 }, 'TJS', 'TJS').feeOpen).toBe(false);
  });

  it('курс нужен по ТЕКУЩИМ суммам формы: комиссию добавили — курс понадобился', () => {
    const tr = { kind: 'transfer' as const };
    expect(postNeedsFx(tr, { amountMinor: 1_000 }, 1_000, usd, usd, 'TJS')).toBe(false);
    expect(postNeedsFx(tr, { amountMinor: 1_000 }, 990, usd, usd, 'TJS')).toBe(true);
    expect(postNeedsFx({ kind: 'expense' }, { amountMinor: 1_000 }, null, usd, null, 'TJS')).toBe(true);
    expect(postNeedsFx({ kind: 'expense' }, { amountMinor: null }, null, tjs, null, 'TJS')).toBe(false);
  });

  it('сообщения репозитория раскладываются по полям окна; неясное — к форме целиком', () => {
    expect(postErrorField('Сумма слишком велика для пересчёта в базовую валюту', false)).toBe('amount');
    expect(postErrorField('Нужен курс USD → TJS: валюта кошелька отличается от базовой', false)).toBe('rate');
    expect(postErrorField('Заметка: не длиннее 500 символов', false)).toBe('note');
    expect(postErrorField('Укажите сумму зачисления: у кошельков разные валюты', true)).toBe('toAmount');
    expect(postErrorField('Укажите сумму зачисления: у кошельков разные валюты', false)).toBe('form');
    expect(postErrorField('Кошелёк «Нал» в архиве: выберите другой', false)).toBe('form');
    expect(postErrorField('Регулярный платёж в архиве: верните его из архива', true)).toBe('form');
  });
});

describe('buildReceivedView / receivedAmount', () => {
  const get = (_a: string, _b: string): RateLookup | null => lookup({ rate: 0.0917 });

  it('не перевод или нет кошелька — поля нет', () => {
    expect(buildReceivedView({ kind: 'expense', wallet: tjs, toWallet: null, amountMinor: 1, override: undefined, feeOpen: false, getRate: get })).toBeNull();
    expect(buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: undefined, amountMinor: 1, override: undefined, feeOpen: false, getRate: get })).toBeNull();
  });

  it('одна валюта: по умолчанию = сумме списания, поле скрыто; комиссия открывает поле', () => {
    const v = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: tjs, amountMinor: 1_000, override: undefined, feeOpen: false, getRate: get });
    expect(v).toMatchObject({ mode: 'fee', show: false, value: 1_000, suggested: 1_000 });
    expect(receivedAmount(v, 1_000)).toEqual({ toAmount: 1_000, error: null });
    const open = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: tjs, amountMinor: 1_000, override: 950, feeOpen: true, getRate: get });
    expect(receivedAmount(open, 1_000)).toEqual({ toAmount: 950, error: null });
  });

  it('разные валюты: предложение по курсу, правка руками, нет курса — ввод обязателен', () => {
    const v = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: usd, amountMinor: 10_900, override: undefined, feeOpen: false, getRate: () => lookup({ rate: 1 / 10.9 }) });
    expect(v).toMatchObject({ mode: 'cross', show: true, value: 1_000, suggested: 1_000 });
    const typed = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: usd, amountMinor: 10_900, override: 990, feeOpen: false, getRate: () => lookup({ rate: 1 / 10.9 }) });
    expect(typed?.value).toBe(990);
    const noRate = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: usd, amountMinor: 10_900, override: undefined, feeOpen: false, getRate: () => null });
    expect(receivedAmount(noRate, 10_900).error).toBe('Курса нет — введите, сколько денег пришло');
    expect(receivedAmount(noRate, 10_900).toAmount).toBeNull();
  });

  it('сумма не помещается в пересчёт — предложения нет, человек вводит сам', () => {
    const v = buildReceivedView({ kind: 'transfer', wallet: tjs, toWallet: usd, amountMinor: Number.MAX_SAFE_INTEGER, override: undefined, feeOpen: false, getRate: () => lookup({ rate: 1e9 }) });
    expect(v?.suggested).toBeNull();
  });

  it('receivedAmount: не перевод — ничего и без ошибки', () => {
    expect(receivedAmount(null, 1_000)).toEqual({ toAmount: null, error: null });
  });
});

describe('доход: причина, если сумма изменилась', () => {
  const salary = (over: Record<string, unknown> = {}) => rule({ kind: 'income', amountMinor: 500_000, note: 'Зарплата', ...over });
  const form = (over: Partial<PostFormState> = {}) => base({ amountMinor: 500_000, note: 'Зарплата', ...over });

  it('reasonRequired: только доход, не по долгу, с другой положительной суммой', () => {
    expect(reasonRequired(salary(), 450_000)).toBe(true);
    expect(reasonRequired(salary(), 500_000)).toBe(false);
    expect(reasonRequired(salary(), null)).toBe(false);
    expect(reasonRequired(salary(), 0)).toBe(false);
    expect(reasonRequired(salary({ debtId: 'd1' }), 450_000)).toBe(false);
    expect(reasonRequired(rule({ amountMinor: 5_000 }), 6_000)).toBe(false);
    expect(reasonRequired(rule({ kind: 'transfer' }), 6_000)).toBe(false);
  });

  it('noteWithReason: «Заметка (причина)»; заметки нет — одна причина', () => {
    expect(noteWithReason('Зарплата', ' премия ')).toBe('Зарплата (премия)');
    expect(noteWithReason('  ', 'премия')).toBe('премия');
  });

  it('сумма та же — причина не нужна и в заметку не попадает, даже если её набрали', () => {
    expect(preparePost(args({ rule: salary(), form: form({ reason: 'премия' }) }))).toEqual({ ok: true, opts: {} });
  });

  it('сумма другая, причины нет — ошибка у поля причины, ничего не записывается', () => {
    const r = preparePost(args({ rule: salary(), form: form({ amountMinor: 550_000 }) }));
    expect(r).toEqual({ ok: false, errors: { reason: 'Укажите причину, почему сумма изменилась' } });
    const blank = preparePost(args({ rule: salary(), form: form({ amountMinor: 550_000, reason: '   ' }) }));
    expect(blank.ok).toBe(false);
  });

  it('сумма другая, причина указана — уходят сумма и заметка «Зарплата (премия)»', () => {
    const r = preparePost(args({ rule: salary(), form: form({ amountMinor: 550_000, reason: ' премия ' }) }));
    expect(r).toEqual({ ok: true, opts: { amountMinor: 550_000, note: 'Зарплата (премия)' } });
  });

  it('заметку поправили руками — причина добавляется к новой заметке', () => {
    const r = preparePost(args({ rule: salary(), form: form({ amountMinor: 450_000, note: 'Зарплата за октябрь', reason: 'вычет' }) }));
    expect(r).toEqual({ ok: true, opts: { amountMinor: 450_000, note: 'Зарплата за октябрь (вычет)' } });
  });

  it('заметка стёрта — в заметку идёт одна причина', () => {
    const r = preparePost(args({ rule: salary(), form: form({ amountMinor: 450_000, note: '', reason: 'больничный' }) }));
    expect(r).toEqual({ ok: true, opts: { amountMinor: 450_000, note: 'больничный' } });
  });

  it('заметка вместе с причиной не помещается — ошибка у причины, а не молчаливая обрезка', () => {
    const r = preparePost(args({ rule: salary({ note: 'я'.repeat(495) }), form: form({ amountMinor: 450_000, note: 'я'.repeat(495), reason: 'премия' }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reason).toMatch(/не длиннее 500/);
  });

  it('расход с другой суммой причину не требует', () => {
    expect(preparePost(args({ form: base({ amountMinor: 6_500 }) }))).toEqual({ ok: true, opts: { amountMinor: 6_500 } });
  });

  it('initialPostForm: причина пуста', () => {
    expect(initialPostForm(salary(), 'TJS', undefined).reason).toBe('');
  });
});
