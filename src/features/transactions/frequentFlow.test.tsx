import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user } from '@/components/testUtils';
import type { Store } from '@/db';
import AddTransactionSheet from '@/layout/AddTransactionSheet';
import {
  allTxs,
  amountField,
  clickSave,
  LocationProbe,
  openAddSheet,
  opsDeps,
  pinToday,
  showApp,
  tapAmount,
  unpinToday,
  type OpsDeps,
} from './__fixtures__/opsKit';
import EditTransactionSheet from './EditTransactionSheet';

beforeEach(pinToday); // сегодня — 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const FREQUENT = 'Частые операции';
const openCategories = () => user.click(screen.getByRole('button', { name: /^Категория:/ }));
const strip = () => screen.queryByRole('group', { name: FREQUENT });
const chips = () => Array.from(strip()!.querySelectorAll('button'));
const chip = (name: RegExp) => chips().find((b) => name.test(b.textContent ?? ''))!;

interface Ids {
  cash: string;
  card: string;
  food: string;
  transport: string;
}

/** «Кофе» 15 с. с «Наличных» (Еда) — `coffee` раз; «Такси» 3 с. с карты — `taxi` раз. */
async function seed(s: Store, ids: Ids, { coffee = 3, taxi = 1 } = {}): Promise<void> {
  const wallets = await s.db.wallets.toArray();
  ids.cash = wallets.find((w) => w.name === 'Наличные')!.id;
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const cats = await s.db.categories.toArray();
  ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  ids.transport = cats.find((c) => c.name === 'Транспорт' && c.kind === 'expense')!.id;
  for (let i = 0; i < coffee; i++) {
    await s.transactions.create({ kind: 'expense', walletId: ids.cash, categoryId: ids.food, amountMinor: 1500, note: 'Кофе', occurredOn: `2026-10-0${i + 1}` });
  }
  for (let i = 0; i < taxi; i++) {
    await s.transactions.create({ kind: 'expense', walletId: ids.card, categoryId: ids.transport, amountMinor: 300, note: 'Такси', occurredOn: `2026-10-1${i}` });
  }
}

function deps(opts?: { coffee?: number; taxi?: number }) {
  const ids: Ids = { cash: '', card: '', food: '', transport: '' };
  return { ids, td: opsDeps([], { setup: (s) => seed(s, ids, opts) }) };
}

describe('«Частые операции» в панели категорий новой операции', () => {
  it('пока ничего не повторялось, полосы нет', async () => {
    await openAddSheet(deps({ coffee: 1, taxi: 1 }).td);
    await openCategories();
    expect(strip()).toBeNull();
  });

  it('полоса есть: только повторявшиеся, с суммой; одна «Такси» в неё не попадает; число повторов — в подсказке', async () => {
    await openAddSheet(deps().td);
    await openCategories();
    expect(chips()).toHaveLength(1);
    const text = (chip(/Кофе/).textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Кофе');
    expect(text).toContain('15 с.');
    expect(chip(/Кофе/).title).toBe('Еда · Наличные · 3 раза');
  });

  it('нажатие подставляет кошелёк, категорию, сумму и заметку; «Сохранить» вносит ещё один кофе за сегодня', async () => {
    const { td, ids } = deps();
    await openAddSheet(td);
    await openCategories();
    await user.click(chip(/Кофе/));

    expect(strip()).toBeNull(); // панель закрылась
    expect(amountField().value).toMatch(/^15([.,]00)?$/);
    expect(screen.getByRole('button', { name: 'Категория: Еда' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Кошелёк: Наличные' })).toBeTruthy();

    await clickSave();
    // в базе было 3 кофе и 1 такси
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.deletedAt === null)).toHaveLength(5));
    const created = (await allTxs(td)).filter((t) => t.note === 'Кофе' && t.occurredOn === '2026-10-15');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'expense', walletId: ids.cash, categoryId: ids.food, amountMinor: 1500 });
  });

  it('другой кошелёк и категория у частой операции подставляются тоже', async () => {
    const { td } = deps({ coffee: 1, taxi: 2 });
    await openAddSheet(td);
    await openCategories();
    await user.click(chip(/Такси/));
    expect(screen.getByRole('button', { name: 'Кошелёк: Карта' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Категория: Транспорт' })).toBeTruthy();
  });

  it('при «Сохранить» без категории панель открывается сама — и полоса в ней тоже', async () => {
    await openAddSheet(deps().td);
    await tapAmount('7');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(strip()).not.toBeNull();
  });

  it('у «Дохода» своих частых нет: полосы нет, у «Расхода» она возвращается', async () => {
    await openAddSheet(deps().td);
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await openCategories();
    expect(strip()).toBeNull();
    // панель категорий при смене вида остаётся открытой, как и раньше: полоса в ней сразу по новому виду
    await user.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(strip()).not.toBeNull();
  });

  it('категория в архиве: такая частая операция не предлагается', async () => {
    const { td, ids } = deps();
    const original = td.deps.openStore;
    td.deps.openStore = async (userId) => {
      const store = await original(userId);
      await store.categories.archive(ids.food);
      return store;
    };
    await openAddSheet(td);
    await openCategories();
    expect(strip()).toBeNull();
  });
});

describe('«Повторить» в правке операции', () => {
  /** Правка и новая операция в одном приложении: переход на /add подменяет правку на «Новую операцию». */
  async function openEdit(pick: (ids: Ids) => string, make?: (s: Store, ids: Ids) => Promise<string>) {
    const ids: Ids = { cash: '', card: '', food: '', transport: '' };
    let txId = '';
    const td: OpsDeps = opsDeps([], {
      setup: async (s) => {
        await seed(s, ids, { coffee: 1, taxi: 0 });
        txId = make ? await make(s, ids) : (await s.db.transactions.toArray())[0]!.id;
      },
    });
    function Harness() {
      const { pathname } = useLocation();
      return (
        <>
          {pathname === '/add' ? <AddTransactionSheet onClose={vi.fn()} /> : <EditTransactionSheet id={pick(ids) || txId} onClose={vi.fn()} />}
          <LocationProbe />
        </>
      );
    }
    await showApp(<Harness />, td, '/edit/x');
    await findByRole('dialog', { name: 'Правка операции' });
    return { td, ids };
  }

  it('открывает новую операцию с теми же кошельком, категорией, суммой; дата — сегодня; старая не меняется', async () => {
    const { td, ids } = await openEdit(() => '');
    await user.click(screen.getByRole('button', { name: 'Повторить операцию' }));
    await findByRole('dialog', { name: 'Новая операция' });
    expect(amountField().value).toMatch(/^15([.,]00)?$/);
    expect(screen.getByRole('button', { name: 'Категория: Еда' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Кошелёк: Наличные' })).toBeTruthy();

    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.deletedAt === null)).toHaveLength(2));
    const rows = (await allTxs(td)).filter((t) => t.deletedAt === null);
    expect(rows.map((t) => t.occurredOn).sort()).toEqual(['2026-10-01', '2026-10-15']);
    for (const t of rows) expect(t).toMatchObject({ walletId: ids.cash, categoryId: ids.food, amountMinor: 1500, note: 'Кофе' });
  });

  it('берёт то, что на экране: поправили сумму в правке — повторится поправленная, а сохранённая операция не тронута', async () => {
    const { td } = await openEdit(() => '');
    const field = amountField();
    await user.click(field);
    // «⌫» дважды стирает копейки и единицы, потом набираем 20
    await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: 'Повторить операцию' }));
    await findByRole('dialog', { name: 'Новая операция' });
    expect(amountField().value).toMatch(/^20([.,]00)?$/);
    const original = (await allTxs(td)).find((t) => t.occurredOn === '2026-10-01')!;
    expect(original.amountMinor).toBe(1500);
  });

  it('у операции по долгу кнопки «Повторить» нет', async () => {
    await openEdit(
      () => '',
      async (s, ids) => {
        const debt = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
        return (await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: debt.id })).id;
      },
    );
    expect(screen.queryByRole('button', { name: 'Повторить операцию' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Удалить операцию' })).toBeTruthy();
  });
});
