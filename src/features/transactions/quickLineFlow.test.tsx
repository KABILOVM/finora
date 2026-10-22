import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { allTxs, amountField, clickSave, openAddSheet, opsDeps, pinToday, unpinToday } from './__fixtures__/opsKit';

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
  salary: string;
}

/** Кошельки «Наличные» и «Карта»; в истории «такси» 3 с. с «Наличных» в «Транспорте». */
async function seed(s: Store, ids: Ids): Promise<void> {
  const wallets = await s.db.wallets.toArray();
  ids.cash = wallets.find((w) => w.name === 'Наличные')!.id;
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const cats = await s.db.categories.toArray();
  ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  ids.transport = cats.find((c) => c.name === 'Транспорт' && c.kind === 'expense')!.id;
  ids.salary = cats.find((c) => c.name === 'Зарплата' && c.kind === 'income')!.id;
  await s.transactions.create({ kind: 'expense', walletId: ids.cash, categoryId: ids.transport, amountMinor: 300, note: 'такси', occurredOn: '2026-10-10' });
}

function deps() {
  const ids: Ids = { cash: '', card: '', food: '', transport: '', salary: '' };
  return { ids, td: opsDeps([], { setup: (s) => seed(s, ids) }) };
}

const openNote = () => user.click(screen.getByRole('button', { name: 'Заметка' }));
const noteField = () => screen.getByRole('textbox', { name: /^Заметка/ });
const strip = () => screen.queryByRole('group', { name: 'Похожие записи' });
const chips = () => (strip() ? Array.from(strip()!.querySelectorAll('button')) : []);
const line = () => chips().find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Применить: '));

async function typeLine(text: string): Promise<void> {
  await openNote();
  await user.type(noteField(), text);
}

describe('ввод одной строкой в заметке', () => {
  it('«такси 20 карта»: первым чипом — «Применить», с суммой, кошельком из строки и категорией из истории', async () => {
    await openAddSheet(deps().td);
    await typeLine('такси 20 карта');
    await waitFor(() => expect(line()).toBeTruthy());
    expect(chips()[0]).toBe(line());
    // между числом и «с.» неразрывный пробел: сравниваем с обычным
    expect((line()!.getAttribute('aria-label') ?? '').replace(/\s/g, ' ')).toBe('Применить: такси, Транспорт · Карта, 20 с.');
  });

  it('нажатие подставляет сумму, кошелёк, категорию и заметку; «Сохранить» вносит расход за сегодня', async () => {
    const { td, ids } = deps();
    await openAddSheet(td);
    await typeLine('такси 20 карта');
    await waitFor(() => expect(line()).toBeTruthy());
    await user.click(line()!);

    expect(strip()).toBeNull(); // панель заметки закрылась
    expect(amountField().value).toMatch(/^20([.,]00)?$/);
    expect(screen.getByRole('button', { name: 'Кошелёк: Карта' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Категория: Транспорт' })).toBeTruthy();

    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.deletedAt === null)).toHaveLength(2));
    const created = (await allTxs(td)).filter((t) => t.occurredOn === '2026-10-15');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'expense', walletId: ids.card, categoryId: ids.transport, amountMinor: 2000, note: 'такси' });
  });

  it('привычный кошелёк из истории, если в строке он не назван', async () => {
    const { td, ids } = deps();
    await openAddSheet(td);
    // выбрана «Карта», но «такси» всегда с «Наличных» — берётся привычный
    await typeLine('такси 25');
    await waitFor(() => expect(line()).toBeTruthy());
    await user.click(line()!);
    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.amountMinor === 2500)).toHaveLength(1));
    expect((await allTxs(td)).find((t) => t.amountMinor === 2500)).toMatchObject({ walletId: ids.cash, categoryId: ids.transport });
  });

  it('«вчера» задаёт дату операции', async () => {
    const { td } = deps();
    await openAddSheet(td);
    await typeLine('такси 20 вчера');
    await waitFor(() => expect(line()).toBeTruthy());
    expect(line()!.getAttribute('aria-label')).toContain('вчера');
    expect(line()!.textContent).toContain('вчера'); // и видно на самом чипе
    await user.click(line()!);
    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.amountMinor === 2000)).toHaveLength(1));
    expect((await allTxs(td)).find((t) => t.amountMinor === 2000)!.occurredOn).toBe('2026-10-14');
  });

  it('сумма из строки главнее ранее набранной', async () => {
    await openAddSheet(deps().td);
    await user.click(screen.getByRole('button', { name: '9' }));
    await typeLine('такси 20');
    await waitFor(() => expect(line()).toBeTruthy());
    await user.click(line()!);
    expect(amountField().value).toMatch(/^20([.,]00)?$/);
  });

  it('не предлагается: нет числа, два числа, «перевод»', async () => {
    await openAddSheet(deps().td);
    await typeLine('яблоко');
    await new Promise((r) => setTimeout(r, 50));
    expect(line()).toBeUndefined();
    await user.clear(noteField());
    await user.keyboard('билеты 2 по 15');
    await new Promise((r) => setTimeout(r, 50));
    expect(line()).toBeUndefined();
  });

  it('у дохода свои категории: «зарплата 5000» находит «Зарплату»', async () => {
    const { td, ids } = deps();
    await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await typeLine('зарплата 5000');
    await waitFor(() => expect(line()).toBeTruthy());
    await user.click(line()!);
    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.kind === 'income')).toHaveLength(1));
    expect((await allTxs(td)).find((t) => t.kind === 'income')).toMatchObject({ categoryId: ids.salary, amountMinor: 500000 });
  });
});
