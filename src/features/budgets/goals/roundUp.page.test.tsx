import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { useSavingsGoals, useWallets, type Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { choose, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { RoundUpCard } from './RoundUpCard';
import { SaveNowSheet } from './SaveNowSheet';
import { setRoundUpStep } from './roundUpPref';

/** «Сегодня» = четверг 15 октября 2026, основная валюта TJS. */
beforeEach(() => {
  pinToday();
  window.localStorage.clear();
  setRoundUpStep(5);
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const money = (minor: number) => norm(formatMinor(minor, 'TJS'));
const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const amountText = () => norm(byId('round-up-amount')?.textContent);

interface World {
  cash: string;
  box: string;
  card: string;
  goal: string;
}

/**
 * Копилка «Отпуск» на кошельке «Копилка». В октябре: расход 47 (10-го), 12,50 (12-го), 50 (13-го), а 10 сентября — 47 (вне 30 дней:
 * последние 30 дней — с 16 сентября). Мелочь при шаге 5: 3 + 2,50 + 0 = 5,50; при шаге 10: 3 + 7,50 + 0 = 10,50; при шаге 1: 0,50.
 */
async function seed(s: Store, opts: { sweptThrough?: string; goalWithoutWallet?: boolean; defaultWallet?: 'card' } = {}): Promise<World> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  const box = await s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '🐷' });
  const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 100_000, color: '#16a34a', icon: '💳' });
  const goal = await s.savingsGoals.create({ name: 'Отпуск', targetMinor: 300_000, dueOn: '2026-12-15', walletId: opts.goalWithoutWallet ? null : box.id });
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 900_000, categoryId: null, occurredOn: '2026-10-01' });
  const spend = (amountMinor: number, occurredOn: string) => s.transactions.create({ kind: 'expense', walletId: cash, amountMinor, categoryId: null, occurredOn });
  await spend(4_700, '2026-09-10');
  await spend(4_700, '2026-10-10');
  await spend(1_250, '2026-10-12');
  await spend(5_000, '2026-10-13');
  if (opts.sweptThrough) {
    await s.transactions.create({
      kind: 'transfer',
      walletId: cash,
      toWalletId: box.id,
      amountMinor: 100,
      toAmountMinor: 100,
      categoryId: null,
      occurredOn: opts.sweptThrough,
      note: `Копилка из мелочи · до ${opts.sweptThrough}`,
    });
  }
  if (opts.defaultWallet === 'card') await s.settings.update({ defaultWalletId: card.id });
  return { cash, box: box.id, card: card.id, goal: goal.id };
}

function CardHarness() {
  const goals = useSavingsGoals();
  const wallets = useWallets();
  if (!goals || !wallets) return null;
  return <RoundUpCard base="TJS" goals={goals} wallets={wallets} />;
}

async function openCard(opts: Parameters<typeof seed>[1] = {}) {
  let world!: World;
  const td = opsDeps([table()], {
    setup: async (s) => {
      world = await seed(s, opts);
    },
  });
  await showApp(<CardHarness />, td, '/');
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return { td, world: () => world };
}

const transfers = async (td: { stores: Store[] }) =>
  (await storeOf(td as never).db.transactions.toArray()).filter((t) => t.kind === 'transfer' && t.deletedAt === null && t.note.startsWith('Копилка из мелочи'));

describe('«Копилка из мелочи»: карточка', () => {
  it('считает мелочь за 30 дней при шаге 5 по умолчанию; траты старше 30 дней не входят', async () => {
    await openCard();
    await waitFor(() => expect(amountText()).toBe(money(550)));
    expect(byId('round-up-card')?.textContent).toContain('Накопилось с 16 сентября');
    expect(byId('round-up-card')?.textContent).toContain('за последние 30 дней');
  });

  it('шаг меняется чипами и запоминается на устройстве', async () => {
    await openCard();
    await waitFor(() => expect(amountText()).toBe(money(550)));
    const steps = screen.getByRole('group', { name: 'Шаг округления' });
    const chip = (label: string) => Array.from(steps.querySelectorAll('button')).find((b) => b.textContent === label)!;
    expect(chip('5').getAttribute('aria-pressed')).toBe('true');

    await user.click(chip('10'));
    await waitFor(() => expect(amountText()).toBe(money(1_050)));
    expect(chip('10').getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('finora:round-up-step')).toBe('10');

    await user.click(chip('1'));
    await waitFor(() => expect(amountText()).toBe(money(50)));
  });

  it('карточки нет, если у цели нет кошелька', async () => {
    await openCard({ goalWithoutWallet: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(byId('round-up-card')).toBeNull();
  });

  it('считает с дня после последнего сбора', async () => {
    await openCard({ sweptThrough: '2026-10-11' });
    // с 12 октября: 12,50 → 2,50 и 50 → 0
    await waitFor(() => expect(amountText()).toBe(money(250)));
    expect(byId('round-up-card')?.textContent).toContain('Накопилось с 12 октября');
    expect(byId('round-up-card')?.textContent).not.toContain('за последние 30 дней');
  });

  it('«Отложить мелочь» открывает окно с суммой и заметкой, перевод записывается, потом собирать нечего', async () => {
    const { td, world } = await openCard();
    await waitFor(() => expect(amountText()).toBe(money(550)));
    await user.click(screen.getByRole('button', { name: 'Отложить мелочь' }));

    const dlg = await findByRole('dialog', { name: 'Отложить на «Отпуск»' });
    expect((dlg.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('5,5'); // поле суммы не дописывает нули
    expect(dlg.textContent).toContain('Копилка из мелочи · до 2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Отложить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const saved = await transfers(td);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: 'transfer',
      walletId: world().cash,
      toWalletId: world().box,
      amountMinor: 550,
      toAmountMinor: 550,
      occurredOn: '2026-10-15',
      note: 'Копилка из мелочи · до 2026-10-15',
    });
    await waitFor(() => expect(byId('round-up-card')?.textContent).toContain('Мелочь уже отложена по сегодняшний день'));
    expect((screen.getByRole('button', { name: 'Отложить мелочь' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Отменить» в уведомлении возвращает мелочь', async () => {
    const { td } = await openCard();
    await waitFor(() => expect(amountText()).toBe(money(550)));
    await user.click(screen.getByRole('button', { name: 'Отложить мелочь' }));
    await findByRole('dialog', { name: 'Отложить на «Отпуск»' });
    await user.click(screen.getByRole('button', { name: 'Отложить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () => expect(await transfers(td)).toHaveLength(1));

    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect(await transfers(td)).toHaveLength(0));
    await waitFor(() => expect(amountText()).toBe(money(550)));
  });
});

describe('«Отложить сейчас»: окно перевода', () => {
  /** Окно напрямую: цель «Отпуск» с кошельком «Копилка», предложено 100. */
  function SheetHarness({ only }: { only?: 'box-only' }) {
    const goals = useSavingsGoals();
    const wallets = useWallets();
    const goal = goals?.[0];
    const box = wallets?.find((w) => w.name === 'Копилка');
    if (!goal || !box || !wallets) return null;
    return <SaveNowSheet goal={goal} goalWallet={box} wallets={only === 'box-only' ? [box] : wallets} suggestedMinor={10_000} onClose={() => undefined} />;
  }

  async function openSheet(opts: Parameters<typeof seed>[1] = {}, only?: 'box-only') {
    let world!: World;
    const td = opsDeps([table()], {
      setup: async (s) => {
        world = await seed(s, opts);
      },
    });
    await showApp(<SheetHarness {...(only ? { only } : {})} />, td, '/');
    await findByRole('dialog', { name: 'Отложить на «Отпуск»' });
    return { td, world: () => world };
  }

  const amountInput = () => document.querySelector('[data-testid="save-now"] input[inputmode="decimal"]') as HTMLInputElement;

  it('сумма предзаполнена; источник — кошелёк по умолчанию из настроек, если он подходит', async () => {
    await openSheet({ defaultWallet: 'card' });
    expect(amountInput().value).toBe('100');
    // настройки подгружаются после открытия окна, поэтому кошелёк по умолчанию подхватывается не сразу
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Откуда' }) as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Карта'));
    // в списке нет самого кошелька цели
    const names = Array.from((screen.getByRole('combobox', { name: 'Откуда' }) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(names).not.toContain('Копилка');
    expect(names).toContain('Наличные');
  });

  it('перевод с выбранного кошелька на кошелёк цели, без комиссии', async () => {
    const { td, world } = await openSheet();
    choose('Откуда', 'Наличные');
    await user.click(screen.getByRole('button', { name: 'Отложить' }));
    await waitFor(async () => expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer')).toHaveLength(1));
    const t = (await storeOf(td).db.transactions.toArray()).find((x) => x.kind === 'transfer')!;
    expect(t).toMatchObject({ walletId: world().cash, toWalletId: world().box, amountMinor: 10_000, toAmountMinor: 10_000, note: '', categoryId: null });
    expect(t.baseAmountMinor).toBe(0); // комиссии нет
  });

  it('нулевая сумма не сохраняется', async () => {
    const { td } = await openSheet();
    await user.clear(amountInput());
    await user.click(screen.getByRole('button', { name: 'Отложить' }));
    await waitFor(() => screen.getByText('Введите сумму больше нуля'));
    expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer')).toHaveLength(0);
  });

  it('денег на источнике меньше — предупреждает, но сохранить разрешает (остаток может быть отрицательным)', async () => {
    const { td } = await openSheet({ defaultWallet: 'card' }); // на «Карте» 1 000
    expect(byId('save-now-short')).toBeNull();
    await user.clear(amountInput());
    await user.type(amountInput(), '5000');
    await waitFor(() => expect(byId('save-now-short')?.textContent).toContain('остаток станет отрицательным'));
    await user.click(screen.getByRole('button', { name: 'Отложить' }));
    await waitFor(async () => expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer')).toHaveLength(1));
  });

  it('нет другого кошелька в валюте цели — понятное сообщение и кнопка неактивна', async () => {
    await openSheet({}, 'box-only');
    expect(byId('save-now-no-source')?.textContent).toContain('Нет другого кошелька в TJS');
    expect((screen.getByRole('button', { name: 'Отложить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
