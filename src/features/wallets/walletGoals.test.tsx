import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { chip, opsDeps, pinToday, setDateInput, showApp, storeOf, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

// «сегодня» — 15 октября 2026 (pinToday)
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const goalBlocks = () => Array.from(document.querySelectorAll('[data-testid="wallet-goal"]'));
const nudgeEl = () => document.querySelector('[data-testid="goal-nudge"]');
const barOf = (el: Element | undefined | null) => el?.querySelector('[role="progressbar"]') ?? null;
const need = (find: () => Element | null) =>
  waitFor(() => {
    const el = find();
    if (!el) throw new Error('Элемента ещё нет');
    return el;
  });

type WalletIn = Parameters<Store['wallets']['create']>[0];
const savings = (over: Partial<WalletIn> = {}): WalletIn => ({
  name: 'Копилка',
  currency: 'TJS',
  kind: 'savings',
  openingBalanceMinor: 100_00,
  color: '#16a34a',
  icon: '🪙',
  goalMinor: 1000_00,
  goalOn: '2027-01-15',
  ...over,
});

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(<WalletsPage />, td, '/wallets');
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
  return td;
}

describe('кошельки: строка цели накопления', () => {
  it('накопление с целью и сроком: полоса, «накоплено из», «осталось», срок и сколько откладывать в месяц', async () => {
    await open((s) => s.wallets.create(savings()));
    const block = (await need(() => goalBlocks()[0] ?? null)) as HTMLElement;
    const bar = barOf(block)!;
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(bar).toHaveAttribute('aria-label', 'Цель «Копилка»: накоплено 10%');
    const text = norm(block.textContent);
    expect(text).toContain(`Накоплено ${fmt(100_00)} из ${fmt(1000_00)}`);
    expect(text).toContain(`Осталось ${fmt(900_00)}`);
    expect(text).toContain('К 15.01.2027 · через 92 дня');
    expect(text).toContain(`Откладывайте около ${fmt(300_00)} в месяц`);
  });

  it('кошельки без цели и не «Накопления» (даже со старой целью в базе) строки цели не получают', async () => {
    await open(async (s) => {
      await s.wallets.create(savings({ name: 'Без цели', goalMinor: null, goalOn: null }));
      await s.wallets.create(savings({ name: 'Карта', kind: 'card' })); // цель осталась от смены вида на другом устройстве
    });
    await waitFor(() => expect(screen.getByText('Без цели')).toBeInTheDocument());
    expect(goalBlocks()).toHaveLength(0);
  });

  it('цель достигнута: «Цель достигнута», без «осталось» и без подсказок', async () => {
    await open((s) => s.wallets.create(savings({ openingBalanceMinor: 1200_00 })));
    const block = (await need(() => goalBlocks()[0] ?? null)) as HTMLElement;
    const text = norm(block.textContent);
    expect(text).toContain(`Цель достигнута: ${fmt(1200_00)} из ${fmt(1000_00)}`);
    expect(text).not.toContain('Осталось');
    expect(text).not.toContain('Откладывайте');
    expect(barOf(block)).toHaveAttribute('aria-valuenow', '100');
    expect(nudgeEl()).toBeNull();
  });

  it('срок прошёл: сказано словами и значком, не только цветом', async () => {
    await open((s) => s.wallets.create(savings({ goalOn: '2026-10-10' })));
    const block = (await need(() => goalBlocks()[0] ?? null)) as HTMLElement;
    expect(norm(block.textContent)).toContain('Срок прошёл 5 дней назад (было 10.10.2026)');
    expect(norm(block.textContent)).not.toContain('Откладывайте');
  });

  it('пополнение переводом сразу двигает полосу', async () => {
    const td = await open((s) => s.wallets.create(savings({ goalMinor: 400_00, goalOn: null })));
    const block = () => goalBlocks()[0] as HTMLElement | undefined;
    await need(() => block() ?? null);
    expect(norm(block()?.textContent)).toContain(`Накоплено ${fmt(100_00)} из ${fmt(400_00)}`);
    const s = storeOf(td);
    const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
    const piggy = (await s.db.wallets.toArray()).find((w) => w.name === 'Копилка')!;
    await write(() => s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 500_00, occurredOn: '2026-10-01' }));
    await write(() => s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: piggy.id, amountMinor: 100_00, occurredOn: '2026-10-05' }));
    await eventually(() => {
      expect(norm(block()?.textContent)).toContain(`Накоплено ${fmt(200_00)} из ${fmt(400_00)}`);
    });
    expect(barOf(block())).toHaveAttribute('aria-valuenow', '50');
  });
});

describe('кошельки: подсказка «пора отложить»', () => {
  it('вторая половина месяца и в этом месяце отложено меньше нужного — подсказка с суммами', async () => {
    await open((s) => s.wallets.create(savings()));
    const nudge = await need(() => nudgeEl());
    expect(norm(nudge.textContent)).toBe(`Пора отложить: в этом месяце отложено ${fmt(0)} из ~${fmt(300_00)}`);
  });

  it('учитывает пополнения этого месяца: отложено меньше — «отложено X из ~R»; отложено достаточно — подсказки нет', async () => {
    const td = await open(async (s) => {
      const piggy = await s.wallets.create(savings());
      await s.transactions.create({ kind: 'income', walletId: piggy.id, amountMinor: 100_00, occurredOn: '2026-10-03' });
      await s.transactions.create({ kind: 'income', walletId: piggy.id, amountMinor: 50_00, occurredOn: '2026-09-28' }); // прошлый месяц не считается
    });
    // остаток 250, осталось 750, отложено в октябре 100; на начало месяца оставалось 850 → нужно ceil(850/3) = 284
    const nudge = await need(() => nudgeEl());
    expect(norm(nudge.textContent)).toBe(`Пора отложить: в этом месяце отложено ${fmt(100_00)} из ~${fmt(28334)}`);
    const s = storeOf(td);
    const piggy = (await s.db.wallets.toArray()).find((w) => w.name === 'Копилка')!;
    await write(() => s.transactions.create({ kind: 'income', walletId: piggy.id, amountMinor: 200_00, occurredOn: '2026-10-10' }));
    await eventually(() => expect(nudgeEl()).toBeNull());
  });

  it('расход из накоплений не считается «отложенным» (меньше нуля не бывает)', async () => {
    await open(async (s) => {
      const piggy = await s.wallets.create(savings({ openingBalanceMinor: 500_00 }));
      await s.transactions.create({ kind: 'expense', walletId: piggy.id, amountMinor: 50_00, occurredOn: '2026-10-04' });
    });
    const nudge = await need(() => nudgeEl());
    expect(norm(nudge.textContent)).toContain(`отложено ${fmt(0)} из`);
  });

  it('в первой половине месяца и без срока подсказки нет', async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
    await open(async (s) => {
      await s.wallets.create(savings());
      await s.wallets.create(savings({ name: 'Без срока', goalOn: null }));
    });
    await need(() => goalBlocks()[1] ?? null);
    expect(nudgeEl()).toBeNull();
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  });

  it('без срока подсказки нет и во второй половине месяца', async () => {
    await open((s) => s.wallets.create(savings({ goalOn: null })));
    await need(() => goalBlocks()[0] ?? null);
    expect(nudgeEl()).toBeNull();
    expect(norm(goalBlocks()[0]?.textContent)).not.toContain('Откладывайте');
  });
});

describe('шит кошелька: поля цели', () => {
  const openSheet = async (name?: string) => {
    if (name) await user.click(screen.getByRole('button', { name: `Изменить: ${name}` }));
    else await user.click(screen.getByRole('button', { name: 'Добавить' }));
    return findByRole('dialog', { name: name ? 'Правка кошелька' : 'Новый кошелёк' });
  };
  const goalInput = () => screen.getByRole('textbox', { name: /Цель накопления/ });

  it('поля цели есть только у вида «Накопления»; срок спрашивается, когда задана сумма', async () => {
    await open();
    await openSheet();
    expect(screen.queryByRole('textbox', { name: /Цель накопления/ })).toBeNull();
    await user.click(chip('Вид кошелька', 'Накопления'));
    expect(goalInput()).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Накопить к дате' })).toBeNull();
    await user.type(goalInput(), '5000');
    expect(screen.getByRole('group', { name: 'Накопить к дате' })).toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).toBeNull(); // «Без срока» по умолчанию
    await user.click(chip('Накопить к дате', 'Указать срок'));
    expect(document.querySelector('input[type="date"]')).not.toBeNull();
    await user.click(chip('Вид кошелька', 'Наличные'));
    expect(screen.queryByRole('textbox', { name: /Цель накопления/ })).toBeNull();
  });

  it('создаёт накопление с целью и сроком; в базе сумма в минимальных единицах и дата', async () => {
    const td = await open();
    await openSheet();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Отпуск');
    await user.click(chip('Вид кошелька', 'Накопления'));
    await user.type(goalInput(), '5000');
    await user.click(chip('Накопить к дате', 'Указать срок'));
    setDateInput(document.querySelector('input[type="date"]') as HTMLElement, '2027-06-01');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const w = (await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Отпуск');
    expect(w).toMatchObject({ kind: 'savings', goalMinor: 500_000, goalOn: '2027-06-01' });
    await need(() => goalBlocks()[0] ?? null);
    expect(norm(goalBlocks()[0]?.textContent)).toContain(`из ${fmt(500_000)}`);
  });

  it('цель без срока: goalOn = null; накопление без цели сохраняется как раньше', async () => {
    const td = await open();
    await openSheet();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Подушка');
    await user.click(chip('Вид кошелька', 'Накопления'));
    await user.type(goalInput(), '100');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Подушка')).toMatchObject({ goalMinor: 10_000, goalOn: null });

    await openSheet();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Просто накопления');
    await user.click(chip('Вид кошелька', 'Накопления'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Просто накопления')).toMatchObject({ goalMinor: null, goalOn: null });
  });

  it('правка: сумма и срок подставлены; изменение суммы трогает только сумму; очистка суммы убирает и срок', async () => {
    const td = await open((s) => s.wallets.create(savings()));
    await openSheet('Копилка');
    expect((goalInput() as HTMLInputElement).value.replace(/\s/g, '')).toMatch(/^1000([,.]00)?$/);
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2027-01-15');
    await user.clear(goalInput());
    await user.type(goalInput(), '2000');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const s = storeOf(td);
    expect((await s.db.wallets.toArray()).find((x) => x.name === 'Копилка')).toMatchObject({ goalMinor: 200_000, goalOn: '2027-01-15' });

    await openSheet('Копилка');
    await user.clear(goalInput());
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await s.db.wallets.toArray()).find((x) => x.name === 'Копилка')).toMatchObject({ goalMinor: null, goalOn: null });
    await eventually(() => expect(goalBlocks()).toHaveLength(0));
  });

  it('смена вида на другой очищает цель', async () => {
    const td = await open((s) => s.wallets.create(savings()));
    await openSheet('Копилка');
    await user.click(chip('Вид кошелька', 'Карта'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Копилка')).toMatchObject({ kind: 'card', goalMinor: null, goalOn: null });
  });

  it('цель 0 и срок в прошлом не сохраняются: подсказка у поля, шит открыт, в базе ничего нового', async () => {
    const td = await open();
    await openSheet();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Отпуск');
    await user.click(chip('Вид кошелька', 'Накопления'));
    await user.type(goalInput(), '0');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Цель должна быть больше нуля'))).toBeInTheDocument();

    await user.clear(goalInput());
    await user.type(goalInput(), '10');
    await user.click(chip('Накопить к дате', 'Указать срок'));
    setDateInput(document.querySelector('input[type="date"]') as HTMLElement, '2026-10-14');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Срок не может быть в прошлом'))).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Новый кошелёк' })).toBeInTheDocument();
    expect((await storeOf(td).db.wallets.toArray()).map((w) => w.name)).toEqual(['Наличные']);
  });

  it('у цели с уже прошедшим сроком можно править название: срок не считается «новым в прошлом»', async () => {
    const td = await open((s) => s.wallets.create(savings({ goalOn: '2026-09-01' })));
    await openSheet('Копилка');
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Копилка 2');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.wallets.toArray()).find((x) => x.name === 'Копилка 2')).toMatchObject({ goalMinor: 1000_00, goalOn: '2026-09-01' });
  });
});
