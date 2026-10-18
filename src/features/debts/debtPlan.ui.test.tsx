import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { uuidV5, type RecurringInput, type Store } from '@/db';
import { formatMinor } from '@/domain/money';
import {
  LocationProbe,
  opsDeps,
  pinToday,
  showApp,
  storeOf,
  table,
  tapAmount,
  unpinToday,
  type OpsDeps,
} from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';

// «Сегодня» — четверг 15.10.2026 (pinToday).
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a3333';
const PLAN_ID = '5b0f6f7e-1c2d-4e3f-8a9b-0c1d2e3f4a01';
const PLAN_2_ID = '5b0f6f7e-1c2d-4e3f-8a9b-0c1d2e3f4a02';
const PLAN_SENTENCE = 'План платежей по долгу остановится; если открыть долг снова, он продолжится.';
const PLAN_EXISTS = 'У долга уже есть план платежей: измените его на странице долга';

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null | undefined) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const planCards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="debt-plan"]'));
const planSection = () => document.querySelector<HTMLElement>('section[aria-labelledby="debt-plan"]');
const planHeading = () => text(document.getElementById('debt-plan'));
const remaining = () => text(document.querySelector('[data-testid="debt-remaining"]'));
const closed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

type DebtInput = Parameters<Store['debts']['create']>[0];
interface Ctx {
  cash: string;
}
type Setup = (s: Store, ctx: Ctx) => Promise<unknown>;

/** План «Получать частями» по долгу «Алишер»: 200 с. каждый месяц 1-го, с 01.11.2026 до 01.01.2027, ждёт подтверждения. */
const addPlan = (s: Store, ctx: Ctx, over: Partial<RecurringInput> = {}, id = PLAN_ID) =>
  s.recurring.create(
    {
      kind: 'income',
      walletId: ctx.cash,
      amountMinor: 20_000,
      categoryId: null,
      debtId: DEBT_ID,
      note: 'Долг: Алишер',
      frequency: 'monthly',
      intervalN: 1,
      startOn: '2026-11-01',
      endOn: '2027-01-01',
      autoPost: 0,
      ...over,
    },
    { id },
  );

/** Второй живой план того же долга — как после объединения долгов или правок с двух устройств (сам репозиторий второй не заводит). */
const addSecondPlan = async (s: Store, ctx: Ctx, over: Partial<RecurringInput>, id: string) => {
  await s.db.recurring_rules.update(PLAN_ID, { archivedAt: '2026-10-01T00:00:00.000Z' });
  await addPlan(s, ctx, over, id);
  await s.db.recurring_rules.update(PLAN_ID, { archivedAt: null });
};

/**
 * «Наличные» с 1 000 с.; долг «Алишер» 500 с. («мне должны»), выдан 1 октября деньгами с «Наличных».
 * setup — после долга (план, платежи, закрытие…), ДО того как экран увидит базу.
 */
async function show(setup?: Setup, debt: Partial<DebtInput> = {}) {
  const ctx: Ctx = { cash: '' };
  const td = opsDeps([table()], {
    setup: async (s) => {
      ctx.cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      await s.transactions.create({ kind: 'income', walletId: ctx.cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
      await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...debt }, { id: DEBT_ID });
      await s.transactions.create({ kind: 'expense', walletId: ctx.cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: DEBT_ID });
      await setup?.(s, ctx);
    },
  });
  await showApp(
    <>
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    `/debts/${DEBT_ID}`,
  );
  await findByRole('heading', { name: 'Алишер', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, ctx };
}

const ruleRow = (td: OpsDeps, id = PLAN_ID) => storeOf(td).db.recurring_rules.get(id);
const debtTxs = async (td: OpsDeps) => (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId === DEBT_ID);
const payments = async (td: OpsDeps) => (await debtTxs(td)).filter((t) => t.kind === 'income' && t.deletedAt === null);
/** Ждём, пока страница прочитает правила и покажет карточку плана. */
const planShown = () => waitFor(() => expect(planCards().length).toBeGreaterThan(0));

describe('страница долга: карточка плана платежей', () => {
  it('план виден: сумма — расписание — «до ДД.ММ.ГГГГ», «Ждёт подтверждения»; «Получать частями» скрыта', async () => {
    await show((s, ctx) => addPlan(s, ctx));
    await planShown();
    expect(planHeading()).toBe('План платежей');
    const [card] = planCards();
    expect(planCards()).toHaveLength(1);
    expect(text(card!.querySelector('p'))).toBe(`${fmt(20_000)} — каждый месяц, 1-го, до 01.01.2027`);
    expect(text(card)).toContain('Ждёт подтверждения');
    expect(text(card)).not.toContain('Проводится само');
    expect(text(card)).not.toContain('план остановлен');
    expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull();
    expect(planSection()!.querySelector('[role="status"]')).toBeNull(); // одного плана — без предупреждения
  });

  it('«Проводить само» — значок «Проводится само»; план без даты окончания — без «до …»', async () => {
    await show((s, ctx) => addPlan(s, ctx, { autoPost: 1, endOn: null, startOn: '2026-11-20' }));
    await planShown();
    const [card] = planCards();
    expect(text(card!.querySelector('p'))).toBe(`${fmt(20_000)} — каждый месяц, 20-го`);
    expect(text(card)).toContain('Проводится само');
    expect(text(card)).not.toContain('Ждёт подтверждения');
  });

  it('плана нет — нет и карточки; есть «Получать частями»', async () => {
    await show();
    await findByRole('button', { name: 'Получать частями' });
    expect(planSection()).toBeNull();
    expect(planCards()).toHaveLength(0);
  });

  it('план в архиве (остановлен раньше) карточку не показывает: «Получать частями» снова доступна', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.recurring.archive(PLAN_ID);
    });
    await findByRole('button', { name: 'Получать частями' });
    expect(planCards()).toHaveLength(0);
  });

  it('регулярная выдача по долгу (расход с debtId) — не план: карточки нет, «Получать частями» есть', async () => {
    await show((s, ctx) => addPlan(s, ctx, { kind: 'expense', note: 'ещё в долг' }));
    await findByRole('button', { name: 'Получать частями' });
    expect(planCards()).toHaveLength(0);
  });

  it('«Остановить»: правило в архиве, карточка ушла, «Получать частями» появилась; «Отменить» возвращает план', async () => {
    const { td } = await show((s, ctx) => addPlan(s, ctx));
    await planShown();
    await user.click(button('Остановить'));
    await eventually(async () => expect((await ruleRow(td))?.archivedAt).not.toBeNull());
    await waitFor(() => expect(planCards()).toHaveLength(0));
    await findByRole('button', { name: 'Получать частями' });
    const toast = screen.getAllByRole('status').find((el) => text(el).includes('План платежей остановлен'));
    expect(toast).toBeTruthy();
    const undo = Array.from(toast!.querySelectorAll('button')).find((b) => text(b) === 'Отменить');
    expect(undo).toBeTruthy();
    expect((await ruleRow(td))?.deletedAt).toBeNull(); // остановлен, а не удалён

    await user.click(undo!);
    await eventually(async () => expect((await ruleRow(td))?.archivedAt).toBeNull());
    await planShown();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull());
    await waitFor(() => expect(screen.getAllByRole('status').some((el) => text(el).includes('План возвращён'))).toBe(true));
  });

  it('«Остановить», затем новый план и «Отменить» на первом уведомлении: второй план не появляется — понятная ошибка', async () => {
    const { td, ctx } = await show((s, c) => addPlan(s, c));
    await planShown();
    await user.click(button('Остановить'));
    await eventually(async () => expect((await ruleRow(td))?.archivedAt).not.toBeNull());
    const toast = screen.getAllByRole('status').find((el) => text(el).includes('План платежей остановлен'))!;
    const undo = Array.from(toast.querySelectorAll('button')).find((b) => text(b) === 'Отменить')!;
    // пока уведомление на экране, завели новый план (здесь же или на другом устройстве)
    await act(async () => {
      await addPlan(storeOf(td), ctx, { amountMinor: 10_000 }, PLAN_2_ID);
    });
    await waitFor(() => expect(planCards()).toHaveLength(1));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); // «Не удалось отменить» пишется в консоль
    await user.click(undo);
    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => text(el).includes('уже есть план платежей'))).toBe(true));
    expect((await ruleRow(td))?.archivedAt).not.toBeNull(); // старый план так и остался остановленным
    const live = (await storeOf(td).db.recurring_rules.toArray()).filter((r) => r.debtId === DEBT_ID && r.archivedAt === null && r.deletedAt === null);
    expect(live.map((r) => r.id)).toEqual([PLAN_2_ID]);
    expect(planCards()).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('«Изменить» открывает правку регулярного платежа с суммой плана; сохранение меняет карточку', async () => {
    const { td } = await show((s, ctx) => addPlan(s, ctx));
    await planShown();
    await user.click(button('Изменить'));
    const dlg = await findByRole('dialog', { name: 'Правка платежа' });
    expect((screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value).toBe('200');
    for (let i = 0; i < 3; i++) await user.click(button('Стереть'));
    await tapAmount('250');
    const save = Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === 'Сохранить')!;
    await user.click(save);
    await closed('Правка платежа');
    await eventually(async () => expect((await ruleRow(td))?.amountMinor).toBe(25_000));
    await waitFor(() => expect(text(planCards()[0]!.querySelector('p'))).toBe(`${fmt(25_000)} — каждый месяц, 1-го, до 01.01.2027`));
  });

  it('два живых плана (после объединения или с двух устройств): «Планы платежей (2)» и предупреждение', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await addSecondPlan(s, ctx, { amountMinor: 15_000, startOn: '2026-11-10', endOn: '2027-02-10' }, PLAN_2_ID);
    });
    await waitFor(() => expect(planCards()).toHaveLength(2));
    expect(planHeading()).toBe('Планы платежей (2)');
    expect(text(planSection()!.querySelector('[role="status"]'))).toBe(
      'У долга несколько планов: платежи по ним складываются. Оставьте один, остальные остановите.',
    );
    const lines = planCards().map((c) => text(c.querySelector('p')));
    expect(lines).toContain(`${fmt(20_000)} — каждый месяц, 1-го, до 01.01.2027`);
    expect(lines).toContain(`${fmt(15_000)} — каждый месяц, 10-го, до 10.02.2027`);
    expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull();
  });

  it('долг закрыт: карточка говорит «Долг закрыт — план остановлен» вместо значка', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.debts.close(DEBT_ID);
    });
    await planShown();
    const [card] = planCards();
    expect(text(card)).toContain('Долг закрыт — план остановлен');
    expect(text(card)).not.toContain('Ждёт подтверждения');
    expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull();
  });

  it('долг в архиве: «Долг в архиве — план остановлен»', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.debts.archive(DEBT_ID);
    });
    await planShown();
    expect(text(planCards()[0])).toContain('Долг в архиве — план остановлен');
    expect(text(planCards()[0])).not.toContain('Ждёт подтверждения');
  });

  it('долг погашен: «Долг погашен — план остановлен»', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.transactions.create({ kind: 'income', walletId: ctx.cash, amountMinor: 50_000, occurredOn: '2026-10-10', debtId: DEBT_ID });
    });
    await planShown();
    expect(remaining()).toBe(fmt(0));
    expect(text(planCards()[0])).toContain('Долг погашен — план остановлен');
    expect(text(planCards()[0])).not.toContain('Ждёт подтверждения');
  });
});

describe('страница долга: «Закрыть долг?» и план', () => {
  const closeDialogText = async () => {
    await user.click(button('Закрыть долг'));
    return text(await findByRole('alertdialog', { name: 'Закрыть долг?' }));
  };

  it('идущий план: в подтверждении сказано, что план остановится и продолжится после «Открыть снова»', async () => {
    const { td } = await show((s, ctx) => addPlan(s, ctx));
    await planShown();
    const msg = await closeDialogText();
    expect(msg).toContain(`Остаток ${fmt(50_000)}`);
    expect(msg).toContain(`Закрытый долг можно открыть снова. ${PLAN_SENTENCE}`);
    const dlg = screen.getByRole('alertdialog', { name: 'Закрыть долг?' });
    await user.click(Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === 'Закрыть долг')!);
    await eventually(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.closedAt).not.toBeNull());
    await waitFor(() => expect(text(planCards()[0])).toContain('Долг закрыт — план остановлен'));
    expect((await ruleRow(td))?.archivedAt).toBeNull(); // в само правило ничего не пишется
  });

  it('план закончился (дата окончания прошла), а долг не погашен: карточка так и говорит, фразы об остановке при закрытии нет', async () => {
    await show((s, ctx) => addPlan(s, ctx, { amountMinor: 10_000, startOn: '2026-08-01', endOn: '2026-10-01' }));
    await planShown();
    expect(text(planCards()[0])).toContain(
      'План закончился 01.10.2026, а долг не погашен: продлите план («Изменить») или остановите его, чтобы составить новый.',
    );
    expect(text(planCards()[0])).not.toContain('Ждёт подтверждения');
    const msg = await closeDialogText();
    expect(msg).not.toContain('План платежей');
  });

  it('плана нет — фразы о плане нет', async () => {
    await show();
    await findByRole('button', { name: 'Получать частями' });
    const msg = await closeDialogText();
    expect(msg).toContain(`Остаток ${fmt(50_000)}`);
    expect(msg).not.toContain('План платежей');
    expect(msg).not.toContain('Планы платежей');
  });

  it('план в архиве — фразы нет', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.recurring.archive(PLAN_ID);
    });
    await findByRole('button', { name: 'Получать частями' });
    expect(await closeDialogText()).not.toContain('План платежей');
  });

  it('долг погашен (план уже стоит) — «Долг погашен полностью…» без фразы о плане', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await s.transactions.create({ kind: 'income', walletId: ctx.cash, amountMinor: 50_000, occurredOn: '2026-10-10', debtId: DEBT_ID });
    });
    await planShown();
    const msg = await closeDialogText();
    expect(msg).toContain('Долг погашен полностью');
    expect(msg).not.toContain('План платежей');
  });

  it('два идущих плана — «Планы платежей по долгу (2) остановятся…»', async () => {
    await show(async (s, ctx) => {
      await addPlan(s, ctx);
      await addSecondPlan(s, ctx, { amountMinor: 15_000 }, PLAN_2_ID);
    });
    await waitFor(() => expect(planCards()).toHaveLength(2));
    expect(await closeDialogText()).toContain('Планы платежей по долгу (2) остановятся; если открыть долг снова, они продолжатся.');
  });
});

describe('«Получать частями»: второй план не создаётся', () => {
  it('план появился, пока окно открыто (другое устройство): сохранение — понятная ошибка, правило одно', async () => {
    const { td, ctx } = await show();
    await user.click(button('Получать частями'));
    const dlg = await findByRole('dialog', { name: 'Получать частями' });
    await tapAmount('150');
    await write(() => addPlan(storeOf(td), ctx));
    await user.click(button('Создать платежи'));
    await waitFor(() => expect(text(dlg.querySelector('[role="alert"]'))).toBe(PLAN_EXISTS));
    const rules = (await storeOf(td).db.recurring_rules.toArray()).filter((r) => r.debtId === DEBT_ID);
    expect(rules.map((r) => r.id)).toEqual([PLAN_ID]);
    expect(screen.getByRole('dialog', { name: 'Получать частями' })).toBeTruthy(); // окно не закрылось молча
  });

  it('сумма в месяц больше остатка — ошибка у поля, правило не создано', async () => {
    const { td } = await show();
    await user.click(button('Получать частями'));
    const dlg = await findByRole('dialog', { name: 'Получать частями' });
    await tapAmount('600');
    await user.click(button('Создать платежи'));
    await waitFor(() => expect(text(dlg)).toContain('Больше остатка долга: хватит одного платежа на остаток'));
    expect(await storeOf(td).db.recurring_rules.count()).toBe(0);
  });

  it('создали план — кнопка «Получать частями» пропала, появилась карточка плана', async () => {
    const { td } = await show();
    await user.click(button('Получать частями'));
    await findByRole('dialog', { name: 'Получать частями' });
    await tapAmount('250');
    await user.click(button('Создать платежи'));
    await closed('Получать частями');
    await planShown();
    expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull();
    expect(text(planCards()[0]!.querySelector('p'))).toBe(`${fmt(25_000)} — каждый месяц, 15-го, до 15.11.2026`);
    expect(await storeOf(td).db.recurring_rules.count()).toBe(1);
  });
});

describe('«Добавить платёж»: это плановый платёж', () => {
  const openPayment = async () => {
    await user.click(button('Добавить платёж'));
    return findByRole('dialog', { name: 'Платёж по долгу' });
  };
  /** Подпись отметки: [заголовок, подсказка] (две строки-блока внутри label). */
  const plannedLabel = (box: HTMLElement) => Array.from(box.closest('label')!.querySelectorAll('span > span')).map((el) => text(el));
  const plannedBox = () => screen.queryByRole('checkbox', { name: /^Это плановый платёж за/ }) as HTMLInputElement | null;
  const eraseAmount = async (times: number) => {
    for (let i = 0; i < times; i++) await user.click(button('Стереть'));
  };
  const savePayment = async () => {
    await user.click(button('Записать платёж'));
    await closed('Платёж по долгу');
  };
  const statusTexts = () => screen.queryAllByRole('status').map((el) => text(el));
  const alertTexts = () => screen.queryAllByRole('alert').map((el) => text(el));
  const skipId = (date: string) => uuidV5(PLAN_ID, date);
  /** «Отметки нет» проверяем после того, как окно успело прочитать предстоящие платежи (иначе null значил бы «ещё грузится»). */
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 300)));

  it('плановая дата сегодня: отметка включена; запись — платёж и пропуск даты плана (v5(правило, дата) удалён)', async () => {
    const { td, ctx } = await show((s, c) => addPlan(s, c, { startOn: '2026-10-15', endOn: '2027-01-15' }));
    await openPayment();
    const box = await waitFor(() => plannedBox()!);
    expect(box.checked).toBe(true);
    expect(plannedLabel(box)).toEqual(['Это плановый платёж за 15 октября', 'Срок: сегодня. Отметьте, чтобы план не провёл его ещё раз.']);
    await eraseAmount(3);
    await tapAmount('200');
    await savePayment();

    await eventually(async () => expect(await payments(td)).toHaveLength(1));
    const [pay] = await payments(td);
    expect(pay).toMatchObject({ kind: 'income', amountMinor: 20_000, walletId: ctx.cash, occurredOn: '2026-10-15', recurringRuleId: null });
    const skipped = await storeOf(td).db.transactions.get(await skipId('2026-10-15'));
    expect(skipped).toBeDefined();
    expect(skipped!.deletedAt).not.toBeNull();
    expect(skipped).toMatchObject({ recurringRuleId: PLAN_ID, occurredOn: '2026-10-15', debtId: DEBT_ID, amountMinor: 20_000 });
    await waitFor(() => expect(statusTexts()).toContain('Платёж записан, плановый за 15 октября закрыт'));
    await waitFor(() => expect(remaining()).toBe(fmt(30_000))); // пропуск не меняет остаток: в нём только сам платёж
  });

  it('отметку сняли — записан только платёж, дата плана не пропущена', async () => {
    const { td } = await show((s, c) => addPlan(s, c, { startOn: '2026-10-15', endOn: '2027-01-15' }));
    await openPayment();
    const box = await waitFor(() => plannedBox()!);
    await user.click(box);
    expect(box.checked).toBe(false);
    await eraseAmount(3);
    await tapAmount('200');
    await savePayment();
    await eventually(async () => expect(await payments(td)).toHaveLength(1));
    expect(await storeOf(td).db.transactions.get(await skipId('2026-10-15'))).toBeUndefined();
    expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.recurringRuleId === PLAN_ID)).toHaveLength(0);
    await waitFor(() => expect(statusTexts()).toContain('Платёж записан'));
  });

  it('плана нет — отметки нет, тост обычный', async () => {
    const { td } = await show();
    await openPayment();
    await settle();
    expect(plannedBox()).toBeNull();
    await savePayment();
    await eventually(async () => expect(await payments(td)).toHaveLength(1));
    await waitFor(() => expect(statusTexts()).toContain('Платёж записан'));
  });

  it('просроченная плановая дата: отметка «за 10 октября», срок «просрочено на 5 дней»', async () => {
    const { td } = await show((s, c) => addPlan(s, c, { startOn: '2026-10-10', endOn: '2027-01-10' }));
    await openPayment();
    const box = await waitFor(() => plannedBox()!);
    expect(plannedLabel(box)).toEqual(['Это плановый платёж за 10 октября', 'Срок: просрочено на 5 дней. Отметьте, чтобы план не провёл его ещё раз.']);
    await savePayment();
    await eventually(async () => expect((await storeOf(td).db.transactions.get(await skipId('2026-10-10')))?.deletedAt).not.toBeNull());
  });

  it('несколько непроведённых дат — берётся ближайшая к дате платежа; старые остаются в «Просроченных»; заметка «Оплачено отдельным платежом»', async () => {
    // каждую неделю по четвергам: 01.10, 08.10, 15.10; 01.10 уже пропущена; платёж — сегодня, 15.10
    const { td } = await show(async (s, c) => {
      await addPlan(s, c, { frequency: 'weekly', startOn: '2026-10-01', endOn: '2026-12-31', amountMinor: 5_000 });
      await s.transactions.skipOccurrence(PLAN_ID, '2026-10-01');
    });
    await openPayment();
    const box = await waitFor(() => plannedBox()!);
    expect(plannedLabel(box)[0]).toBe('Это плановый платёж за 15 октября');
    await eraseAmount(3);
    await tapAmount('50');
    await savePayment();
    await eventually(async () => expect((await storeOf(td).db.transactions.get(await skipId('2026-10-15')))?.deletedAt).not.toBeNull());
    expect((await storeOf(td).db.transactions.get(await skipId('2026-10-15')))?.note).toBe('Оплачено отдельным платежом 15.10.2026');
    expect(await storeOf(td).db.transactions.get(await skipId('2026-10-08'))).toBeUndefined(); // старая дата не тронута
  });

  it('плановая дата через 3 дня — отметка есть, срок «через 3 дня»', async () => {
    await show((s, c) => addPlan(s, c, { startOn: '2026-10-18', endOn: '2027-01-18' }));
    await openPayment();
    const box = await waitFor(() => plannedBox()!);
    expect(plannedLabel(box)).toEqual(['Это плановый платёж за 18 октября', 'Срок: через 3 дня. Отметьте, чтобы план не провёл его ещё раз.']);
  });

  it('плановая дата через 4 дня — рано: отметки нет', async () => {
    await show((s, c) => addPlan(s, c, { startOn: '2026-10-19', endOn: '2027-01-19' }));
    await openPayment();
    await settle();
    expect(plannedBox()).toBeNull();
  });

  it('план остановлен (в архиве) — отметки нет, пропуск не пишется', async () => {
    const { td } = await show(async (s, c) => {
      await addPlan(s, c, { startOn: '2026-10-15', endOn: '2027-01-15' });
      await s.recurring.archive(PLAN_ID);
    });
    await openPayment();
    await settle();
    expect(plannedBox()).toBeNull();
    await savePayment();
    await eventually(async () => expect(await payments(td)).toHaveLength(1));
    expect(await storeOf(td).db.transactions.get(await skipId('2026-10-15'))).toBeUndefined();
  });

  it('долг закрыт — план стоит, отметки нет', async () => {
    await show(async (s, c) => {
      await addPlan(s, c, { startOn: '2026-10-15', endOn: '2027-01-15' });
      await s.debts.close(DEBT_ID);
    });
    await planShown();
    await openPayment();
    await settle();
    expect(plannedBox()).toBeNull();
  });

  it('регулярная выдача по этому долгу на сегодня — не план: отметки нет', async () => {
    await show((s, c) => addPlan(s, c, { kind: 'expense', startOn: '2026-10-15', endOn: '2027-01-15', note: 'ещё в долг' }));
    await openPayment();
    await settle();
    expect(plannedBox()).toBeNull();
  });

  it('пропуск даты не удался — платёж всё равно записан, тост-ошибка подсказывает, что делать', async () => {
    const { td } = await show((s, c) => addPlan(s, c, { startOn: '2026-10-15', endOn: '2027-01-15' }));
    const skip = vi.spyOn(storeOf(td).transactions, 'skipOccurrence').mockRejectedValue(new Error('сбой базы'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openPayment();
    await waitFor(() => expect(plannedBox()?.checked).toBe(true));
    await eraseAmount(3);
    await tapAmount('200');
    await savePayment();
    await eventually(async () => expect(await payments(td)).toHaveLength(1));
    expect(skip).toHaveBeenCalledWith(PLAN_ID, '2026-10-15', { note: 'Оплачено отдельным платежом 15.10.2026' });
    await waitFor(() =>
      expect(alertTexts()).toContain('Платёж записан, но плановый за 15 октября не отмечен: пропустите его в «Регулярных платежах».'),
    );
    expect(statusTexts().some((t) => t.includes('закрыт'))).toBe(false);
    expect(await storeOf(td).db.transactions.get(await skipId('2026-10-15'))).toBeUndefined();
  });
});
