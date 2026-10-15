import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import GoalsWidget, { GOALS_WIDGET_LIMIT } from './GoalsWidget';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(pinToday); // 15 октября 2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const widget = () => document.querySelector('[data-testid="goals-widget"]');
const items = () => Array.from(document.querySelectorAll('[data-testid="goals-widget-item"]'));
const names = () => items().map((el) => norm(el.querySelector('.truncate')?.textContent));

type WalletIn = Parameters<Store['wallets']['create']>[0];
const goal = (name: string, over: Partial<WalletIn> = {}): WalletIn => ({
  name,
  currency: 'TJS',
  kind: 'savings',
  openingBalanceMinor: 0,
  color: '#16a34a',
  icon: '🪙',
  goalMinor: 1000_00,
  goalOn: null,
  ...over,
});

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(
    <>
      <GoalsWidget />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await eventually(async () => expect(await storeOf(td).db.wallets.count()).toBeGreaterThan(0));
  // пустой виджет — это «ничего», поэтому даём запросам отработать
  await new Promise((r) => setTimeout(r, 80));
  return td;
}

describe('виджет «Цели» на «Главной»', () => {
  it('целей нет — ничего не рисуется (и накопление без цели, и кошелёк другого вида с «чужой» целью)', async () => {
    await open(async (s) => {
      await s.wallets.create(goal('Без цели', { goalMinor: null }));
      await s.wallets.create(goal('Карта', { kind: 'card' }));
    });
    expect(widget()).toBeNull();
  });

  it('до трёх ближайших: сначала со сроком по дате, потом без срока; «И ещё N»; архивные не считаются', async () => {
    await open(async (s) => {
      await s.wallets.create(goal('Без срока'));
      await s.wallets.create(goal('Позже', { goalOn: '2027-06-01' }));
      await s.wallets.create(goal('Раньше', { goalOn: '2026-12-01' }));
      await s.wallets.create(goal('Совсем поздно', { goalOn: '2028-01-01' }));
      const old = await s.wallets.create(goal('В архиве', { goalOn: '2026-11-01' }));
      await s.wallets.archive(old.id);
    });
    await waitFor(() => {
      if (!widget()) throw new Error('виджета ещё нет');
    });
    expect(GOALS_WIDGET_LIMIT).toBe(3);
    expect(names()).toEqual(['Раньше', 'Позже', 'Совсем поздно']);
    expect(norm(widget()?.textContent)).toContain('И ещё 1 на странице «Кошельки»');
  });

  it('при равном сроке выше та, что дальше от цели; достигнутые — в конце', async () => {
    await open(async (s) => {
      await s.wallets.create(goal('Почти', { goalOn: '2027-01-01', openingBalanceMinor: 900_00 }));
      await s.wallets.create(goal('С нуля', { goalOn: '2027-01-01' }));
      await s.wallets.create(goal('Готово', { goalOn: '2026-11-01', openingBalanceMinor: 1500_00 }));
    });
    await waitFor(() => {
      if (items().length < 3) throw new Error('ещё не все');
    });
    expect(names()).toEqual(['С нуля', 'Почти', 'Готово']);
    expect(norm(items()[2]?.textContent)).toContain('Цель достигнута');
    expect(items()[2]?.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
  });

  it('строка: процент, «накоплено из», «осталось», срок и темп; цели разных валют не складываются', async () => {
    await open(async (s) => {
      await s.wallets.create(goal('Отпуск', { goalOn: '2027-01-15', openingBalanceMinor: 100_00 }));
      await s.wallets.create(goal('Доллары', { currency: 'USD', goalMinor: 500_00, openingBalanceMinor: 250_00 }));
    });
    await waitFor(() => {
      if (items().length < 2) throw new Error('ещё не все');
    });
    const byName = (n: string) => items().find((el) => norm(el.textContent).startsWith(n)) as Element;
    const trip = norm(byName('Отпуск').textContent);
    expect(trip).toContain('10%');
    expect(trip).toContain(`Накоплено ${fmt(100_00)} из ${fmt(1000_00)}`);
    expect(trip).toContain(`Осталось ${fmt(900_00)}`);
    expect(trip).toContain('К 15.01.2027');
    expect(trip).toContain(`Откладывайте около ${fmt(300_00)} в месяц`);
    const usd = norm(byName('Доллары').textContent);
    expect(usd).toContain('50%');
    expect(usd).toContain(`Накоплено ${fmt(250_00, 'USD')} из ${fmt(500_00, 'USD')}`);
  });

  it('«пора отложить» показана в виджете, когда во второй половине месяца отложено мало', async () => {
    await open((s) => s.wallets.create(goal('Отпуск', { goalOn: '2027-01-15', openingBalanceMinor: 100_00 })));
    await waitFor(() => {
      if (!document.querySelector('[data-testid="goals-widget-nudge"]')) throw new Error('подсказки ещё нет');
    });
    expect(norm(document.querySelector('[data-testid="goals-widget-nudge"]')?.textContent)).toBe(
      `Пора отложить: в этом месяце отложено ${fmt(0)} из ~${fmt(300_00)}`,
    );
  });

  it('виджет обновляется после операции: перевод в накопления двигает проценты', async () => {
    const td = await open((s) => s.wallets.create(goal('Отпуск', { goalMinor: 400_00 })));
    await waitFor(() => {
      if (!widget()) throw new Error('виджета ещё нет');
    });
    expect(norm(items()[0]?.textContent)).toContain('0%');
    const s = storeOf(td);
    const piggy = (await s.db.wallets.toArray()).find((w) => w.name === 'Отпуск')!;
    await write(() => s.transactions.create({ kind: 'income', walletId: piggy.id, amountMinor: 100_00, occurredOn: '2026-10-05' }));
    await eventually(() => expect(norm(items()[0]?.textContent)).toContain('25%'));
  });

  it('ссылка «Все цели» ведёт на /wallets', async () => {
    await open((s) => s.wallets.create(goal('Отпуск')));
    await waitFor(() => {
      if (!widget()) throw new Error('виджета ещё нет');
    });
    const link = widget()?.querySelector('a') as HTMLAnchorElement;
    expect(norm(link.textContent)).toBe('Все цели');
    link.click();
    await waitFor(() => expect(currentPath()).toBe('/wallets'));
  });
});
