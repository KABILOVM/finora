import { describe, expect, it, vi } from 'vitest';
import { uuidV5, type RecurringInput, type Store } from '@/db';
import type { LocalRow, RecurringRule } from '@/domain/types';
import type { RateLookup } from '@/rates/types';
import { basics, makeStore } from '../../tests/db/helpers';
import { runAutoPost, type RunAutoPostOptions } from './autoPost';

const TODAY = '2026-10-11';
/** Местная дата создания = календарная часть метки: результат не зависит от часового пояса машины. */
const toLocal = (iso: string) => iso.slice(0, 10);
const LONG_AGO = '2026-01-01T00:00:00.000Z';

const fresh = (rate = 10.9, over: Partial<RateLookup> = {}): RateLookup => ({ rate, source: 'nbt', asOf: '2026-10-10', stale: false, manual: false, ...over });
const noRates = () => null;

type Setup = Awaited<ReturnType<typeof basics>> & { store: Store };

async function setup(): Promise<Setup> {
  const store = await makeStore();
  const b = await basics(store);
  return { store, ...b };
}

/** Платёж «Проводить само», созданный давно (чтобы «историю» отсекали только окно в 60 дней и начало расписания). */
async function mkRule(
  store: Store,
  input: Partial<RecurringInput> & Pick<RecurringInput, 'walletId'>,
  createdAt: string | null = LONG_AGO,
): Promise<LocalRow<RecurringRule>> {
  const rule = await store.recurring.create({
    kind: 'expense',
    amountMinor: 5_000,
    frequency: 'daily',
    startOn: TODAY,
    autoPost: 1,
    ...input,
  });
  if (createdAt === null) return rule;
  // «давно создан и с тех пор не правился»: у правила две метки времени, граница окна смотрит на обе
  await store.db.recurring_rules.update(rule.id, { createdAt, clientUpdatedAt: createdAt });
  return (await store.db.recurring_rules.get(rule.id)) as LocalRow<RecurringRule>;
}

const run = (s: Store, over: Partial<RunAutoPostOptions> = {}) =>
  runAutoPost({ store: s, today: TODAY, getRate: noRates, toLocal, ...over });

const liveTxs = async (s: Store) => (await s.db.transactions.toArray()).filter((t) => t.deletedAt === null);

describe('автопроведение: основной путь', () => {
  it('проводит платёж, которому пора: операция по расписанию, остаток уменьшился', async () => {
    const { store, cash, food } = await setup();
    const rule = await mkRule(store, { walletId: cash.id, categoryId: food.id, note: 'Аренда', amountMinor: 12_345 });
    const r = await run(store);
    expect(r.posted).toBe(1);
    expect(r.failures.size).toBe(0);
    expect(r.aborted).toBe(false);
    const txs = await liveTxs(store);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      kind: 'expense',
      walletId: cash.id,
      amountMinor: 12_345,
      occurredOn: TODAY,
      note: 'Аренда',
      recurringRuleId: rule.id,
      categoryId: food.id,
      baseAmountMinor: 12_345,
      fxRate: 1,
      id: await uuidV5(rule.id, TODAY),
    });
  });

  it('идемпотентно: второй проход ничего не добавляет и не считает', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id });
    expect((await run(store)).posted).toBe(1);
    const again = await run(store);
    expect(again.posted).toBe(0);
    expect(await liveTxs(store)).toHaveLength(1);
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('две вкладки одновременно: операция одна', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id });
    await Promise.all([run(store), run(store), run(store)]);
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('доход и перевод тоже проводятся; перевод в одной валюте без комиссии курса не просит', async () => {
    const { store, cash, salary } = await setup();
    const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await mkRule(store, { walletId: cash.id, kind: 'income', categoryId: salary.id, amountMinor: 700_000 });
    await mkRule(store, { walletId: cash.id, kind: 'transfer', toWalletId: card.id, amountMinor: 20_000 });
    const r = await run(store);
    expect(r.posted).toBe(2);
    const txs = await liveTxs(store);
    expect(txs.map((t) => t.kind).sort()).toEqual(['income', 'transfer']);
    expect(txs.find((t) => t.kind === 'transfer')).toMatchObject({ toWalletId: card.id, toAmountMinor: 20_000 });
  });

  it('платёж по долгу проводится вместе с долгом', async () => {
    const { store, cash } = await setup();
    const debt = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-09-01' });
    await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 10_000 });
    expect((await run(store)).posted).toBe(1);
    expect((await liveTxs(store))[0]?.debtId).toBe(debt.id);
  });

  it('нет ни одного правила — тихий пустой результат', async () => {
    const { store } = await setup();
    const r = await run(store);
    expect(r).toMatchObject({ posted: 0, capped: false, aborted: false });
    expect(r.failures.size).toBe(0);
    expect(r.missingRates).toEqual([]);
  });

  it('нет настроек (базовой валюты) — проводить нечего, ничего не падает', async () => {
    const store = await makeStore();
    const r = await run(store);
    expect(r).toMatchObject({ posted: 0, capped: false, aborted: false });
    expect(r.eligible.size).toBe(0);
  });
});

describe('автопроведение: кого и за какие даты не трогаем', () => {
  it('только «Проводить само», живые и не в архиве', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id, autoPost: 0, note: 'вручную' });
    const archived = await mkRule(store, { walletId: cash.id, note: 'в архиве' });
    await store.recurring.archive(archived.id);
    const deleted = await mkRule(store, { walletId: cash.id, note: 'удалён' });
    await store.db.recurring_rules.update(deleted.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const r = await run(store);
    expect(r.posted).toBe(0);
    expect(r.eligible.size).toBe(0);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('историю не проводит: правило создано сегодня с началом «вчера» — вчерашнее ждёт руками, сегодняшнее проводится', async () => {
    const { store, cash } = await setup();
    // createdAt правила — настоящее «сейчас» (ISO): подменяем только перевод в местную дату
    const rule = await mkRule(store, { walletId: cash.id, startOn: '2026-10-10' }, '2026-10-11T03:00:00.000Z');
    const r = await run(store);
    expect(r.posted).toBe(1);
    const txs = await liveTxs(store);
    expect(txs.map((t) => t.occurredOn)).toEqual([TODAY]);
    // вчерашняя дата осталась непроведённой: её id в базе нет
    expect(await store.db.transactions.get(await uuidV5(rule.id, '2026-10-10'))).toBeUndefined();
  });

  it('правило, созданное 5 дней назад с тем же началом, проведёт все пять дней и сегодняшний', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id, startOn: '2026-10-06' }, '2026-10-06T08:00:00.000Z');
    const r = await run(store);
    expect(r.posted).toBe(6);
    expect((await liveTxs(store)).map((t) => t.occurredOn).sort()).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('старше 60 дней сами не проводятся', async () => {
    const { store, cash } = await setup();
    const rule = await mkRule(store, { walletId: cash.id, frequency: 'weekly', startOn: '2026-01-02' }, '2026-01-02T00:00:00.000Z');
    const r = await run(store);
    // пятницы с 2026-08-12 (сегодня − 60) по 2026-10-11: 14.08, 21.08, 28.08, 04.09, 11.09, 18.09, 25.09, 02.10, 09.10
    expect(r.posted).toBe(9);
    const dates = (await liveTxs(store)).map((t) => t.occurredOn).sort();
    expect(dates[0]).toBe('2026-08-14');
    expect(dates.at(-1)).toBe('2026-10-09');
    expect(await store.db.transactions.get(await uuidV5(rule.id, '2026-08-07'))).toBeUndefined();
  });

  it('пропущенную дату («Пропустить») не воскрешает', async () => {
    const { store, cash } = await setup();
    const rule = await mkRule(store, { walletId: cash.id });
    await store.transactions.skipOccurrence(rule.id, TODAY);
    const r = await run(store);
    expect(r.posted).toBe(0);
    expect(await liveTxs(store)).toHaveLength(0);
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('уже проведённую вручную дату не трогает и не считает', async () => {
    const { store, cash } = await setup();
    const rule = await mkRule(store, { walletId: cash.id });
    await store.transactions.createFromRule(rule.id, TODAY, { amountMinor: 7_777 });
    const r = await run(store);
    expect(r.posted).toBe(0);
    const txs = await liveTxs(store);
    expect(txs).toHaveLength(1);
    expect(txs[0]?.amountMinor).toBe(7_777);
  });

  it('конец расписания: после даты окончания ничего не проводится', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id, startOn: '2026-10-01', endOn: '2026-10-03' }, '2026-10-01T00:00:00.000Z');
    expect((await run(store)).posted).toBe(3);
  });

  it('месячный платёж на 31-е в сентябре проводится 30-го (последний день месяца)', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id, frequency: 'monthly', startOn: '2026-07-31' }, '2026-07-31T00:00:00.000Z');
    await run(store);
    expect((await liveTxs(store)).map((t) => t.occurredOn).sort()).toEqual(['2026-08-31', '2026-09-30']);
  });
});

describe('автопроведение: лимит записей за проход', () => {
  it('не больше 200 за проход; остаток — на следующем', async () => {
    const { store, cash } = await setup();
    // четыре ежедневных платежа за 61 день: 4 × 61 = 244 даты
    for (let i = 0; i < 4; i++) await mkRule(store, { walletId: cash.id, startOn: '2026-01-01', note: `р${i}`, amountMinor: 100 + i });
    const first = await run(store);
    expect(first.posted).toBe(200);
    expect(first.capped).toBe(true);
    expect(await store.db.transactions.count()).toBe(200);
    const second = await run(store);
    expect(second.posted).toBe(44);
    expect(second.capped).toBe(false);
    expect(await store.db.transactions.count()).toBe(244);
    expect((await run(store)).posted).toBe(0);
  });

  it('свой лимит: при обрыве правила, не дошедшие до конца, не считаются разобранными', async () => {
    const { store, cash } = await setup();
    const a = await mkRule(store, { walletId: cash.id, startOn: '2026-10-08', note: 'a' }, '2026-10-08T00:00:00.000Z');
    const r = await run(store, { limit: 2 });
    expect(r.posted).toBe(2);
    expect(r.capped).toBe(true);
    expect(r.eligible.has(a.id)).toBe(true);
    expect(r.examined.has(a.id)).toBe(false);
  });
});

describe('автопроведение: кошелёк в чужой валюте', () => {
  const usdRule = (s: Setup) => mkRule(s.store, { walletId: s.usd.id, amountMinor: 1_000 });

  it('курса нет — не проводит, называет пару валют; правило остаётся с пометкой, другие платежи проводятся', async () => {
    const s = await setup();
    const rule = await usdRule(s);
    await mkRule(s.store, { walletId: s.cash.id, note: 'сомони' });
    const r = await run(s.store);
    expect(r.posted).toBe(1);
    expect(r.missingRates).toEqual([{ from: 'USD', to: 'TJS', reason: 'missing' }]);
    expect(r.failures.get(rule.id)).toEqual({ kind: 'no-rate', message: 'нет курса USD → TJS' });
    expect((await liveTxs(s.store)).map((t) => t.walletId)).toEqual([s.cash.id]);
  });

  it('свежий курс — проводит со снимком: курс, источник, сумма в базовой валюте', async () => {
    const s = await setup();
    await usdRule(s);
    const r = await run(s.store, { getRate: (a, b) => (a === 'USD' && b === 'TJS' ? fresh(10.9) : null) });
    expect(r.posted).toBe(1);
    expect(r.missingRates).toEqual([]);
    expect((await liveTxs(s.store))[0]).toMatchObject({ walletId: s.usd.id, amountMinor: 1_000, fxRate: 10.9, fxSource: 'nbt', baseAmountMinor: 10_900 });
  });

  it('устаревший курс — не проводит (stale)', async () => {
    const s = await setup();
    const rule = await usdRule(s);
    const r = await run(s.store, { getRate: () => fresh(10.9, { stale: true }) });
    expect(r.posted).toBe(0);
    expect(r.missingRates).toEqual([{ from: 'USD', to: 'TJS', reason: 'stale' }]);
    expect(r.failures.get(rule.id)?.message).toBe('курс USD → TJS устарел');
    expect(await s.store.db.transactions.count()).toBe(0);
  });

  it('«Свой курс» годится, даже если автоматические курсы устарели', async () => {
    const s = await setup();
    await usdRule(s);
    const r = await run(s.store, { getRate: () => fresh(11, { manual: true, source: 'manual' }) });
    expect(r.posted).toBe(1);
    expect((await liveTxs(s.store))[0]).toMatchObject({ fxRate: 11, fxSource: 'manual', baseAmountMinor: 11_000 });
  });

  it('курс, введённый в операции когда-то, — не годится для автоплатежа', async () => {
    const s = await setup();
    await usdRule(s);
    const r = await run(s.store, { getRate: () => fresh(11, { entered: true, source: 'manual' }) });
    expect(r.posted).toBe(0);
    expect(r.missingRates[0]).toMatchObject({ from: 'USD', to: 'TJS', reason: 'missing' });
  });

  it('несколько дат одного правила без курса — одна пара в списке и ни одной записи', async () => {
    const s = await setup();
    await mkRule(s.store, { walletId: s.usd.id, startOn: '2026-10-08' }, '2026-10-08T00:00:00.000Z');
    const r = await run(s.store);
    expect(r.posted).toBe(0);
    expect(r.missingRates).toHaveLength(1);
    expect(await s.store.db.transactions.count()).toBe(0);
  });

  it('перевод в долларах с комиссией требует курс, без комиссии — нет', async () => {
    const s = await setup();
    const usd2 = await s.store.wallets.create({ name: 'Доллары 2', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await mkRule(s.store, { walletId: s.usd.id, kind: 'transfer', toWalletId: usd2.id, amountMinor: 1_000, note: 'без комиссии' });
    const withFee = await mkRule(s.store, { walletId: s.usd.id, kind: 'transfer', toWalletId: usd2.id, amountMinor: 1_000, toAmountMinor: 990, note: 'с комиссией' });
    const r = await run(s.store);
    expect(r.posted).toBe(1);
    expect(r.failures.get(withFee.id)?.kind).toBe('no-rate');
    const again = await run(s.store, { getRate: () => fresh(10.9) });
    expect(again.posted).toBe(1);
    expect(await liveTxs(s.store)).toHaveLength(2);
  });
});

describe('автопроведение: переполнение сумм', () => {
  it('сумма в базовой валюте не помещается в границы сервера — понятная причина, записи нет, соседний платёж проведён', async () => {
    const s = await setup();
    const huge = await mkRule(s.store, { walletId: s.usd.id, amountMinor: 1_000_000_000_000_000, note: 'огромный' });
    await mkRule(s.store, { walletId: s.cash.id, note: 'обычный' });
    const r = await run(s.store, { getRate: () => fresh(10) });
    expect(r.posted).toBe(1);
    expect(r.failures.get(huge.id)?.kind).toBe('error');
    expect(r.failures.get(huge.id)?.message).toMatch(/слишком велика/);
    expect((await liveTxs(s.store)).map((t) => t.note)).toEqual(['обычный']);
  });

  it('предельная сумма в базовой валюте проводится без потери точности', async () => {
    const s = await setup();
    await mkRule(s.store, { walletId: s.cash.id, amountMinor: 1_000_000_000_000_000 });
    const r = await run(s.store);
    expect(r.posted).toBe(1);
    expect((await liveTxs(s.store))[0]).toMatchObject({ amountMinor: 1_000_000_000_000_000, baseAmountMinor: 1_000_000_000_000_000 });
  });
});

describe('автопроведение: ошибка одного правила не останавливает остальные', () => {
  it('кошелёк в архиве: причина записана, данные правила не изменились, соседний платёж проведён', async () => {
    const s = await setup();
    const card = await s.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const broken = await mkRule(s.store, { walletId: card.id, note: 'сломанный', startOn: '2026-10-09' }, '2026-10-09T00:00:00.000Z');
    await mkRule(s.store, { walletId: s.cash.id, note: 'живой' });
    await s.store.wallets.archive(card.id);
    const before = await s.store.db.recurring_rules.get(broken.id);

    const r = await run(s.store);
    expect(r.posted).toBe(1);
    const failure = r.failures.get(broken.id);
    expect(failure?.kind).toBe('error');
    expect(failure?.message).toMatch(/в архиве/);
    expect(await s.store.db.recurring_rules.get(broken.id)).toEqual(before);
    expect(r.examined.has(broken.id)).toBe(true);
    // у сломанного правила три даты, но после первой ошибки остальные не пробуются; проведён только соседний платёж
    expect((await liveTxs(s.store)).map((t) => t.note)).toEqual(['живой']);
  });

  it('категория удалена, долг в архиве, кошелёк удалён — каждая причина своя, по-русски', async () => {
    const s = await setup();
    const debt = await s.store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-09-01' });
    const byCategory = await mkRule(s.store, { walletId: s.cash.id, categoryId: s.food.id, note: 'кат' });
    // «я должен»: доход по долгу — получение (выдача по расписанию), такой план не останавливается, а падает с причиной
    const byDebt = await mkRule(s.store, { kind: 'income', walletId: s.cash.id, debtId: debt.id, note: 'долг' });
    const byWallet = await mkRule(s.store, { walletId: s.cash.id, note: 'кош' });
    await s.store.db.categories.update(s.food.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    await s.store.debts.archive(debt.id);
    await s.store.db.wallets.update(s.cash.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const r = await run(s.store);
    expect(r.posted).toBe(0);
    // кошелёк удалён у всех трёх — но и категория, и долг тоже плохие: порядок проверок репозитория решает, что назовут первым
    for (const rule of [byCategory, byDebt, byWallet]) {
      expect(r.failures.get(rule.id)?.kind).toBe('error');
      expect(r.failures.get(rule.id)?.message).toMatch(/[А-Яа-я]/);
    }
    expect(await s.store.db.transactions.count()).toBe(0);
  });

  it('категория удалена при живом кошельке — «Категория … удалена»', async () => {
    const s = await setup();
    const rule = await mkRule(s.store, { walletId: s.cash.id, categoryId: s.food.id });
    await s.store.db.categories.update(s.food.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const r = await run(s.store);
    expect(r.failures.get(rule.id)?.message).toMatch(/Категория «Еда» удалена/);
  });

  it('долг в архиве: план платежей стоит молча (не проводится, не ошибка); получение по расписанию — понятная причина', async () => {
    const s = await setup();
    const debt = await s.store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-09-01' });
    const plan = await mkRule(s.store, { walletId: s.cash.id, debtId: debt.id });
    const issue = await mkRule(s.store, { kind: 'income', walletId: s.cash.id, debtId: debt.id });
    await s.store.debts.archive(debt.id);
    const r = await run(s.store);
    expect(r.failures.has(plan.id)).toBe(false);
    expect(r.eligible.has(plan.id)).toBe(false);
    expect(r.failures.get(issue.id)?.message).toMatch(/Долг «Банк» в архиве/);
    expect(r.posted).toBe(0);
  });

  it('непредвиденный сбой записи: пометка без технических слов, остальные правила проводятся, в консоль — подробности', async () => {
    const s = await setup();
    const bad = await mkRule(s.store, { walletId: s.cash.id, note: 'bad', amountMinor: 111 });
    await mkRule(s.store, { walletId: s.cash.id, note: 'good', amountMinor: 222 });
    const real = s.store.transactions.createFromRule.bind(s.store.transactions);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    s.store.transactions.createFromRule = async (rule, date, opts) => {
      const id = typeof rule === 'string' ? rule : rule.id;
      if (id === bad.id) throw new Error('boom');
      return real(rule, date, opts);
    };
    const r = await run(s.store);
    expect(r.posted).toBe(1);
    expect(r.failures.get(bad.id)).toEqual({ kind: 'error', message: 'ошибка записи, данные не изменены' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('автопроведение: хранилище перестало быть текущим', () => {
  it('отмена до начала — ничего не читаем и не пишем', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id });
    const r = await run(store, { isCurrent: () => false });
    expect(r.aborted).toBe(true);
    expect(r.posted).toBe(0);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('отмена посреди прохода — следующую запись не делаем, сбой отмены не выдаём за ошибку правила', async () => {
    const { store, cash } = await setup();
    const rule = await mkRule(store, { walletId: cash.id, startOn: '2026-10-08' }, '2026-10-08T00:00:00.000Z');
    let calls = 0;
    // 1-й вызов — вход, 2-й и 3-й — перед записью 1-й и 2-й даты, дальше «аккаунт сменился»
    const r = await run(store, { isCurrent: () => ++calls <= 3 });
    expect(r.aborted).toBe(true);
    expect(r.posted).toBe(2);
    expect(r.failures.size).toBe(0);
    expect(r.examined.has(rule.id)).toBe(false);
    expect(await store.db.transactions.count()).toBe(2);
  });

  it('ошибка записи в момент отмены не превращается в пометку у правила', async () => {
    const { store, cash } = await setup();
    await mkRule(store, { walletId: cash.id });
    let current = true;
    store.transactions.createFromRule = async () => {
      current = false; // «вышли из аккаунта», и запись упала
      throw new Error('DatabaseClosedError');
    };
    const r = await run(store, { isCurrent: () => current });
    expect(r.aborted).toBe(true);
    expect(r.failures.size).toBe(0);
  });
});
