import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { forgetTemplatesCache, saveTemplate } from '@/features/templates/templateStore';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from './HomePage';
import { HOME_TEMPLATES } from './TemplatesRow';

beforeEach(() => {
  localStorage.clear();
  forgetTemplatesCache();
  pinToday();
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetTemplatesCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const row = () => document.querySelector<HTMLElement>('[data-testid="home-templates"]');
const chips = () => [...document.querySelectorAll<HTMLElement>('[data-testid="home-template"]')];

function StateProbe() {
  const state = useLocation().state as { prefill?: unknown; kind?: string } | null;
  return <p data-testid="state" data-prefill={JSON.stringify(state?.prefill ?? null)} data-kind={state?.kind ?? ''} />;
}

async function openHome(setup: (s: Store, ids: { cash: string; food: string }) => Promise<void> | void) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
      await setup(s, { cash, food });
    },
  });
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
  return td;
}

describe('«Шаблоны» на «Главной»', () => {
  it('шаблонов нет — строки нет', async () => {
    await openHome(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(row()).toBeNull();
  });

  it('чипы с названием и суммой; шаблон на пропавшем кошельке не показывается; «Все» ведёт в Настройки', async () => {
    await openHome((s, { cash, food }) => {
      saveTemplate(s.userId, 'Кофе', { kind: 'expense', walletId: cash, toWalletId: null, amountMinor: 1_500, categoryId: food, note: '' });
      saveTemplate(s.userId, 'Аренда', { kind: 'expense', walletId: 'gone', toWalletId: null, amountMinor: 300_000, categoryId: null, note: '' });
    });
    await waitFor(() => expect(row()).not.toBeNull());
    expect(chips()).toHaveLength(1);
    expect(norm(chips()[0]!.textContent)).toContain('Кофе');
    expect(norm(chips()[0]!.textContent)).toContain(norm(formatMinor(1_500, 'TJS')));
    await user.click(screen.getByRole('link', { name: 'Все' }));
    await waitFor(() => expect(currentPath()).toBe('/settings/templates'));
  });

  it('нажатие открывает «Новую операцию» с готовой заготовкой', async () => {
    await openHome((s, { cash, food }) => {
      saveTemplate(s.userId, 'Кофе', { kind: 'expense', walletId: cash, toWalletId: null, amountMinor: 1_500, categoryId: food, note: 'эспрессо' });
    });
    await user.click(await findByRole('link', { name: /^Шаблон: Кофе/ }));
    await waitFor(() => expect(currentPath()).toBe('/add'));
    const probe = document.querySelector('[data-testid="state"]') as HTMLElement;
    expect(probe.dataset.kind).toBe('expense');
    expect(JSON.parse(probe.dataset.prefill ?? 'null')).toMatchObject({ amountMinor: 1_500, note: 'эспрессо' });
  });

  it(`на «Главной» не больше ${HOME_TEMPLATES} шаблонов`, async () => {
    await openHome((s, { cash, food }) => {
      for (let i = 0; i < HOME_TEMPLATES + 3; i++) saveTemplate(s.userId, `Шаблон ${i}`, { kind: 'expense', walletId: cash, toWalletId: null, amountMinor: 100 + i, categoryId: food, note: '' });
    });
    await waitFor(() => expect(row()).not.toBeNull());
    expect(chips()).toHaveLength(HOME_TEMPLATES);
  });
});
