import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import type { RateTable } from '@/domain/types';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { rowDiff } from './reconcileAll';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

describe('rowDiff: строка «Сверки всех кошельков»', () => {
  it('не введено — пропуск; совпало; расхождение со знаком (плюс — в кошельке больше, чем в приложении)', () => {
    expect(rowDiff(100_000, null, false)).toEqual({ kind: 'skip' });
    expect(rowDiff(100_000, 100_000, false)).toEqual({ kind: 'match' });
    expect(rowDiff(100_000, 120_000, false)).toEqual({ kind: 'diff', diffMinor: 20_000 });
    expect(rowDiff(100_000, 70_000, false)).toEqual({ kind: 'diff', diffMinor: -30_000 });
  });

  it('минус (кредитка): фактический остаток считается от нуля вниз', () => {
    expect(rowDiff(-5_000, 5_000, true)).toEqual({ kind: 'match' });
    expect(rowDiff(-5_000, 8_000, true)).toEqual({ kind: 'diff', diffMinor: -3_000 });
    expect(rowDiff(0, 0, true)).toEqual({ kind: 'match' });
  });

  it('суммы не помещаются в безопасное целое — «слишком велика», а не падение', () => {
    expect(rowDiff(10, Number.MAX_SAFE_INTEGER, true)).toEqual({ kind: 'overflow' });
  });
});

const usdTable: RateTable = { asOf: '2026-10-10', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.9 }, source: 'nbt', fetchedAt: '2026-10-10T08:00:00.000Z' };

function depsWithRates(table?: RateTable): TestDeps {
  const td = makeTestDeps();
  td.deps.createRates = () =>
    createRateService({
      providers: [],
      storage: createMemoryRateStorage(table ? { v: 1, tables: [table], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null } : undefined),
      now: () => new Date('2026-10-10T12:00:00.000Z'),
    });
  return td;
}

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};

/** «Наличные» (начальный остаток 1 000 с.) и «Карта» (500 с.). */
async function openWallets(td: TestDeps = makeTestDeps(), extra = true) {
  renderAppRoot(<WalletsPage />, { deps: td.deps });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
  const s = store(td);
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  await write(() => s.wallets.update(cash.id, { openingBalanceMinor: 100_000 }));
  if (extra) {
    await write(() => s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 50_000, color: '#2563eb', icon: '💳' }));
    await waitFor(() => expect(screen.getByText('Карта')).toBeInTheDocument());
  }
  return { td, s, cash };
}

const open = async () => {
  await user.click(screen.getByRole('button', { name: 'Сверить все кошельки' }));
  return findByRole('dialog', { name: 'Сверить все кошельки' });
};
const amountField = (wallet: string) => waitFor(() => screen.getByRole('textbox', { name: new RegExp(`^Сколько на самом деле: ${wallet},`) }));
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));

describe('«Сверить все кошельки»', () => {
  it('кнопки нет, пока кошелёк один: хватает сверки самого кошелька', async () => {
    await openWallets(makeTestDeps(), false);
    expect(screen.queryByRole('button', { name: 'Сверить все кошельки' })).toBeNull();
  });

  it('на одном экране все кошельки с остатком в приложении; пока ничего не введено, записывать нечего', async () => {
    await openWallets();
    const dialog = await open();
    await waitFor(() => expect(norm(dialog.textContent)).toContain(`В приложении: ${fmt(100_000)}`));
    const text = norm(dialog.textContent);
    expect(text).toContain('Наличные');
    expect(text).toContain('Карта');
    expect(text).toContain(`В приложении: ${fmt(50_000)}`);
    const button = screen.getByRole('button', { name: 'Введите, сколько на самом деле' });
    expect(button).toBeDisabled();
  });

  it('расхождения называются прямо в строке, совпадение — «Совпадает»; пустые кошельки пропускаются', async () => {
    const { s } = await openWallets();
    await open();
    await user.type(await amountField('Наличные'), '1200'); // в приложении 1000
    await user.type(await amountField('Карта'), '500'); // в приложении 500
    await waitFor(() => expect(document.querySelector('[data-testid="recon-diff"]')).not.toBeNull());
    expect(norm(document.querySelector('[data-testid="recon-diff"]')?.textContent)).toContain(`В приложении меньше на ${fmt(20_000)}`);
    expect(screen.getByText('Совпадает')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Записать корректировки · 1' })).toBeEnabled();
    expect(await s.db.transactions.count()).toBe(0); // пока не нажали — ничего не записано
  });

  it('«Записать корректировки» кладёт операции «Корректировка остатка» сегодняшним числом только где есть расхождение; остатки совпадают; «Отменить» убирает', async () => {
    const { s, cash } = await openWallets();
    await open();
    await user.type(await amountField('Наличные'), '1200');
    await user.type(await amountField('Карта'), '400'); // в приложении 500: в кошельке меньше
    await user.click(await findByRole('button', { name: 'Записать корректировки · 2' }));
    await eventually(async () => expect(await s.db.transactions.count()).toBe(2));
    const rows = await s.db.transactions.toArray();
    const forCash = rows.find((t) => t.walletId === cash.id)!;
    expect(forCash).toMatchObject({ kind: 'income', amountMinor: 20_000, fxSource: 'adjust', categoryId: null });
    const forCard = rows.find((t) => t.walletId !== cash.id)!;
    expect(forCard).toMatchObject({ kind: 'expense', amountMinor: 10_000, fxSource: 'adjust' });
    // окно закрылось, остатки на экране сошлись с введёнными
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Сверить все кошельки' })).toBeNull());
    await waitFor(() => expect(norm(document.body.textContent)).toContain(fmt(120_000)));
    // одним «Отменить» — обе корректировки
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await eventually(async () => expect((await s.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(0));
  });

  it('кошелёк в долларах без курса: его строка не записывается, понятно почему; остальные записываются', async () => {
    const td = depsWithRates();
    const { s } = await openWallets(td);
    await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    await waitFor(() => expect(screen.getByText('Доллары')).toBeInTheDocument());
    await open();
    await user.type(await amountField('Наличные'), '1200');
    await user.type(await amountField('Доллары'), '150');
    await user.click(await findByRole('button', { name: 'Записать корректировки · 2' }));
    const dialog = await findByRole('dialog', { name: 'Сверить все кошельки' });
    await waitFor(() => expect(norm(dialog.textContent)).toContain('Доллары: Нет курса USD к TJS'));
    expect(await s.db.transactions.count()).toBe(1); // наличные записались
    // у строки с ошибкой введённая сумма на месте: можно задать курс и повторить
    expect(((await amountField('Доллары')) as HTMLInputElement).value).toContain('150');
  });

  it('кошелёк в долларах с курсом записывается по снимку курса', async () => {
    const td = depsWithRates(usdTable);
    const { s } = await openWallets(td);
    await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    await waitFor(() => expect(screen.getByText('Доллары')).toBeInTheDocument());
    await open();
    await user.type(await amountField('Доллары'), '150'); // в приложении 100 $: +50 $
    await user.click(await findByRole('button', { name: 'Записать корректировки · 1' }));
    await eventually(async () => expect(await s.db.transactions.count()).toBe(1));
    const adj = (await s.db.transactions.toArray())[0]!;
    expect(adj).toMatchObject({ kind: 'income', amountMinor: 5_000, fxSource: 'adjust', baseCurrency: 'TJS' });
    expect(adj.baseAmountMinor).toBe(54_500); // 50 $ × 10,9
  });

  it('кредитка в минусе: появляется переключатель «Минус», фактический остаток считается от нуля вниз', async () => {
    const { s } = await openWallets(makeTestDeps(), false);
    await write(() => s.wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -20_000, color: '#2563eb', icon: '💳' }));
    await waitFor(() => expect(screen.getByText('Кредитка')).toBeInTheDocument());
    await open();
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(1));
    await user.type(await amountField('Кредитка'), '250');
    await user.click(screen.getByRole('switch'));
    // −250 против −200 в приложении: в кошельке меньше на 50
    await waitFor(() => expect(norm(document.querySelector('[data-testid="recon-diff"]')?.textContent)).toContain(`В приложении больше на ${fmt(5_000)}`));
  });
});
