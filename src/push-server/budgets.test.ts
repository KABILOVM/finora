// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PUSH_PAYLOAD_MAX_BYTES, buildPayload, createHandler, findBudgetAlerts, monthBounds, type BudgetItem, type LevelTx } from '../../supabase/functions/send-reminders/index';
import { CRON, FakeStore, USER_A, USER_B, captureConsole, deps, fakeSender, request, settings, sub } from './testkit';

/** Лимиты бюджета в функции send-reminders: когда шлём, что пишем, чего не пишем никогда (суммы). Хранилище — в памяти. */

captureConsole();
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе, 10 октября
const FOOD = '11111111-1111-4111-8111-111111111111';
const CAFE = '22222222-2222-4222-8222-222222222222'; // подкатегория «Еды»
const BUS = '33333333-3333-4333-8333-333333333333';
const B_ALL = 'b0000000-0000-4000-8000-000000000001';
const B_FOOD = 'b0000000-0000-4000-8000-000000000002';
const B_BUS = 'b0000000-0000-4000-8000-000000000003';
const DEBT = 'd0000000-0000-4000-8000-000000000001';

const spend = (date: string, amount: number, over: Partial<LevelTx> = {}): LevelTx & { date: string } => ({
  date,
  kind: 'expense',
  categoryId: FOOD,
  debtId: null,
  baseCurrency: 'TJS',
  baseAmountMinor: amount,
  ...over,
});

function setup(o: { now?: Date; budgetsOn?: boolean; details?: boolean } = {}) {
  const store = new FakeStore();
  store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindBudgets: o.budgetsOn ?? true, showDetails: o.details ?? false })];
  store.subs.set(USER_A, [sub('a-phone')]);
  store.baseCurrencies.set(USER_A, 'TJS');
  store.categories.set(USER_A, [
    { id: FOOD, parentId: null, name: 'Еда' },
    { id: CAFE, parentId: FOOD, name: 'Кафе' },
    { id: BUS, parentId: null, name: 'Транспорт' },
  ]);
  store.budgets.set(USER_A, [{ id: B_FOOD, categoryId: FOOD, amountMinor: 1000, currency: 'TJS' }]);
  const send = fakeSender();
  const clock = { now: o.now ?? NOW };
  const h = createHandler(deps({ store, send, now: () => clock.now }));
  const run = async () => json(await h(request('POST', { token: CRON, body: {} })));
  const setSpend = (...list: Array<LevelTx & { date: string }>) => store.monthSpend.set(USER_A, list);
  return { store, send, clock, run, setSpend };
}

/** В тексте нет ни одной суммы: все цифры — только процент. */
const onlyPercentDigits = (body: string) => expect(body.replace(/\d+%/g, '')).not.toMatch(/\d/);

describe('лимиты бюджета: что и когда присылается', () => {
  it('70% → «на исходе», ссылка на /budgets, одно сообщение; в тексте только процент, суммы и названия не пишутся', async () => {
    const { send, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 700));
    expect(await run()).toMatchObject({ users: 1, inWindow: 1, sent: 1, notified: 1 });
    expect(send.bodies()).toEqual([{ title: 'Sumoima', body: 'Лимит на исходе: потрачено 70%.', url: '/budgets', tag: 'finora-budgets' }]);
    expect(send.calls[0]!.body).not.toContain('Еда');
    onlyPercentDigits(send.bodies()[0]?.body ?? '');
  });

  it('до 70% — ничего; ровно 69% — ничего, 70% — есть', async () => {
    const a = setup();
    a.setSpend(spend('2026-10-03', 699));
    await a.run();
    expect(a.send.calls).toEqual([]);
    expect(a.store.log.size).toBe(0);
    const b = setup();
    b.setSpend(spend('2026-10-03', 700));
    await b.run();
    expect(b.send.calls).toHaveLength(1);
  });

  it('один и тот же уровень в течение месяца присылается один раз (повтор в тот же день и на следующий)', async () => {
    const { send, clock, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 750));
    await run();
    clock.now = new Date('2026-10-10T05:10:00Z'); // 10:10 — тоже в окне
    expect(await run()).toMatchObject({ inWindow: 1, sent: 0, skippedNothingToSend: 1 });
    clock.now = new Date('2026-10-11T04:10:00Z');
    setSpend(spend('2026-10-03', 750), spend('2026-10-10', 50)); // 80% — всё ещё warn
    expect(await run()).toMatchObject({ sent: 0 });
    expect(send.calls).toHaveLength(1);
  });

  it('уровень растёт: 70% → 90% → превышен — по одному сообщению на каждый новый уровень', async () => {
    const { send, clock, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 700));
    await run();
    clock.now = new Date('2026-10-11T04:10:00Z');
    setSpend(spend('2026-10-03', 920));
    await run();
    clock.now = new Date('2026-10-12T04:10:00Z');
    setSpend(spend('2026-10-03', 1120));
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит на исходе: потрачено 70%.', 'Лимит на исходе: потрачено 92%.', 'Лимит превышен: потрачено 112%.']);
  });

  it('прыжок сразу в «превышен» — одно сообщение; спад и новый рост до меньшего уровня уже ничего не присылают', async () => {
    const { send, clock, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 1500));
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит превышен: потрачено 150%.']);
    clock.now = new Date('2026-10-11T04:10:00Z');
    setSpend(spend('2026-10-03', 750)); // удалили лишнюю операцию: снова 75%
    await run();
    clock.now = new Date('2026-10-12T04:10:00Z');
    setSpend(spend('2026-10-03', 950)); // вырос до 95%, но «превышен» уже был
    await run();
    expect(send.calls).toHaveLength(1);
  });

  it('новый месяц — всё заново; траты прошлого месяца в новый не попадают', async () => {
    const { send, clock, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 1200));
    await run();
    clock.now = new Date('2026-11-02T04:10:00Z');
    setSpend(spend('2026-10-03', 1200)); // октябрьские траты
    expect(await run()).toMatchObject({ sent: 0 });
    setSpend(spend('2026-10-03', 1200), spend('2026-11-01', 800));
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит превышен: потрачено 120%.', 'Лимит на исходе: потрачено 80%.']);
  });

  it('месяц и «сегодня» — по поясу человека: 31 октября 20:30 UTC в Душанбе уже 1 ноября', async () => {
    const { send, store, setSpend, run, clock } = setup({ now: new Date('2026-10-31T20:30:00Z') });
    store.settings = [settings(USER_A, { hourLocal: 1, remindPayments: false, remindDebts: false, remindBudgets: true })];
    setSpend(spend('2026-10-31', 1200)); // октябрьская трата: в ноябре её нет
    expect(await run()).toMatchObject({ inWindow: 1, sent: 0 });
    setSpend(spend('2026-10-31', 1200), spend('2026-11-01', 900));
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит на исходе: потрачено 90%.']);
    expect(clock.now.toISOString()).toBe('2026-10-31T20:30:00.000Z');
  });

  it('лимит категории охватывает подкатегории; общий лимит — все расходы; чужая категория не считается', async () => {
    const { store, send, setSpend, run } = setup();
    store.budgets.set(USER_A, [
      { id: B_FOOD, categoryId: FOOD, amountMinor: 1000, currency: 'TJS' },
      { id: B_BUS, categoryId: BUS, amountMinor: 1000, currency: 'TJS' },
      { id: B_ALL, categoryId: null, amountMinor: 4000, currency: 'TJS' },
    ]);
    setSpend(spend('2026-10-03', 400, { categoryId: FOOD }), spend('2026-10-04', 400, { categoryId: CAFE }), spend('2026-10-05', 100, { categoryId: BUS }));
    await run();
    // еда = 800 (80%), транспорт = 10%, всего 900 из 4000 = 22%
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит на исходе: потрачено 80%.']);
  });

  it('не расход месяца: доходы, операции по долгам, другая валюта снимка; комиссия перевода — только в общий лимит', async () => {
    const { store, send, setSpend, run } = setup();
    store.budgets.set(USER_A, [
      { id: B_FOOD, categoryId: FOOD, amountMinor: 1000, currency: 'TJS' },
      { id: B_ALL, categoryId: null, amountMinor: 1000, currency: 'TJS' },
    ]);
    setSpend(
      spend('2026-10-03', 9000, { kind: 'income' }),
      spend('2026-10-03', 9000, { debtId: DEBT }),
      spend('2026-10-03', 9000, { baseCurrency: 'USD' }),
      spend('2026-10-03', 300, { kind: 'transfer', categoryId: null }), // комиссия 300 — только в общий
      spend('2026-10-04', 450),
    );
    await run();
    // общий: 450 + 300 = 750 (75%); еда: 450 (45%)
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимит на исходе: потрачено 75%.']);
  });

  it('лимит в другой валюте, чем основная, не проверяется; нет основной валюты — тоже', async () => {
    const a = setup();
    a.store.budgets.set(USER_A, [{ id: B_FOOD, categoryId: FOOD, amountMinor: 100, currency: 'USD' }]);
    a.setSpend(spend('2026-10-03', 5000));
    await a.run();
    expect(a.send.calls).toEqual([]);
    expect(a.store.calls.some((c) => c.startsWith('listMonthSpend'))).toBe(false);
    const b = setup();
    b.store.baseCurrencies.delete(USER_A);
    b.setSpend(spend('2026-10-03', 5000));
    await b.run();
    expect(b.send.calls).toEqual([]);
  });

  it('переключатель выключен — лимитов не касаемся вовсе; нет лимитов — читается только список лимитов', async () => {
    const off = setup({ budgetsOn: false });
    off.store.settings = [settings(USER_A, { remindPayments: true, remindDebts: false, remindBudgets: false })];
    off.setSpend(spend('2026-10-03', 5000));
    await off.run();
    expect(off.store.calls.filter((c) => /Budget|Spend|Categories|baseCurrency/.test(c))).toEqual([]);
    const none = setup();
    none.store.budgets.set(USER_A, []);
    await none.run();
    expect(none.store.calls.filter((c) => /Spend|Categories|baseCurrency|BudgetLog/.test(c))).toEqual([]);
    expect(none.send.calls).toEqual([]);
  });

  it('все выключено (платежи, долги, «внесите траты», лимиты) — человек пропускается без чтения данных', async () => {
    const { store, run } = setup({ budgetsOn: false });
    expect(await run()).toMatchObject({ skippedNothingToSend: 1, sent: 0 });
    expect(store.calls.filter((c) => /listBudgets|listMonthSpend/.test(c))).toEqual([]);
  });

  it('чужие данные: расходы и лимиты другого пользователя на этого не влияют', async () => {
    const { store, send, setSpend, run } = setup();
    setSpend(spend('2026-10-03', 100));
    store.monthSpend.set(USER_B, [spend('2026-10-03', 99_999)]);
    store.budgets.set(USER_B, [{ id: B_BUS, categoryId: FOOD, amountMinor: 10, currency: 'TJS' }]);
    await run();
    expect(send.calls).toEqual([]);
  });

  it('никто не принял сообщение — запись журнала снимается, следующий час повторит; принял — не повторяет', async () => {
    const { send, clock, setSpend, run, store } = setup();
    setSpend(spend('2026-10-03', 950));
    send.outcomes.set('a-phone', { outcome: 'failed', status: 500 });
    expect(await run()).toMatchObject({ failed: 1, sent: 0 });
    expect(store.log.size).toBe(0);
    send.outcomes.delete('a-phone');
    clock.now = new Date('2026-10-10T05:10:00Z');
    expect(await run()).toMatchObject({ sent: 1 });
    expect([...store.log]).toEqual([`${USER_A}|2026-10-10|budget|${B_FOOD}:danger`]);
  });

  it('сбой чтения расходов не мешает другим: ошибка считается, остальные люди обработаны', async () => {
    const { store, send, setSpend, run } = setup();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindBudgets: true }), settings(USER_B, { remindPayments: false, remindDebts: false, remindBudgets: true })];
    store.subs.set(USER_B, [sub('b-phone')]);
    store.baseCurrencies.set(USER_B, 'TJS');
    store.budgets.set(USER_B, [{ id: B_ALL, categoryId: null, amountMinor: 100, currency: 'TJS' }]);
    store.monthSpend.set(USER_B, [spend('2026-10-02', 100)]);
    setSpend(spend('2026-10-03', 900));
    store.failing.add(`listMonthSpend:${USER_A}`);
    expect(await run()).toMatchObject({ errors: 1, sent: 1 });
    expect(send.calls.map((c) => c.subId)).toEqual(['b-phone']);
  });
});

describe('лимиты вместе с другими напоминаниями и названия', () => {
  it('платёж и лимит — одно сообщение со ссылкой на «Главную» и общим tag', async () => {
    const { store, send, setSpend, run } = setup();
    store.settings = [settings(USER_A, { remindPayments: true, remindDebts: false, remindBudgets: true })];
    store.rules.set(USER_A, [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'Аренда', frequency: 'monthly', intervalN: 1, startOn: '2026-01-10', endOn: null }]);
    setSpend(spend('2026-10-03', 900));
    await run();
    expect(send.bodies()).toEqual([{ title: 'Sumoima', body: 'Сегодня 1 платёж. Лимит на исходе: потрачено 90%.', url: '/', tag: 'finora-reminder' }]);
  });

  it('show_details: название категории и «Все расходы» для общего; без show_details названий нет', async () => {
    const { store, send, setSpend, run } = setup({ details: true });
    store.budgets.set(USER_A, [
      { id: B_FOOD, categoryId: FOOD, amountMinor: 1000, currency: 'TJS' },
      { id: B_ALL, categoryId: null, amountMinor: 700, currency: 'TJS' },
    ]);
    setSpend(spend('2026-10-03', 350)); // еда 35% (нет), общий 50% (нет)
    await run();
    expect(send.calls).toEqual([]);
    setSpend(spend('2026-10-03', 720));
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Лимиты бюджета: превышено 1, на исходе 1 (Все расходы, Еда).']);
  });

  it('findBudgetAlerts: уже отправленный более высокий уровень этого месяца закрывает низкие; прошлый месяц не мешает', async () => {
    const { store, setSpend } = setup();
    setSpend(spend('2026-10-03', 950));
    store.log.add(`${USER_A}|2026-09-20|budget|${B_FOOD}:over`); // прошлый месяц
    expect((await findBudgetAlerts(store, USER_A, '2026-10-10')).map((a) => a.ref)).toEqual([`${B_FOOD}:danger`]);
    store.log.add(`${USER_A}|2026-10-05|budget|${B_FOOD}:danger`);
    expect(await findBudgetAlerts(store, USER_A, '2026-10-10')).toEqual([]);
    store.log.add(`${USER_A}|2026-10-05|budget|not-a-ref`); // мусор в журнале не ломает чтение
    expect(await findBudgetAlerts(store, USER_A, '2026-10-10')).toEqual([]);
  });

  it('monthBounds: границы месяца, декабрь → январь следующего года', () => {
    expect(monthBounds('2026-10-31')).toEqual(['2026-10-01', '2026-11-01']);
    expect(monthBounds('2026-12-15')).toEqual(['2026-12-01', '2027-01-01']);
    expect(monthBounds('2024-02-29')).toEqual(['2024-02-01', '2024-03-01']);
  });
});

describe('текст сообщения о лимитах (buildPayload)', () => {
  const item = (level: BudgetItem['level'], percent: number, name = 'Еда'): BudgetItem => ({ level, percent, name });
  const body = (budgets: BudgetItem[], showDetails = false) => buildPayload({ payments: [], debts: [], daily: false, budgets }, showDetails)?.body;

  it('один лимит: «на исходе» / «превышен», процент; названия только с show_details', () => {
    expect(body([item('warn', 70)])).toBe('Лимит на исходе: потрачено 70%.');
    expect(body([item('danger', 95)])).toBe('Лимит на исходе: потрачено 95%.');
    expect(body([item('over', 100)])).toBe('Лимит превышен: потрачено 100%.');
    expect(body([item('over', 123, 'Еда')], true)).toBe('Лимит «Еда» превышен: потрачено 123%.');
    expect(body([item('warn', 80, '  Кафе\n«мясо»  ')], true)).toBe('Лимит «Кафе «мясо»» на исходе: потрачено 80%.');
    expect(body([item('warn', 80, '')], true)).toBe('Лимит «Лимит» на исходе: потрачено 80%.');
  });

  it('несколько лимитов: сколько превышено и сколько на исходе; самые тяжёлые первыми в списке названий', () => {
    const list = [item('warn', 71, 'А'), item('over', 130, 'Б'), item('danger', 95, 'В'), item('over', 101, 'Г')];
    expect(body(list)).toBe('Лимиты бюджета: превышено 2, на исходе 2.');
    expect(body(list, true)).toBe('Лимиты бюджета: превышено 2, на исходе 2 (Б, Г, В и ещё 1).');
    expect(body([item('warn', 70), item('warn', 72, 'Б')])).toBe('Лимиты бюджета: на исходе 2.');
    expect(body([item('over', 100), item('over', 100, 'Б')])).toBe('Лимиты бюджета: превышено 2.');
  });

  it('огромный процент не растягивает текст; суммы не попадают никогда', () => {
    expect(body([item('over', 5_000_000)])).toBe('Лимит превышен: потрачено 999%.');
    for (const b of [[item('over', 1234)], [item('warn', 70, 'Б')]]) onlyPercentDigits(body(b, true) ?? '');
  });

  it('нет лимитов (или пусто) — нет и сообщения; платежи и лимиты вместе — общий tag', () => {
    expect(buildPayload({ payments: [], debts: [], daily: false, budgets: [] }, false)).toBeNull();
    expect(buildPayload({ payments: [], debts: [], daily: false }, false)).toBeNull();
    const both = buildPayload({ payments: [{ note: 'А', overdue: false }], debts: [], daily: true, budgets: [item('over', 101)] }, false);
    expect(both).toMatchObject({ url: '/', tag: 'finora-reminder' });
    expect(both?.body).toBe('Сегодня 1 платёж. Лимит превышен: потрачено 101%. Сегодня ещё нет записей. Внесите траты и доходы.');
  });

  it('очень много лимитов с длинными названиями укладываются в предел размера сообщения', () => {
    const many = Array.from({ length: 200 }, (_, i) => item(i % 2 ? 'over' : 'warn', 100 + i, 'Я'.repeat(80) + i));
    const p = buildPayload({ payments: [], debts: [], daily: false, budgets: many }, true);
    expect(p).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    expect(p!.body.length).toBeLessThanOrEqual(300);
  });
});

