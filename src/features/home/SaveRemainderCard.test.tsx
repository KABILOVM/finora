import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetDismissedCache } from '@/lib/dismissedKeys';
import HomePage from './HomePage';

beforeEach(() => {
  localStorage.clear();
  forgetDismissedCache();
  pinToday();
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0)); // 3 октября: первые дни месяца
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetDismissedCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const card = () => document.querySelector<HTMLElement>('[data-testid="save-remainder"]');

function StateProbe() {
  const state = useLocation().state as { prefill?: unknown; kind?: string } | null;
  return <p data-testid="state" data-prefill={JSON.stringify(state?.prefill ?? null)} data-kind={state?.kind ?? ''} />;
}

/** Сентябрь: доход 5 000, расход 3 800 — осталось 1 200 (лежат в «Наличных»); есть накопление «Отпуск». */
async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  await s.wallets.create({ name: 'Отпуск', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '🏝️', goalMinor: 1_000_000 });
  await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 500_000, occurredOn: '2026-09-05' });
  await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 380_000, occurredOn: '2026-09-20' });
}

async function openHome(setup: (s: Store) => Promise<unknown> = seed) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
      <StateProbe />
    </>,
    td,
    '/',
  );
  await findByRole('heading', { name: 'Главная', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

describe('карточка «Отложить остаток» на «Главной»', () => {
  it('в начале месяца: сколько осталось, куда и откуда предлагаем отложить', async () => {
    await openHome();
    await waitFor(() => expect(card()).not.toBeNull());
    const text = norm(card()!.textContent);
    expect(text).toContain('За сентябрь 2026 осталось');
    expect(text).toContain(fmt(120_000));
    expect(text).toContain('в «Отпуск»');
    expect(text).toContain('Из «Наличные»');
  });

  it('«Отложить» открывает форму «Новая операция» с готовым переводом на накопление', async () => {
    const td = await openHome();
    await user.click(await findByRole('link', { name: 'Отложить' }));
    await waitFor(() => expect(currentPath()).toBe('/add'));
    const probe = document.querySelector('[data-testid="state"]') as HTMLElement;
    const prefill = JSON.parse(probe.dataset.prefill ?? 'null') as { kind: string; walletId: string; toWalletId: string; amountMinor: number };
    const wallets = await td.stores[0]!.db.wallets.toArray();
    expect(prefill).toMatchObject({ kind: 'transfer', amountMinor: 120_000 });
    expect(prefill.walletId).toBe(wallets.find((w) => w.name === 'Наличные')!.id);
    expect(prefill.toWalletId).toBe(wallets.find((w) => w.name === 'Отпуск')!.id);
    expect(probe.dataset.kind).toBe('transfer');
  });

  it('«Не сейчас» убирает предложение этого месяца и помнит об этом', async () => {
    const td = await openHome();
    await user.click(await findByRole('button', { name: 'Не откладывать в этом месяце' }));
    await waitFor(() => expect(card()).toBeNull());
    expect(localStorage.getItem(`finora:dismissed:save-remainder:${td.stores[0]!.userId}`)).toContain('save:2026-09');
  });

  it('уже отложили в этом месяце — предложения нет', async () => {
    await openHome(async (s) => {
      await seed(s);
      const wallets = await s.db.wallets.toArray();
      await s.transactions.create({
        kind: 'transfer',
        walletId: wallets.find((w) => w.name === 'Наличные')!.id,
        toWalletId: wallets.find((w) => w.name === 'Отпуск')!.id,
        amountMinor: 50_000,
        toAmountMinor: 50_000,
        occurredOn: '2026-10-02',
      });
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(card()).toBeNull();
  });

  it('нет накоплений — карточки нет', async () => {
    await openHome(async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 500_000, occurredOn: '2026-09-05' });
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(card()).toBeNull();
  });

  it('после 7-го числа карточки нет', async () => {
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
    await openHome();
    await new Promise((r) => setTimeout(r, 120));
    expect(card()).toBeNull();
  });
});
