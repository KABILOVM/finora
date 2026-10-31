import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { choose, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import BudgetsPage from '../BudgetsPage';

/** «Сегодня» = четверг 15 октября 2026 (до конца месяца 17 дней), основная валюта TJS. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const NO_HISTORY = async (s: Store) => {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 900_000, categoryId: null, occurredOn: '2026-10-01' });
};

/**
 * Три прошлых месяца: зарплата 15 000 TJS приходит 1-го, 10 000 TJS уходят на «Еду», 5 000 — на «Развлечения» (тратим всё,
 * что приходит). В октябре пришло 9 000 и пока ничего не потрачено: на руках 9 000.
 */
const WITH_HISTORY = async (s: Store) => {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = new Map((await s.db.categories.toArray()).filter((c) => c.kind === 'expense').map((c) => [c.name, c.id] as const));
  for (const month of ['2026-07', '2026-08', '2026-09']) {
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_500_000, categoryId: null, occurredOn: `${month}-01` });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000_000, categoryId: cats.get('Еда') ?? null, occurredOn: `${month}-10` });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 500_000, categoryId: cats.get('Развлечения') ?? null, occurredOn: `${month}-12` });
  }
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 900_000, categoryId: null, occurredOn: '2026-10-01' });
};

async function openPage(setup: (s: Store) => Promise<void>) {
  const td = opsDeps([table()], { setup });
  await showApp(
    <>
      <BudgetsPage />
      <LocationProbe />
    </>,
    td,
    '/budgets',
  );
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allById = (id: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
const waitById = (id: string) =>
  waitFor(() => {
    const el = byId(id);
    if (!el) throw new Error(`Нет элемента ${id}`);
    return el;
  });
const addGoalButton = () => screen.getAllByRole('button', { name: /^(Поставить цель|Добавить цель накопления)$/ })[0]!;

async function createGoal(name: string, amount: string) {
  await user.click(addGoalButton());
  await user.type(await findByRole('textbox', { name: 'Название' }), name);
  await user.type(screen.getByRole('textbox', { name: /^Сколько накопить/ }), amount);
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('экран «Бюджеты»: цели накопления', () => {
  it('без целей — приглашение поставить первую', async () => {
    await openPage(NO_HISTORY);
    await waitById('goals-empty');
    expect(screen.getByRole('button', { name: 'Поставить цель' })).toBeTruthy();
  });

  it('новая цель сохраняется в основной валюте и сразу даёт план на день', async () => {
    const td = await openPage(NO_HISTORY);
    await createGoal('Отпуск', '3000');

    const goals = await storeOf(td).db.savings_goals.toArray();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ name: 'Отпуск', targetMinor: 300_000, currency: 'TJS', walletId: null, archivedAt: null });

    await findByRole('button', { name: 'Цель «Отпуск»: править' });
    const plan = await waitById('goal-plan');
    expect(plan.textContent).toContain('С учётом целей можно тратить');
    expect(plan.textContent).toContain('Без цели');
    // истории трат нет — разбора по категориям нет, есть пояснение
    expect(plan.textContent).toContain('история трат');
    expect(allById('goal-advice-row')).toHaveLength(0);
  });

  it('пустое название и нулевая сумма не сохраняются', async () => {
    const td = await openPage(NO_HISTORY);
    await user.click(screen.getByRole('button', { name: 'Поставить цель' }));
    await user.click(await findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => screen.getByText('Назовите цель, например «Отпуск»'));
    expect(screen.getByText('Введите сумму больше нуля')).toBeTruthy();
    expect(await storeOf(td).db.savings_goals.toArray()).toHaveLength(0);
  });

  it('с историей трат план раскладывает сокращение по категориям', async () => {
    await openPage(WITH_HISTORY);
    await createGoal('Отпуск', '3000');

    const plan = await waitById('goal-plan');
    await waitFor(() => expect(allById('goal-advice-row').length).toBeGreaterThanOrEqual(2));
    expect(plan.textContent).toContain('сократите привычные траты');
    const rows = allById('goal-advice-row');
    const food = rows.find((r) => r.textContent?.includes('Еда'));
    const fun = rows.find((r) => r.textContent?.includes('Развлечения'));
    expect(food?.textContent).toContain('Не больше');
    expect(fun?.textContent).toContain('Не больше');
  });

  it('обязательная категория выносится в «не трогаем», сокращать приходится остальное', async () => {
    const td = await openPage(WITH_HISTORY);
    await createGoal('Отпуск', '3000');
    await waitById('goal-plan');
    await waitFor(() => expect(allById('goal-advice-row').length).toBeGreaterThanOrEqual(2));

    await user.click(screen.getByRole('button', { name: 'Обязательные категории' }));
    await user.click(await findByRole('switch', { name: 'Обязательная: Еда' }));
    await waitFor(async () => expect((await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')?.essential).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => {
      const food = allById('goal-advice-row').find((r) => r.textContent?.includes('Еда'));
      expect(food?.getAttribute('data-advice')).toBe('essential');
      expect(food?.textContent).toContain('без изменений');
    });
    const fun = allById('goal-advice-row').find((r) => r.textContent?.includes('Развлечения'));
    expect(fun?.getAttribute('data-advice')).not.toBe('essential');
  });

  it('привязанный кошелёк «Накопления» даёт накопленное и отложенное в этом месяце', async () => {
    const td = await openPage(async (s) => {
      await NO_HISTORY(s);
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      const box = await s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '🐷' });
      await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: box.id, amountMinor: 50_000, toAmountMinor: 50_000, categoryId: null, occurredOn: '2026-10-05' });
    });

    await user.click(screen.getByRole('button', { name: 'Поставить цель' }));
    await user.type(await findByRole('textbox', { name: 'Название' }), 'Ноутбук');
    await user.type(screen.getByRole('textbox', { name: /^Сколько накопить/ }), '3000');
    const select = screen.getByRole('combobox', { name: 'Где копите' }) as HTMLSelectElement;
    const box = Array.from(select.options).find((o) => o.textContent === 'Копилка');
    expect(box).toBeTruthy();
    choose('Где копите', 'Копилка');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const row = await waitById('goal-row');
    expect(row.textContent).toContain('Копим в «Копилка»');
    expect(row.textContent).toMatch(/Накоплено .*500.* из .*3.?000/);
    expect(row.textContent).toContain('уже отложено');
    expect((await storeOf(td).db.savings_goals.toArray())[0]?.walletId).toBe(box!.value);
  });

  it('цель можно убрать в архив и вернуть', async () => {
    const td = await openPage(NO_HISTORY);
    await createGoal('Отпуск', '3000');
    await user.click(await findByRole('button', { name: 'Цель «Отпуск»: править' }));
    await user.click(await findByRole('button', { name: 'Убрать в архив' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Цель «Отпуск»: править' })).toBeNull());
    expect((await storeOf(td).db.savings_goals.toArray())[0]?.archivedAt).not.toBeNull();

    await user.click(await findByRole('button', { name: /^Архив целей/ }));
    await user.click(await findByRole('button', { name: 'Вернуть цель: Отпуск' }));
    await findByRole('button', { name: 'Цель «Отпуск»: править' });
  });

  it('цель удаляется после подтверждения и возвращается из уведомления; отмена ничего не удаляет', async () => {
    const td = await openPage(NO_HISTORY);
    await createGoal('Отпуск', '3000');
    const goalRow = () => screen.queryByRole('button', { name: 'Цель «Отпуск»: править' });
    const stored = async () => (await storeOf(td).db.savings_goals.toArray())[0];

    await user.click(await findByRole('button', { name: 'Цель «Отпуск»: править' }));
    await user.click(await findByRole('button', { name: 'Удалить цель' }));
    await user.click(await findByRole('button', { name: 'Отмена' }));
    expect((await stored())?.deletedAt).toBeNull();

    await user.click(await findByRole('button', { name: 'Удалить цель' }));
    await user.click(await findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(goalRow()).toBeNull());
    expect((await stored())?.deletedAt).not.toBeNull();
    // после удаления форма закрыта и приглашение поставить цель снова на месте
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitById('goals-empty');

    await user.click(await findByRole('button', { name: 'Вернуть' }));
    await findByRole('button', { name: 'Цель «Отпуск»: править' });
    expect((await stored())?.deletedAt).toBeNull();
  });

  it('цель из архива можно удалить насовсем (скрыть)', async () => {
    const td = await openPage(NO_HISTORY);
    await createGoal('Отпуск', '3000');
    await user.click(await findByRole('button', { name: 'Цель «Отпуск»: править' }));
    await user.click(await findByRole('button', { name: 'Убрать в архив' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Цель «Отпуск»: править' })).toBeNull());

    await user.click(await findByRole('button', { name: /^Архив целей/ }));
    await user.click(await findByRole('button', { name: 'Удалить цель: Отпуск' }));
    await user.click(await findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Вернуть цель: Отпуск' })).toBeNull());
    expect((await storeOf(td).db.savings_goals.toArray())[0]?.deletedAt).not.toBeNull();
  });
});
