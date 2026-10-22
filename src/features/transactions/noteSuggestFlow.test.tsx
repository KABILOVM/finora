import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { allTxs, amountField, clickSave, openAddSheet, opsDeps, pinToday, tapAmount, unpinToday } from './__fixtures__/opsKit';

beforeEach(pinToday); // сегодня — 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

interface Ids {
  cash: string;
  card: string;
  food: string;
  transport: string;
}

/** «Кофе с собой» 20 с. с «Карты» (Еда) ×2; «Такси» 3 с. с «Наличных» (Транспорт) ×1; один доход «Кофе-бонус». */
async function seed(s: Store, ids: Ids): Promise<void> {
  const wallets = await s.db.wallets.toArray();
  ids.cash = wallets.find((w) => w.name === 'Наличные')!.id;
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const cats = await s.db.categories.toArray();
  ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  ids.transport = cats.find((c) => c.name === 'Транспорт' && c.kind === 'expense')!.id;
  for (const d of ['2026-10-01', '2026-10-08']) {
    await s.transactions.create({ kind: 'expense', walletId: ids.card, categoryId: ids.food, amountMinor: 2000, note: 'Кофе с собой', occurredOn: d });
  }
  await s.transactions.create({ kind: 'expense', walletId: ids.cash, categoryId: ids.transport, amountMinor: 300, note: 'Такси', occurredOn: '2026-10-10' });
}

function deps() {
  const ids: Ids = { cash: '', card: '', food: '', transport: '' };
  return { ids, td: opsDeps([], { setup: (s) => seed(s, ids) }) };
}

const openNote = () => user.click(screen.getByRole('button', { name: 'Заметка' }));
const noteField = () => screen.getByRole('textbox', { name: /^Заметка/ });
const group = () => screen.queryByRole('group', { name: 'Похожие записи' });
const options = () => (group() ? Array.from(group()!.querySelectorAll('button')) : []);

/** Печатает в поле заметки; ждёт, пока индекс заметок прочитается и подсказки появятся (или не появятся). */
async function typeNote(text: string): Promise<void> {
  await openNote();
  await user.type(noteField(), text);
}

describe('подсказки по заметке в новой операции', () => {
  it('пока ничего не набрано, подсказок нет', async () => {
    await openAddSheet(deps().td);
    await openNote();
    await new Promise((r) => setTimeout(r, 50));
    expect(group()).toBeNull();
  });

  it('набираем «ко» — видим «Кофе с собой» с категорией, кошельком и суммой; «Такси» не мешает', async () => {
    await openAddSheet(deps().td);
    await typeNote('ко');
    await waitFor(() => expect(options()).toHaveLength(1));
    const text = (options()[0]!.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ');
    expect(text).toBe('Кофе с собой, Еда · Карта, 20 с.');
    expect(options()[0]!.title).toBe('Еда · Карта');
  });

  it('ничего похожего — подсказок нет', async () => {
    await openAddSheet(deps().td);
    await typeNote('яблоко');
    await new Promise((r) => setTimeout(r, 50));
    expect(group()).toBeNull();
  });

  it('пока подсказки есть, они стоят на месте «Готово»; без подсказок «Готово» на месте', async () => {
    await openAddSheet(deps().td);
    await openNote();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy();
    await user.type(noteField(), 'ко');
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull();
    await user.clear(noteField());
    await waitFor(() => expect(group()).toBeNull());
    expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy();
  });

  it('нажатие подставляет заметку, категорию, кошелёк и сумму; «Сохранить» вносит операцию', async () => {
    const { td, ids } = deps();
    await openAddSheet(td);
    await typeNote('ко');
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.click(options()[0]!);

    expect(group()).toBeNull(); // панель заметки закрылась
    expect(amountField().value).toMatch(/^20([.,]00)?$/);
    expect(screen.getByRole('button', { name: 'Категория: Еда' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Кошелёк: Карта' })).toBeTruthy();

    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.deletedAt === null)).toHaveLength(4));
    const created = (await allTxs(td)).filter((t) => t.occurredOn === '2026-10-15');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'expense', walletId: ids.card, categoryId: ids.food, amountMinor: 2000, note: 'Кофе с собой' });
  });

  it('уже набранная сумма главнее подсказки: заметка, категория и кошелёк подставляются, сумма остаётся', async () => {
    const { td } = deps();
    await openAddSheet(td);
    await tapAmount('45');
    await typeNote('ко');
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.click(options()[0]!);
    expect(amountField().value).toMatch(/^45([.,]00)?$/);
    expect(screen.getByRole('button', { name: 'Категория: Еда' })).toBeTruthy();
    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.amountMinor === 4500)).toHaveLength(1));
  });

  it('у дохода свои подсказки: расходные заметки в нём не предлагаются', async () => {
    await openAddSheet(deps().td);
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await typeNote('ко');
    await new Promise((r) => setTimeout(r, 50));
    expect(group()).toBeNull();
  });

  it('категория в архиве: такая подсказка не показывается', async () => {
    const { td, ids } = deps();
    const original = td.deps.openStore;
    td.deps.openStore = async (userId) => {
      const store = await original(userId);
      await store.categories.archive(ids.food);
      return store;
    };
    await openAddSheet(td);
    await typeNote('ко');
    await new Promise((r) => setTimeout(r, 50));
    expect(group()).toBeNull();
  });
});
