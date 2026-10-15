import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import BudgetAlerts from './BudgetAlerts';
import BudgetsPage from './BudgetsPage';
import { budgetAlertsEnabled, setBudgetAlertsEnabled } from './budgetAlertsPref';

beforeEach(() => {
  pinToday();
  window.localStorage.clear();
  setBudgetAlertsEnabled(true);
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const toasts = () => Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map((e) => norm(e.textContent)).filter((t) => t.includes('лимит') || t.includes('Лимит') || t.includes('потрачено'));
const settle = () => new Promise((r) => setTimeout(r, 80));

interface Ids {
  cash: string;
  food: string;
  transport: string;
  groceries: string;
}
const ids = async (s: Store): Promise<Ids> => {
  const cats = await s.db.categories.toArray();
  const id = (name: string) => cats.find((c) => c.name === name && c.kind === 'expense')!.id;
  return { cash: (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id, food: id('Еда'), transport: id('Транспорт'), groceries: id('Продукты') };
};

/** Бюджет «Еда» 1 000 с.; трата на начало — `initial` минорных единиц. */
async function open(options: { initial?: number; more?: (s: Store, i: Ids) => Promise<unknown> } = {}) {
  let i: Ids = { cash: '', food: '', transport: '', groceries: '' };
  const td = opsDeps([table()], {
    setup: async (s) => {
      i = await ids(s);
      await s.budgets.create({ categoryId: i.food, amountMinor: 100_000 });
      if (options.initial) await spend(s, i, options.initial);
      await options.more?.(s, i);
    },
  });
  const checked = vi.fn();
  await showApp(
    <>
      <BudgetAlerts onChecked={checked} />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await waitFor(() => expect(checked).toHaveBeenCalled()); // первая проверка уровней сделана (молча): дальше любые траты — «новые»
  return { td, i };
}

const spend = (s: Store, i: Ids, amountMinor: number, categoryId = i.food) =>
  s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor, categoryId, occurredOn: '2026-10-15' });
const add = (td: OpsDeps, i: Ids, amountMinor: number, categoryId = i.food) => spend(storeOf(td), i, amountMinor, categoryId);
const shown = (re: RegExp) => waitFor(() => expect(toasts().some((t) => re.test(t))).toBe(true));

describe('подсказки «лимит на исходе»', () => {
  it('при запуске молчат, даже если лимит давно превышен', async () => {
    const { td, i } = await open({
      initial: 120_000,
      more: (s, ids2) => s.budgets.create({ categoryId: ids2.transport, amountMinor: 100_000 }),
    });
    // контроль, что наблюдатель уже работает: свежий подъём уровня по другому лимиту подсказку даёт, а старое превышение «Еды» — нет
    await add(td, i, 75_000, i.transport);
    await shown(/«Транспорт»: потрачено 75%/);
    expect(toasts().filter((t) => t.includes('Еда'))).toEqual([]);
  });

  it('70%: «потрачено 75% лимита. Осталось 250 с.»', async () => {
    const { td, i } = await open({ initial: 60_000 });
    await add(td, i, 15_000);
    await shown(/«Еда»: потрачено 75% лимита\. Осталось/);
    expect(toasts().find((t) => t.includes('75%'))).toContain(`Осталось ${fmt(25_000)}`);
  });

  it('до 70% — тишина; 90% и 100% — отдельные подсказки; пока лимит превышен, новые траты молчат', async () => {
    const { td, i } = await open({ initial: 10_000 });
    await add(td, i, 50_000); // 60%
    await add(td, i, 15_000); // 75%
    await shown(/потрачено 75%/);
    await add(td, i, 20_000); // 95%
    await shown(/потрачено 95%/);
    await add(td, i, 10_000); // 105%
    await shown(/Лимит «Еда» исчерпан: превышен на/);
    expect(toasts().find((t) => t.includes('исчерпан'))).toContain(fmt(5_000));
    // на 60% подсказки не было: только три — 75%, 95% и превышение
    expect(toasts().filter((t) => t.includes('Еда'))).toHaveLength(3);
    const before = toasts().length;
    await add(td, i, 3_000);
    await settle();
    expect(toasts()).toHaveLength(before);
  });

  it('перескочили лимит одной тратой: одна подсказка про превышение, без «70%» и «90%»', async () => {
    const { td, i } = await open({ initial: 10_000 });
    await add(td, i, 110_000);
    await shown(/Лимит «Еда» исчерпан/);
    expect(toasts().filter((t) => t.includes('потрачено'))).toEqual([]);
  });

  it('трату удалили и снова превысили — подсказка повторяется', async () => {
    const { td, i } = await open({ initial: 10_000 });
    const t = await add(td, i, 80_000); // 90%
    await shown(/потрачено 90%/);
    await storeOf(td).transactions.softDelete(t.id);
    await settle();
    await add(td, i, 82_000);
    await waitFor(() => expect(toasts().filter((x) => x.includes('потрачено 92%')).length).toBe(1));
  });

  it('новый лимит, который уже на 90%, — молча', async () => {
    const { td, i } = await open({ initial: 95_000 });
    await storeOf(td).budgets.create({ categoryId: i.transport, amountMinor: 10_000 });
    await add(td, i, 9_500, i.transport);
    // 95% транспорта: лимит появился раньше этой траты — подсказка есть (уровень вырос с «ok»); а вот «Еда» (уже на 95%) не повторяется
    await shown(/«Транспорт»: потрачено 95%/);
    expect(toasts().filter((t) => t.includes('«Еда»'))).toEqual([]);
  });

  it('сразу несколько лимитов на исходе — одна общая подсказка', async () => {
    const { td, i } = await open({
      more: async (s, ids2) => {
        await s.budgets.create({ categoryId: ids2.transport, amountMinor: 100_000 });
        await s.budgets.create({ categoryId: ids2.groceries, amountMinor: 100_000 });
      },
    });
    const s = storeOf(td);
    await s.db.transaction('rw', [s.db.transactions, s.db.wallets, s.db.categories, s.db.settings, s.db.debts, s.db.recurring_rules, s.db.meta, s.db.budgets], async () => {
      for (const c of [i.food, i.transport, i.groceries]) await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 95_000, categoryId: c, occurredOn: '2026-10-15' });
    });
    await shown(/3 лимита на исходе или превышены/);
    expect(toasts().filter((t) => t.includes('потрачено'))).toEqual([]);
  });

  it('действие «Бюджеты» открывает экран бюджетов', async () => {
    const { td, i } = await open({ initial: 10_000 });
    await add(td, i, 70_000);
    await shown(/потрачено 80%/);
    await user.click(screen.getByRole('button', { name: 'Бюджеты' }));
    await waitFor(() => expect(currentPath()).toBe('/budgets'));
  });

  it('выключено: тишина, а уровни запоминаются — включили и тратим дальше, старое не повторяется', async () => {
    setBudgetAlertsEnabled(false);
    const { td, i } = await open({ initial: 10_000 });
    await add(td, i, 70_000); // 80% при выключенных подсказках
    await settle();
    setBudgetAlertsEnabled(true);
    await add(td, i, 12_000); // 92%
    await shown(/потрачено 92%/);
    // 80% случилось при выключенных подсказках: после включения оно не «догоняет»
    expect(toasts().filter((t) => t.includes('80%'))).toEqual([]);
    expect(toasts().filter((t) => t.includes('Еда'))).toHaveLength(1);
  });
});

describe('переключатель на экране «Бюджеты»', () => {
  it('«Подсказки о лимитах» включены по умолчанию; выключение запоминается', async () => {
    const td = opsDeps([table()], {
      setup: async (s) => {
        const i = await ids(s);
        await s.budgets.create({ categoryId: i.food, amountMinor: 100_000 });
      },
    });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    const sw = await waitFor(() => screen.getByRole('switch', { name: 'Подсказки о лимитах' }));
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(budgetAlertsEnabled()).toBe(false);
    expect(window.localStorage.getItem('finora:budget-alerts')).toBe('off');
    await user.click(sw);
    expect(budgetAlertsEnabled()).toBe(true);
    expect(window.localStorage.getItem('finora:budget-alerts')).toBeNull();
  });

  it('без лимитов переключателя нет', async () => {
    await showApp(<BudgetsPage />, opsDeps([table()]), '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
    expect(screen.queryByRole('switch', { name: 'Подсказки о лимитах' })).toBeNull();
  });

  it('localStorage недоступен: настройка живёт в памяти, ошибок нет', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    setBudgetAlertsEnabled(false);
    expect(budgetAlertsEnabled()).toBe(false);
    setBudgetAlertsEnabled(true);
    expect(budgetAlertsEnabled()).toBe(true);
  });
});
