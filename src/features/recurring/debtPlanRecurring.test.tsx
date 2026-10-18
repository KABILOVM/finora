import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, renderAppRoot, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { RecurringInput, Store } from '@/db';
import { computeDebtState, PLAN_PAID_NOTE } from '@/domain/debts';
import { occurrencesBetween } from '@/domain/schedule';
import type { UUID } from '@/domain/types';
import { HideAmountsProvider } from '@/features/home/hideAmounts';
import { addDays } from '@/lib/dates';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import { resetAutoPostState } from '@/recurring/autoPostState';
import RecurringPage from './RecurringPage';
import UpcomingWidget from './UpcomingWidget';

/**
 * План «Платить частями» (регулярный платёж вида «возврат долга» с debtId) на экранах регулярных платежей:
 *  - «Провести» (PostSheet): последний взнос предлагается на остаток долга, под суммой — «Остаток долга: …»; запись — с fitToDebt;
 *  - «Провести» в одно касание на «Главной» (UpcomingWidget): последний взнос записан на остаток, и это сказано в уведомлении;
 *  - «Все правила»: план по погашенному/закрытому/архивному долгу помечен «… — план остановлен» и «Остановлен».
 * Сегодня закреплено на четверг 15.10.2026; база — сомони (TJS), «30 с.» = 3 000 дирамов.
 */

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const HIDE_KEY = 'finora-hide-balance';

beforeEach(() => {
  pinToday();
  resetAutoPostState();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  try {
    localStorage.removeItem(HIDE_KEY);
  } catch {
    /* хранилища нет — нечего чистить */
  }
});

const TODAY = '2026-10-15';
const day = (n: number) => addDays(TODAY, n);
const PLAN = 'Алишер: частями';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

interface Ids {
  cash: UUID;
  debt: UUID;
  plan: UUID;
}

interface DebtSetup {
  /** Сумма долга (мне должны), дирамы. */
  principal: number;
  /** Сколько Алишер уже вернул (одним платежом 5 дней назад), дирамы. */
  paid?: number;
  /** Сумма взноса по плану, дирамы. */
  plan?: number;
  autoPost?: 0 | 1;
  /** Дополнительная подготовка (другие правила, закрыть долг и т. п.). */
  more?: (s: Store, ids: Ids) => Promise<void>;
}

/**
 * «Мне должны»: Алишер взял principal сомони, вернул paid; план «Алишер: частями» — доход plan каждый месяц с сегодняшнего дня
 * на «Наличные» (TJS). Правило создано через репозиторий, как его создаёт «Платить частями».
 */
async function seedDebt(s: Store, o: DebtSetup): Promise<Ids> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  const debt = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: o.principal, currency: 'TJS', openedOn: day(-30) });
  if (o.paid) await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: o.paid, occurredOn: day(-5), debtId: debt.id });
  const input: RecurringInput = {
    kind: 'income',
    walletId: cash,
    amountMinor: o.plan ?? 5_000,
    frequency: 'monthly',
    startOn: TODAY,
    debtId: debt.id,
    note: PLAN,
    autoPost: o.autoPost ?? 0,
  };
  const plan = await s.recurring.create(input);
  const ids = { cash, debt: debt.id, plan: plan.id };
  await o.more?.(s, ids);
  return ids;
}

function deps(o: DebtSetup): { td: OpsDeps; ids: Ids } {
  const ids = {} as Ids;
  const td = opsDeps([table()], {
    setup: async (s) => {
      Object.assign(ids, await seedDebt(s, o));
    },
  });
  return { td, ids };
}

async function openRecurring(o: DebtSetup) {
  const { td, ids } = deps(o);
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, ids };
}

/** Окно «Провести платёж» для плана (он в разделе «Сегодня»). */
async function openPost() {
  await user.click(await waitFor(() => screen.getByRole('button', { name: new RegExp(`^Провести: ${PLAN}`) })));
  return findByRole('dialog', { name: 'Провести платёж' });
}

const amountValue = () => (screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value.replace(/\s/g, ' ');

/** Кнопка внутри окна по точному тексту (в окне «Провести» есть и заголовок, и кнопка с этим словом). */
function button(root: HTMLElement, name: string): HTMLElement {
  const hit = Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === name);
  if (!hit) throw new Error(`В окне нет кнопки «${name}»`);
  return hit;
}

/** Живые операции, записанные по правилу. */
async function postedBy(td: OpsDeps, ruleId: UUID) {
  const rows = await storeOf(td).db.transactions.where('recurringRuleId').equals(ruleId).toArray();
  return rows.filter((t) => t.deletedAt === null);
}

async function stateOf(s: Store, debtId: UUID) {
  const debt = (await s.db.debts.get(debtId))!;
  return computeDebtState(debt, await s.db.transactions.where('debtId').equals(debtId).toArray(), await s.db.wallets.toArray());
}

describe('«Провести» план по долгу (окно «Провести платёж»)', () => {
  it('остаток 30 с. меньше взноса 50 с.: в поле сразу 30, под ним «Остаток долга: 30 с.»; записано ровно 3 000 и долг погашен', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 17_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(amountValue()).toBe('30'));
    expect(norm(dlg.textContent)).toContain('Остаток долга: 30 с.');

    await user.click(button(dlg, 'Провести'));
    // записано меньше плана — сумма названа
    await waitFor(() => expect(screen.getByText(new RegExp(`^Проведено 30\\sс\\. — остаток долга: ${PLAN}$`))).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const rows = await postedBy(td, ids.plan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'income', amountMinor: 3_000, debtId: ids.debt, walletId: ids.cash, occurredOn: TODAY });
    const st = await stateOf(storeOf(td), ids.debt);
    expect(st).toMatchObject({ remainingMinor: 0, overpaidMinor: 0, settled: true });
    // само правило не изменилось: следующий взнос по плану — снова 50 с.
    expect((await storeOf(td).db.recurring_rules.get(ids.plan))?.amountMinor).toBe(5_000);
  });

  it('остаток 150 с. не меньше взноса: в поле сумма плана 50, «Остаток долга: 150 с.»; записано 5 000, остаток 100 с.', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 150 с.'));
    expect(amountValue()).toBe('50');

    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rows = await postedBy(td, ids.plan);
    expect(rows.map((t) => t.amountMinor)).toEqual([5_000]);
    expect((await stateOf(storeOf(td), ids.debt)).remainingMinor).toBe(10_000);
  });

  it('остаток ровно равен взносу (50 с.): сумма плана без изменений, записано 5 000, долг погашен без переплаты', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 15_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 50 с.'));
    expect(amountValue()).toBe('50');
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([5_000]);
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 0 });
  });

  it('свою сумму человек вводит сам (45 с. при остатке 30 с.) — она записывается как есть, с переплатой 15 с.', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 17_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(amountValue()).toBe('30'));
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '45');
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([4_500]);
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 1_500 });
  });

  it('человек сам вводит полную сумму плана (50 с.) при подставленном остатке 30 с. — записывается 50 с., переплата 20 с.', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 17_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(amountValue()).toBe('30'));
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '50');
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([5_000]);
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 2_000 });
    expect(screen.getByText('Платёж проведён: Алишер: частями')).toBeInTheDocument();
  });

  it('сумму не трогали — она идёт за остатком: пришёл платёж, и в поле вместо 50 стало 30; руками введённую сумму остаток не меняет', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 150 с.'));
    expect(amountValue()).toBe('50');
    await write(() =>
      storeOf(td).transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 12_000, occurredOn: day(-1), debtId: ids.debt }),
    );
    await waitFor(() => expect(amountValue()).toBe('30'));
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '40');
    await write(() =>
      storeOf(td).transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 1_000, occurredOn: day(-1), debtId: ids.debt }),
    );
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 20 с.'));
    expect(amountValue()).toBe('40');
  });

  it('пока окно открыто, пришёл платёж на 120 с.: сумма в поле не менялась — записывается остаток на момент записи (30 с.)', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 150 с.'));
    expect(amountValue()).toBe('50');
    // Алишер вернул ещё 120 с. (с другого устройства или из другой вкладки): остаток 30 с.
    await write(() =>
      storeOf(td).transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 12_000, occurredOn: day(-1), debtId: ids.debt }),
    );
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 30 с.'));
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([3_000]);
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 0 });
  });

  it('пока окно открыто, долг погасили полностью: «Провести» — понятная ошибка в окне, операция не записана', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 150 с.'));
    await write(() =>
      storeOf(td).transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 15_000, occurredOn: day(-1), debtId: ids.debt }),
    );
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 0 с.'));
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Долг «Алишер» уже погашен: платёж не проведён'));
    expect(screen.getByRole('dialog', { name: 'Провести платёж' })).toBeInTheDocument();
    expect(await postedBy(td, ids.plan)).toHaveLength(0);
    expect(await storeOf(td).db.transactions.where('recurringRuleId').equals(ids.plan).count()).toBe(0); // и пропуска тоже нет
  });

  it('пока окно открыто, долг закрыли: «Провести» — «Долг «Алишер» закрыт: платёж не проведён», операции нет', async () => {
    const { td, ids } = await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const dlg = await openPost();
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Остаток долга: 150 с.'));
    await write(() => storeOf(td).debts.close(ids.debt));
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Долг «Алишер» закрыт: платёж не проведён'));
    expect(await storeOf(td).db.transactions.where('recurringRuleId').equals(ids.plan).count()).toBe(0);
  });

  it('обычный регулярный платёж без долга: строки «Остаток долга» нет, сумма из правила', async () => {
    const { td } = await openRecurring({
      principal: 20_000,
      paid: 17_000,
      more: async (s, ids) => {
        await s.recurring.create({ kind: 'expense', walletId: ids.cash, amountMinor: 7_000, frequency: 'monthly', startOn: TODAY, note: 'Интернет' });
      },
    });
    await user.click(await waitFor(() => screen.getByRole('button', { name: /^Провести: Интернет/ })));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(amountValue()).toBe('70');
    // даём экрану дочитать (у плана по долгу строка появилась бы после чтения долга)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(norm(dlg.textContent)).not.toContain('Остаток долга');
    await user.click(button(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rule = (await storeOf(td).db.recurring_rules.toArray()).find((r) => r.note === 'Интернет')!;
    expect((await postedBy(td, rule.id)).map((t) => t.amountMinor)).toEqual([7_000]);
  });
});

/** «Главная» без остального экрана: виджет «Ближайшие платежи» (по желанию — со скрытыми суммами, как после «глаза»). */
async function showWidget(o: DebtSetup, opts: { hidden?: boolean } = {}) {
  if (opts.hidden) localStorage.setItem(HIDE_KEY, '1');
  const { td, ids } = deps(o);
  renderAppRoot(
    <HideAmountsProvider>
      <UpcomingWidget />
    </HideAmountsProvider>,
    { deps: td.deps },
  );
  await waitFor(() => {
    if (td.stores.length === 0) throw new Error('База ещё открывается');
  });
  return { td, ids };
}

const widgetButton = () => waitFor(() => screen.getByRole('button', { name: new RegExp(`^Провести: ${PLAN}`) }));

describe('«Провести» плана по долгу в одно касание на «Главной»', () => {
  it('последний взнос: записан остаток 30 с. вместо 50 с., уведомление «Проведено 30 с. — остаток долга: …»; погашенный план уходит', async () => {
    const { td, ids } = await showWidget({ principal: 20_000, paid: 17_000, plan: 5_000 });
    const b = await widgetButton();
    act(() => b.click());
    await eventually(async () => expect(await postedBy(td, ids.plan)).toHaveLength(1));
    const [tx] = await postedBy(td, ids.plan);
    expect(tx).toMatchObject({ amountMinor: 3_000, debtId: ids.debt, occurredOn: TODAY, kind: 'income' });
    await waitFor(() => expect(screen.getByText(`Проведено 30 с. — остаток долга: ${PLAN}`)).toBeInTheDocument());
    expect(screen.queryByText(`Платёж проведён: ${PLAN}`)).toBeNull();
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 0 });
    // долг погашен — план стоит, в «Ближайших платежах» его больше нет
    await waitFor(() => expect(screen.queryByText('Ближайшие платежи')).toBeNull());
  });

  it('суммы скрыты «глазом»: в уведомлении нет суммы — «Платёж проведён на остаток долга: …»', async () => {
    const { td, ids } = await showWidget({ principal: 20_000, paid: 17_000, plan: 5_000 }, { hidden: true });
    const b = await widgetButton();
    act(() => b.click());
    await eventually(async () => expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([3_000]));
    await waitFor(() => expect(screen.getByText(`Платёж проведён на остаток долга: ${PLAN}`)).toBeInTheDocument());
    expect(screen.queryByText(/Проведено 30/)).toBeNull();
  });

  it('остаток больше взноса: записана сумма плана 50 с., уведомление обычное', async () => {
    const { td, ids } = await showWidget({ principal: 20_000, paid: 5_000, plan: 5_000 });
    const b = await widgetButton();
    act(() => b.click());
    await eventually(async () => expect((await postedBy(td, ids.plan)).map((t) => t.amountMinor)).toEqual([5_000]));
    await waitFor(() => expect(screen.getByText(`Платёж проведён: ${PLAN}`)).toBeInTheDocument());
    expect(screen.queryByText(/остаток долга/)).toBeNull();
    expect((await stateOf(storeOf(td), ids.debt)).remainingMinor).toBe(10_000);
  });

  it('выдача по расписанию на тот же долг (расход) остатком не ограничивается: записано 50 с. при остатке 30 с.', async () => {
    let issueRule = '';
    const { td, ids } = await showWidget({
      principal: 20_000,
      paid: 17_000,
      more: async (s, i) => {
        // план платежей убираем в архив, чтобы в виджете была одна строка — выдача
        await s.recurring.archive(i.plan);
        issueRule = (
          await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 5_000, frequency: 'monthly', startOn: TODAY, debtId: i.debt, note: 'Алишеру ещё' })
        ).id;
      },
    });
    const b = await waitFor(() => screen.getByRole('button', { name: /^Провести: Алишеру ещё/ }));
    act(() => b.click());
    await eventually(async () => expect((await postedBy(td, issueRule)).map((t) => t.amountMinor)).toEqual([5_000]));
    await waitFor(() => expect(screen.getByText('Платёж проведён: Алишеру ещё')).toBeInTheDocument());
    // выдача сумму долга не меняет: остаток прежний, «выдано деньгами» выросло
    expect(await stateOf(storeOf(td), ids.debt)).toMatchObject({ remainingMinor: 3_000, issuedMinor: 5_000 });
  });
});

/** Строка правила в «Все правила» по его названию. */
function ruleRow(title: string): HTMLElement {
  const section = screen.getByRole('heading', { name: 'Все правила' }).closest('section');
  if (!section) throw new Error('Нет раздела «Все правила»');
  const hit = Array.from(section.querySelectorAll<HTMLElement>('li')).find((li) => (li.textContent ?? '').includes(title));
  if (!hit) throw new Error(`В «Все правила» нет «${title}»`);
  return hit;
}

describe('«Все правила»: план по долгу, который стоит', () => {
  const withInternet = async (s: Store, ids: Ids) => {
    await s.recurring.create({ kind: 'expense', walletId: ids.cash, amountMinor: 7_000, frequency: 'monthly', startOn: day(3), note: 'Интернет', autoPost: 1 });
  };

  it('долг погашен: «Долг погашен — план остановлен» и «Остановлен» вместо даты и способа; соседнее правило — как обычно', async () => {
    await openRecurring({ principal: 20_000, paid: 20_000, plan: 5_000, autoPost: 1, more: withInternet });
    await waitFor(() => expect(norm(ruleRow(PLAN).textContent)).toContain('Долг погашен — план остановлен'));
    const plan = norm(ruleRow(PLAN).textContent);
    expect(plan).toContain('Остановлен');
    expect(plan).toContain('Платёж по долгу: Алишер');
    expect(plan).not.toContain('Следующий платёж');
    expect(plan).not.toContain('Проводится само');

    const other = norm(ruleRow('Интернет').textContent);
    expect(other).toContain('Следующий платёж: вс, 18 окт');
    expect(other).toContain('Проводится само');
    expect(other).not.toContain('Остановлен');
    expect(other).not.toContain('план остановлен');

    // в «Сегодня» стоящего плана нет — провести его нечего
    expect(screen.queryByRole('button', { name: new RegExp(`^Провести: ${PLAN}`) })).toBeNull();
  });

  it('долг закрыт — «Долг закрыт — план остановлен»; «Открыть снова» возвращает план без правок правила', async () => {
    const { td, ids } = await openRecurring({
      principal: 20_000,
      paid: 5_000,
      plan: 5_000,
      more: async (s, i) => {
        await s.debts.close(i.debt);
      },
    });
    await waitFor(() => expect(norm(ruleRow(PLAN).textContent)).toContain('Долг закрыт — план остановлен'));
    expect(norm(ruleRow(PLAN).textContent)).toContain('Остановлен');
    const before = await storeOf(td).db.recurring_rules.get(ids.plan);

    await write(() => storeOf(td).debts.reopen(ids.debt));
    await waitFor(() => expect(norm(ruleRow(PLAN).textContent)).not.toContain('план остановлен'));
    const row = norm(ruleRow(PLAN).textContent);
    expect(row).toContain('Ждёт подтверждения');
    expect(row).not.toContain('Остановлен');
    expect(row).toMatch(/Следующий платёж: сегодня/);
    // и в «Сегодня» план снова есть
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^Провести: ${PLAN}`) })).toBeInTheDocument());
    expect(await storeOf(td).db.recurring_rules.get(ids.plan)).toEqual(before);
  });

  it('долг в архиве — «Долг в архиве — план остановлен»', async () => {
    await openRecurring({
      principal: 20_000,
      paid: 5_000,
      more: async (s, i) => {
        await s.debts.archive(i.debt);
      },
    });
    await waitFor(() => expect(norm(ruleRow(PLAN).textContent)).toContain('Долг в архиве — план остановлен'));
    expect(norm(ruleRow(PLAN).textContent)).toContain('Остановлен');
  });

  it('долг не погашен — у плана обычные «Следующий платёж» и «Ждёт подтверждения», без пометки об остановке', async () => {
    await openRecurring({ principal: 20_000, paid: 5_000, plan: 5_000 });
    await waitFor(() => expect(norm(ruleRow(PLAN).textContent)).toMatch(/Следующий платёж: сегодня/));
    const row = norm(ruleRow(PLAN).textContent);
    expect(row).toContain('Ждёт подтверждения');
    expect(row).not.toContain('Остановлен');
  });
});

describe('«Пропущенные»: дата плана, закрытая отдельным платежом', () => {
  it('«Оплачен отдельным платежом» без «Вернуть»; обычный пропуск по-прежнему можно вернуть', async () => {
    await openRecurring({
      principal: 20_000,
      paid: 5_000,
      more: async (s, ids) => {
        // прошлый месяц закрыл ручной платёж («Это плановый платёж»), позапрошлый пропустили обычным «Пропустить»
        await s.db.recurring_rules.update(ids.plan, { startOn: day(-62) });
        const rule = (await s.db.recurring_rules.get(ids.plan))!;
        const dates = occurrencesBetween(rule, day(-62), day(-1));
        await s.transactions.skipOccurrence(ids.plan, dates[dates.length - 1]!, { note: `${PLAN_PAID_NOTE} ${dates[dates.length - 1]!}` });
        await s.transactions.skipOccurrence(ids.plan, dates[0]!);
      },
    });
    await user.click(await waitFor(() => screen.getByRole('button', { name: /^Пропущенные · 2/ })));
    await waitFor(() => expect(screen.getByText(/^Оплачен отдельным платежом ·/)).toBeInTheDocument());
    expect(screen.getAllByText(/^Пропущен ·/)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Вернуть платёж: / })).toHaveLength(1);
  });
});
