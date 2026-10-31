import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMenuAction, findByRole, menuActionsStable, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { LocationProbe, opsDeps, pinToday, showApp, storeOf, table, tapAmount, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/** Объединённый долг: два кредита банка с РАЗНЫМИ условиями и «Али» отдельно. */
const MAIN = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a2001';
const PART = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a2002';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const text = (el: Element | null) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const closed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

async function seed(s: Store) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 2_000_000, occurredOn: '2026-09-30' });
  const bank = { direction: 'borrowed', counterparty: 'Банк', currency: 'TJS' } as const;
  // кредит 1: 10 000 + проценты 1 347,15 (24 % на 12 мес.), срок 01.12.2026
  await s.debts.create({ ...bank, principalMinor: 1_000_000, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01', dueOn: '2026-12-01' }, { id: MAIN });
  // кредит 2: 5 000 + проценты 300 (12 % на 6 мес.), срок 15.11.2026
  await s.debts.create({ ...bank, principalMinor: 500_000, interestMinor: 30_000, interestRateBp: 1200, termMonths: 6, openedOn: '2026-10-10', dueOn: '2026-11-15' }, { id: PART });
  await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 94_560, occurredOn: '2026-10-20', debtId: MAIN }); // платёж по кредиту 1
  await s.debts.merge(MAIN, [PART]);
  await s.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' });
  return cash;
}

async function show(path: string) {
  const td = opsDeps([table()], { setup: async (s) => void (await seed(s)) });
  await showApp(
    <>
      <Routes>
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    path,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}
const debtOf = (td: OpsDeps, id: string) => storeOf(td).db.debts.get(id);

describe('объединённый долг в списке', () => {
  it('идёт одной строкой с общей суммой и пометкой «2 долга»; составляющая отдельной строкой не показывается', async () => {
    await show('/debts?dir=borrowed');
    await waitFor(() => expect(document.querySelector('a[href="/debts/' + MAIN + '"]')).not.toBeNull());
    // на вкладке «Я должен» одна строка — «Банк»; «Али» на другой вкладке, а вторая составляющая внутри «Банка»
    const rows = Array.from(document.querySelectorAll('a[href^="/debts/"]')).filter((a) => /^\/debts\/[0-9a-f-]{36}$/.test(a.getAttribute('href') ?? ''));
    expect(rows).toHaveLength(1);
    const row = document.querySelector('a[href="/debts/' + MAIN + '"]')!;
    expect(text(row)).toContain('Банк');
    expect(text(row)).toContain('2 долга');
    // остаток = сумма остатков частей: (10 000 + 1 347,15 − 945,60) + (5 000 + 300)
    const remaining = 1_134_715 - 94_560 + 530_000;
    expect(text(row)).toContain(fmt(remaining));
    expect(document.querySelector('a[href="/debts/' + PART + '"]')).toBeNull();
  });
});

describe('страница объединённого долга', () => {
  it('сверху итог, ниже «Из чего состоит» — у каждой составляющей свои проценты, ставка, срок возврата и дата', async () => {
    await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит · 2/ });
    const remaining = 1_134_715 - 94_560 + 530_000;
    expect(text(tid('debt-remaining'))).toBe(fmt(remaining));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="debt-part"]'));
    expect(cards).toHaveLength(2);
    const [first, second] = cards.map(text);
    expect(first).toContain('Долг от 01.10.2026');
    expect(first).toContain(fmt(1_000_000 + 134_715 - 94_560)); // остаток этой части
    expect(first).toContain('24 % годовых');
    expect(first).toContain('12 месяцев');
    expect(first).toContain('01.12.2026');
    expect(first).toContain('платежей: 1');
    expect(second).toContain('Долг от 10.10.2026');
    expect(second).toContain(fmt(530_000));
    expect(second).toContain('12 % годовых');
    expect(second).toContain('6 месяцев');
    expect(second).toContain('15.11.2026');
    expect(second).not.toContain('платежей:');
  });

  it('меню объединения: «Разъединить», «Закрыть все долги», «В архив»; «Править» и «Удалить» только у самих долгов', async () => {
    await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит/ });
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull();
    const names = await menuActionsStable();
    expect(names).toEqual(expect.arrayContaining(['Разъединить', 'Закрыть все долги', 'В архив']));
    expect(names).not.toContain('Удалить долг');
  });

  it('«Платёж» у составляющей записывает платёж именно по ней: остаток этой части уменьшился, остальных — нет', async () => {
    const td = await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит/ });
    await user.click(button(/^Платёж: Долг от 10\.10\.2026 · /));
    await findByRole('dialog', { name: 'Платёж по долгу' });
    // по умолчанию — весь остаток части; платим 1 000
    for (let i = 0; i < 9; i++) await user.click(button('Стереть')); // стираем предложенный остаток, потом вводим свою сумму
    await tapAmount('1000');
    await user.click(button('Записать платёж'));
    await closed('Платёж по долгу');
    const txs = (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId !== null && t.deletedAt === null && t.kind === 'expense' && t.amountMinor === 100_000);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.debtId).toBe(PART);
    await waitFor(() => {
      const second = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="debt-part"]')).map(text)[1]!;
      expect(second).toContain(fmt(430_000));
    });
    const first = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="debt-part"]')).map(text)[0]!;
    expect(first).toContain(fmt(1_000_000 + 134_715 - 94_560)); // первая часть не тронута
  });

  it('«Добавить платёж»: сначала «Какой долг платите?» — ближайший срок первым; выбор открывает платёж по нему', async () => {
    const td = await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит/ });
    await user.click(button('Добавить платёж'));
    const dlg = await findByRole('dialog', { name: 'Какой долг платите?' });
    const options = Array.from(dlg.querySelectorAll('ul button'));
    expect(options).toHaveLength(2);
    expect(text(options[0]!)).toContain('Долг от 10.10.2026'); // срок 15.11 раньше, чем 01.12
    expect(text(options[0]!)).toContain('ближайший');
    expect(text(options[1]!)).toContain('Долг от 01.10.2026');
    await user.click(options[0] as HTMLElement);
    await findByRole('dialog', { name: 'Платёж по долгу' });
    await user.click(button('Записать платёж')); // платёж на весь остаток части (по умолчанию)
    await closed('Платёж по долгу');
    const paid = (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId === PART && t.kind === 'expense');
    expect(paid).toHaveLength(1);
    expect(paid[0]!.amountMinor).toBe(530_000);
  });

  it('«Открыть» ведёт на страницу составляющей: там только она сама, плашка «Входит в объединённый долг», меню «Вывести из объединения»', async () => {
    const td = await show(`/debts/${PART}`);
    await findByRole('button', { name: 'Править' });
    expect(text(document.body)).toContain('Входит в объединённый долг «Банк»');
    expect(text(tid('debt-remaining'))).toBe(fmt(530_000)); // свой остаток, а не итог
    const link = screen.getByRole('link', { name: 'Весь объединённый долг' });
    expect(link.getAttribute('href')).toBe(`/debts/${MAIN}`);
    expect(await menuActionsStable()).toContain('Вывести из объединения');
    await chooseMenuAction('Вывести из объединения');
    await waitFor(async () => expect((await debtOf(td, PART))!.mergedIntoId).toBeNull());
    await waitFor(() => expect(text(document.body)).not.toContain('Входит в объединённый долг'));
    // «Отменить» возвращает объединение
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect((await debtOf(td, PART))!.mergedIntoId).toBe(MAIN));
  });

  it('главный долг с «?own=1»: только он сам и плашка «Весь объединённый долг»', async () => {
    await show(`/debts/${MAIN}?own=1`);
    await findByRole('button', { name: 'Править' });
    expect(text(tid('debt-remaining'))).toBe(fmt(1_000_000 + 134_715 - 94_560));
    expect(text(document.body)).toContain('Это один из долгов объединения');
    expect(screen.getByRole('link', { name: 'Весь объединённый долг' }).getAttribute('href')).toBe(`/debts/${MAIN}`);
  });

  it('«Разъединить»: каждый снова отдельный долг со своими платежами; «Отменить» возвращает объединение', async () => {
    const td = await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит/ });
    await chooseMenuAction('Разъединить');
    const dlg = await findByRole('alertdialog', { name: 'Разъединить долги?' });
    await user.click(Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === 'Разъединить')!);
    await waitFor(async () => expect((await debtOf(td, PART))!.mergedIntoId).toBeNull());
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Из чего состоит/ })).toBeNull()); // страница стала обычной
    expect(text(tid('debt-remaining'))).toBe(fmt(1_000_000 + 134_715 - 94_560));
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect((await debtOf(td, PART))!.mergedIntoId).toBe(MAIN));
    await findByRole('heading', { name: /Из чего состоит · 2/ });
  });

  it('«В архив» убирает в архив все составляющие сразу', async () => {
    const td = await show(`/debts/${MAIN}`);
    await findByRole('heading', { name: /Из чего состоит/ });
    await chooseMenuAction('В архив');
    await waitFor(async () => {
      expect((await debtOf(td, MAIN))!.archivedAt).not.toBeNull();
      expect((await debtOf(td, PART))!.archivedAt).not.toBeNull();
    });
  });
});

describe('удаление главного долга объединения', () => {
  it('на странице «только он сам» окно удаления говорит, что остальные долги останутся отдельными; после удаления они сами по себе, «Отменить» возвращает объединение', async () => {
    const td = await show(`/debts/${MAIN}?own=1`);
    await findByRole('button', { name: 'Править' });
    await chooseMenuAction('Удалить долг');
    const dlg = await findByRole('alertdialog');
    expect(text(tid('debt-delete-parts'))).toContain('Долги, объединённые с этим (1), не удаляются');
    // у главного долга есть операция (платёж): выбираем «только долг»
    await user.click(Array.from(dlg.querySelectorAll('input[type="radio"], button')).find((el) => /Удалить только долг/.test(text(el.closest('label') ?? el)))!);
    await user.click(Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === 'Удалить')!);
    await waitFor(async () => expect((await debtOf(td, MAIN))!.deletedAt).not.toBeNull());
    const part = (await debtOf(td, PART))!;
    expect(part.deletedAt).toBeNull();
    expect(part.mergedIntoId).toBeNull();
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(async () => {
      expect((await debtOf(td, MAIN))!.deletedAt).toBeNull();
      expect((await debtOf(td, PART))!.mergedIntoId).toBe(MAIN);
    });
  });
});
