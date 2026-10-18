import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { formatMinor } from '@/domain/money';
import { LocationProbe, opsDeps, pinToday, showApp, storeOf, table, tapAmount, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import PersonDebtsPage from './PersonDebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null | undefined) => norm(el?.textContent);
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

type Setup = (s: Store) => Promise<unknown>;
const lend = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });
const borrow = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) => lend(s, { direction: 'borrowed', principalMinor: 20_000, ...over });

function App() {
  return (
    <>
      <Routes>
        <Route path="/debts/people/:key" element={<PersonDebtsPage />} />
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>
  );
}

async function open(setup: Setup | undefined, path: string, heading: string, tables = [table()]) {
  const td = opsDeps(tables, { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(<App />, td, path);
  await findByRole('heading', { name: heading, level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const person = `/debts/people/${encodeURIComponent('алишер')}`;
const totalRow = (cur: string, label: string): string => {
  const dt = Array.from(document.querySelectorAll(`[data-testid="person-total-${cur}"] dt`)).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};
const balances = async (td: OpsDeps) => {
  const s = storeOf(td);
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray());
};
const cashOf = async (td: OpsDeps) => (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;

describe('взаимозачёт на странице человека', () => {
  const both = async (s: Store) => {
    await lend(s, { principalMinor: 50_000 });
    await borrow(s, { principalMinor: 20_000 });
  };

  it('кнопка с суммой зачёта; в окне видно, что станет с каждым долгом; зачёт записывается и долги уменьшаются', async () => {
    const td = await open(both, person, 'Алишер');
    const before = await balances(td);
    await user.click(screen.getByRole('button', { name: `Взаимозачёт: ${fmt(20_000)}` }));
    await findByRole('dialog', { name: 'Взаимозачёт' });
    const preview = tid('netting-preview')!;
    const rows = Array.from(preview.querySelectorAll('li')).map((li) => text(li));
    expect(rows).toEqual([`от 01.10.2026 ${fmt(50_000)} → станет ${fmt(30_000)}`, `от 01.10.2026 ${fmt(20_000)} → станет ${fmt(0)}`]);
    await user.click(screen.getByRole('button', { name: `Зачесть ${fmt(20_000)}` }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Взаимозачёт' })).toBeNull());

    await waitFor(() => expect(totalRow('TJS', 'Вам должны')).toBe(fmt(30_000)));
    expect(totalRow('TJS', 'Вы должны')).toBe('');
    expect(await balances(td)).toEqual(before); // деньги в кошельке не изменились
    const txs = (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId != null);
    expect(txs.map((t) => [t.kind, t.amountMinor, t.note, t.occurredOn]).sort()).toEqual([
      ['expense', 20_000, 'Взаимозачёт', '2026-10-15'],
      ['income', 20_000, 'Взаимозачёт', '2026-10-15'],
    ]);
  });

  it('«Отменить» в тосте возвращает оба долга', async () => {
    const td = await open(both, person, 'Алишер');
    await user.click(screen.getByRole('button', { name: /^Взаимозачёт: / }));
    await findByRole('dialog', { name: 'Взаимозачёт' });
    await user.click(screen.getByRole('button', { name: /^Зачесть / }));
    await waitFor(() => expect(totalRow('TJS', 'Вам должны')).toBe(fmt(30_000)));
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Отменить' })));
    await waitFor(() => expect(totalRow('TJS', 'Вы должны')).toBe(fmt(20_000)));
    expect(totalRow('TJS', 'Вам должны')).toBe(fmt(50_000));
    expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId != null && t.deletedAt === null)).toHaveLength(0);
  });

  it('после полного зачёта сторон не осталось: кнопки «Взаимозачёт» нет', async () => {
    await open(async (s) => {
      await lend(s, { principalMinor: 20_000 });
      await borrow(s, { principalMinor: 20_000 });
    }, person, 'Алишер');
    await user.click(screen.getByRole('button', { name: /^Взаимозачёт: / }));
    await findByRole('dialog', { name: 'Взаимозачёт' });
    await user.click(screen.getByRole('button', { name: /^Зачесть / }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Взаимозачёт: / })).toBeNull());
  });

  it('нет второй стороны или разные валюты — кнопки нет', async () => {
    await open(async (s) => {
      await lend(s, { principalMinor: 50_000 });
      await borrow(s, { principalMinor: 2_000, currency: 'USD' });
    }, person, 'Алишер');
    expect(screen.queryByRole('button', { name: /^Взаимозачёт: / })).toBeNull();
  });

  it('несколько валют — по кнопке на каждую', async () => {
    await open(async (s) => {
      await both(s);
      await lend(s, { principalMinor: 3_000, currency: 'USD' });
      await borrow(s, { principalMinor: 1_000, currency: 'USD' });
    }, person, 'Алишер');
    expect(screen.getByRole('button', { name: `Взаимозачёт: ${fmt(20_000)}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Взаимозачёт: ${fmt(1_000, 'USD')}` })).toBeTruthy();
  });

  it('нет кошелька в валюте долгов — понятное сообщение, кнопка записи недоступна', async () => {
    await open(async (s) => {
      await lend(s, { principalMinor: 3_000, currency: 'EUR' });
      await borrow(s, { principalMinor: 1_000, currency: 'EUR' });
    }, person, 'Алишер');
    await user.click(screen.getByRole('button', { name: /^Взаимозачёт: / }));
    await findByRole('dialog', { name: 'Взаимозачёт' });
    expect(text(document.querySelector('[role="alert"]'))).toContain('Нет кошелька в валюте EUR');
    expect((screen.getByRole('button', { name: /^Зачесть / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('несколько долгов с каждой стороны: превью показывает каждый, итог — меньшая сторона', async () => {
    await open(async (s) => {
      await lend(s, { principalMinor: 30_000 });
      await lend(s, { principalMinor: 50_000, openedOn: '2026-10-03' });
      await borrow(s, { principalMinor: 20_000 });
      await borrow(s, { principalMinor: 40_000, openedOn: '2026-10-04' });
    }, person, 'Алишер');
    await user.click(screen.getByRole('button', { name: `Взаимозачёт: ${fmt(60_000)}` }));
    await findByRole('dialog', { name: 'Взаимозачёт' });
    const after = Array.from(tid('netting-preview')!.querySelectorAll('li')).map((li) => text(li).split('→ станет ')[1]);
    expect(after.sort()).toEqual([fmt(0), fmt(0), fmt(0), fmt(20_000)].sort());
  });
});

describe('«Платить частями» на странице долга', () => {
  const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a2222';
  const create = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) =>
    lend(s, { principalMinor: 50_000, ...over }).then((d) => d); // id задаётся ниже, у конкретных тестов
  void create;

  async function show(over: Partial<Parameters<Store['debts']['create']>[0]> = {}, after?: (s: Store, id: string) => Promise<unknown>) {
    const td = opsDeps([table()], {
      setup: async (s) => {
        const d = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over }, { id: DEBT_ID });
        await after?.(s, d.id);
      },
    });
    await showApp(<App />, td, `/debts/${DEBT_ID}`);
    await findByRole('heading', { name: 'Алишер', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    return td;
  }
  const openSheet = async (title: string) => {
    await user.click(screen.getByRole('button', { name: title }));
    return findByRole('dialog', { name: title });
  };
  const rules = async (td: OpsDeps) => (await storeOf(td).db.recurring_rules.toArray()).filter((r) => r.deletedAt === null);

  it('«мне должны»: «Получать частями»; «я должен»: «Платить частями»', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Получать частями' })).toBeTruthy();
  });

  it('«я должен» — «Платить частями»', async () => {
    await show({ direction: 'borrowed' });
    expect(screen.getByRole('button', { name: 'Платить частями' })).toBeTruthy();
  });

  it('сумма в месяц → сколько платежей и когда долг закроется; последний платёж меньше — сказано', async () => {
    await show();
    await openSheet('Получать частями');
    await tapAmount('150');
    const preview = text(tid('payoff-preview'));
    expect(preview).toContain('Долг закроется 15 января: 4 платежа'); // 500 ÷ 150, с 15 октября
    expect(preview).toContain(`Последний платёж — ${fmt(5_000)}: запишется на остаток долга`);
  });

  it('«На 3 мес.» подставляет сумму с округлением вверх; ровно делится — без пометки про последний платёж', async () => {
    await show({ principalMinor: 60_000 });
    await openSheet('Получать частями');
    await user.click(screen.getByRole('button', { name: 'На 3 мес.' }));
    expect(text(tid('payoff-preview'))).toContain('Долг закроется 15 декабря: 3 платежа');
    expect(text(tid('payoff-preview'))).not.toContain('Последний платёж');
    await user.click(screen.getByRole('button', { name: 'На 12 мес.' }));
    expect(text(tid('payoff-preview'))).toContain('12 платежей');
  });

  it('сохранение: регулярный платёж «раз в месяц» по долгу с датой окончания; «Проводить само» — по галочке', async () => {
    const td = await show();
    await openSheet('Получать частями');
    await tapAmount('150');
    await user.click(screen.getByRole('checkbox', { name: /Проводить само/ }));
    await user.click(screen.getByRole('button', { name: 'Создать платежи' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Получать частями' })).toBeNull());
    const [rule] = await rules(td);
    expect(rule).toMatchObject({ kind: 'income', debtId: DEBT_ID, amountMinor: 15_000, frequency: 'monthly', intervalN: 1, startOn: '2026-10-15', endOn: '2027-01-15', autoPost: 1, note: 'Долг: Алишер' });
  });

  it('«я должен»: платёж — расход', async () => {
    const td = await show({ direction: 'borrowed' });
    await openSheet('Платить частями');
    await tapAmount('250');
    await user.click(screen.getByRole('button', { name: 'Создать платежи' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Платить частями' })).toBeNull());
    expect((await rules(td))[0]).toMatchObject({ kind: 'expense', amountMinor: 25_000, endOn: '2026-11-15', autoPost: 0 });
  });

  it('без суммы: ошибка у поля, правило не создано', async () => {
    const td = await show();
    await openSheet('Получать частями');
    await user.click(screen.getByRole('button', { name: 'Создать платежи' }));
    expect(text(document.querySelector('[role="alert"]'))).toContain('Введите сумму платежа');
    expect(await rules(td)).toHaveLength(0);
  });

  it('слишком мелкие платежи (больше 50 лет) — предупреждение и отказ', async () => {
    const td = await show({ principalMinor: 100_000_000 });
    await openSheet('Получать частями');
    await tapAmount('1');
    expect(text(tid('payoff-preview'))).toContain('больше 50 лет');
    await user.click(screen.getByRole('button', { name: 'Создать платежи' }));
    expect(await rules(td)).toHaveLength(0);
  });

  it('кнопки нет у закрытого долга и у погашенного', async () => {
    await show({}, (s, id) => s.debts.close(id));
    expect(screen.queryByRole('button', { name: 'Получать частями' })).toBeNull();
  });

  it('новые платежи видны в «Платежах»: правило есть среди регулярных платежей по этому долгу', async () => {
    const td = await show();
    await openSheet('Получать частями');
    await tapAmount('250');
    await user.click(screen.getByRole('button', { name: 'Создать платежи' }));
    await waitFor(async () => expect(await rules(td)).toHaveLength(1));
    expect((await rules(td))[0]!.debtId).toBe(DEBT_ID);
    void cashOf;
  });
});
