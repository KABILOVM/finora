import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { RecurringInput, Store } from '@/db';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import { resetAutoPostState } from '@/recurring/autoPostState';
import RecurringPage from './RecurringPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  resetAutoPostState();
  window.localStorage.clear();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const TODAY = '2026-10-15'; // pinToday: четверг 15 октября 2026
const REASON_ERROR = 'Укажите причину, почему сумма изменилась';

interface Ids {
  cash: string;
  salary: string;
}

async function openPage(make: (s: Store, ids: Ids) => Promise<void> = async () => undefined): Promise<OpsDeps> {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      const salary = (await s.db.categories.toArray()).find((c) => c.name === 'Зарплата')?.id ?? '';
      await make(s, { cash, salary });
    },
  });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const income = (s: Store, over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId'>) =>
  s.recurring.create({ kind: 'income', amountMinor: 500_000, frequency: 'monthly', startOn: TODAY, note: 'Зарплата', ...over });

const rules = async (td: OpsDeps) => (await storeOf(td).db.recurring_rules.toArray()).filter((r) => r.deletedAt === null);
const live = async (td: OpsDeps) => (await storeOf(td).db.transactions.toArray()).filter((t) => t.deletedAt === null);
const card = () => document.querySelector('[data-testid="salary-card"]');

/** Кнопка внутри окна по названию (в окне «Провести» есть и заголовок, и кнопка с этим словом). */
function within(root: HTMLElement, name: string): HTMLElement {
  const hit = Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === name);
  if (!hit) throw new Error(`В окне нет кнопки «${name}»`);
  return hit;
}

describe('«Завести «ЗП»»', () => {
  it('платежей нет — карточка есть; кнопка открывает окно, где уже стоят доход, «Зарплата» и раз в месяц', async () => {
    const td = await openPage();
    expect(card()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Завести «ЗП»' }));
    const dlg = await findByRole('dialog', { name: 'Новый регулярный платёж' });
    expect((screen.getByRole('textbox', { name: 'Название или заметка' }) as HTMLInputElement).value).toBe('Зарплата');
    expect(dlg).toHaveTextContent('Получится: Каждый месяц');
    expect(screen.getByRole('switch', { name: 'Проводить само' })).toHaveAttribute('aria-checked', 'false');

    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '5000');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const [r] = await rules(td);
    const salary = (await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Зарплата');
    expect(r).toMatchObject({ kind: 'income', amountMinor: 500_000, frequency: 'monthly', intervalN: 1, note: 'Зарплата', autoPost: 0, categoryId: salary?.id });
    // зарплата заведена — предложение убрано
    await waitFor(() => expect(card()).toBeNull());
  });

  it('есть другие платежи, но зарплаты нет — карточка стоит и там', async () => {
    await openPage(async (s, ids) => {
      await s.recurring.create({ kind: 'expense', amountMinor: 50_000, frequency: 'monthly', startOn: TODAY, walletId: ids.cash, note: 'Аренда' });
    });
    expect(card()).toBeInTheDocument();
  });

  it('уже есть регулярный доход в категории «Зарплата» или с заметкой «ЗП» — карточки нет', async () => {
    await openPage(async (s, ids) => {
      await income(s, { walletId: ids.cash, categoryId: ids.salary, note: 'Оклад' });
    });
    expect(card()).toBeNull();
    expect(screen.getAllByText('Оклад').length).toBeGreaterThan(0);
  });

  it('заметка «ЗП» без категории тоже считается зарплатой', async () => {
    await openPage(async (s, ids) => {
      await income(s, { walletId: ids.cash, note: 'ЗП' });
    });
    expect(card()).toBeNull();
  });

  it('зарплата в архиве — карточка возвращается', async () => {
    await openPage(async (s, ids) => {
      const r = await income(s, { walletId: ids.cash, categoryId: ids.salary });
      await s.recurring.archive(r.id);
    });
    expect(card()).toBeInTheDocument();
  });

  it('«Не нужно» убирает карточку и помнит это на устройстве', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Не нужно' }));
    expect(card()).toBeNull();
    expect(Object.keys(window.localStorage).some((k) => k.startsWith('finora:dismissed-salary-card:'))).toBe(true);
  });

  it('категорию «Зарплата» убрали — окно открывается без категории, сохранить можно', async () => {
    const td = await openPage(async (s, ids) => {
      await s.categories.archive(ids.salary);
    });
    await user.click(screen.getByRole('button', { name: 'Завести «ЗП»' }));
    await findByRole('dialog', { name: 'Новый регулярный платёж' });
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '3000');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [r] = await rules(td);
    expect(r).toMatchObject({ kind: 'income', amountMinor: 300_000, categoryId: null });
  });
});

describe('«Провести» зарплату: причина, если сумма изменилась', () => {
  const open = async () => {
    const td = await openPage(async (s, ids) => {
      await income(s, { walletId: ids.cash, categoryId: ids.salary });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Зарплата/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    return { td, dlg };
  };
  const reasonField = () => screen.queryByRole('textbox', { name: 'Причина изменения суммы' });

  it('сумма как обычно — поля причины нет, операция записывается как в правиле', async () => {
    const { td, dlg } = await open();
    expect(reasonField()).toBeNull();
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await live(td)).toMatchObject([{ kind: 'income', amountMinor: 500_000, note: 'Зарплата' }]);
  });

  it('сумма изменена — появляется поле причины; без неё не провести и ничего не записано', async () => {
    const { td, dlg } = await open();
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '5500');
    expect(reasonField()).toBeInTheDocument();
    expect(dlg).toHaveTextContent('Обычно');

    await user.click(within(dlg, 'Провести'));
    expect(await waitFor(() => screen.getByText(REASON_ERROR))).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Провести платёж' })).toBeInTheDocument();
    expect(await live(td)).toHaveLength(0);
  });

  it('с причиной операция записывается с новой суммой и заметкой «Зарплата (премия)»; правило не меняется', async () => {
    const { td, dlg } = await open();
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '5500');
    await user.type(screen.getByRole('textbox', { name: 'Причина изменения суммы' }), 'премия');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(await live(td)).toMatchObject([{ kind: 'income', amountMinor: 550_000, note: 'Зарплата (премия)' }]);
    const [r] = await rules(td);
    expect(r).toMatchObject({ amountMinor: 500_000, note: 'Зарплата' });
  });

  it('вернули прежнюю сумму — поле причины уходит, и подсказка об ошибке тоже', async () => {
    const { dlg } = await open();
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '4000');
    await user.click(within(dlg, 'Провести'));
    expect(await waitFor(() => screen.getByText(REASON_ERROR))).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '5000');
    expect(reasonField()).toBeNull();
    expect(screen.queryByText(REASON_ERROR)).toBeNull();
  });

  it('расход с другой суммой причину не просит', async () => {
    await openPage(async (s, ids) => {
      await s.recurring.create({ kind: 'expense', amountMinor: 20_000, frequency: 'monthly', startOn: TODAY, walletId: ids.cash, note: 'Свет' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    await findByRole('dialog', { name: 'Провести платёж' });
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '187');
    expect(reasonField()).toBeNull();
  });
});
