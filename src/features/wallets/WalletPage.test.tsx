import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import { RECENT_OPS } from './WalletPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

const store = (td: TestDeps) => td.stores[td.stores.length - 1]!;

/** Открывает приложение на «Кошельках», дожидается базы и переходит на экран кошелька «Наличные». */
async function openWallet() {
  const td = makeTestDeps();
  renderAppRoot(<AppRoutes />, { deps: td.deps, path: '/wallets' });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(document.body.textContent).toContain('Наличные'));
  const cash = (await store(td).db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  return { td, cash };
}

describe('экран кошелька', () => {
  it('строка в «Кошельках» ведёт на экран: название, остаток, кнопки, «Назад» к списку', async () => {
    const { td, cash } = await openWallet();
    await write(() => store(td).wallets.update(cash.id, { openingBalanceMinor: 100_000 }));
    await user.click(await findByRole('link', { name: /Наличные/ }));
    expect(await findByRole('heading', { name: 'Наличные', level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-testid="wallet-balance"]')?.textContent).toContain(formatMinor(100_000, 'TJS').replace(/\s/g, ' ')));
    expect(screen.getByRole('link', { name: 'Расход' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Доход' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Перевод' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Кошельки' }).some((a) => a.getAttribute('href') === '/wallets')).toBe(true); // «‹ Кошельки» и пункт меню
  });

  it(`последние операции: не больше ${RECENT_OPS}, свежие сверху, «Все операции» ведёт в историю этого кошелька`, async () => {
    const { td, cash } = await openWallet();
    for (let i = 1; i <= RECENT_OPS + 2; i++) {
      await write(() => store(td).transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100 * i, occurredOn: `2026-10-${String(i).padStart(2, '0')}`, note: `трата ${i}` }));
    }
    await user.click(await findByRole('link', { name: /Наличные/ }));
    const list = await findByRole('list', { name: 'Последние операции кошелька' });
    await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(RECENT_OPS));
    expect(list.textContent).toContain(`трата ${RECENT_OPS + 2}`);
    expect(list.textContent).not.toContain('трата 1 ');
    expect(screen.getByRole('link', { name: 'Все операции' }).getAttribute('href')).toBe(`/transactions?wallet=${cash.id}&period=all`);
  });

  it('кнопка «Расход» открывает «Новую операцию» сразу с этим кошельком', async () => {
    const { td, cash } = await openWallet();
    await write(() => store(td).wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' }));
    await waitFor(() => expect(document.body.textContent).toContain('Карта'));
    await user.click(await findByRole('link', { name: /Карта/ }));
    await findByRole('heading', { name: 'Карта', level: 1 });
    await user.click(screen.getByRole('link', { name: 'Расход' }));
    await findByRole('dialog');
    // в форме выбран кошелёк «Карта», а не «Наличные» по умолчанию
    expect(await findByRole('button', { name: 'Кошелёк: Карта' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Кошелёк: Наличные' })).toBeNull();
    expect(cash.name).toBe('Наличные');
  });

  it('«Сверка» и «Изменить» открывают свои окна; несуществующий адрес — понятное сообщение', async () => {
    const { cash } = await openWallet();
    await user.click(await findByRole('link', { name: /Наличные/ }));
    await findByRole('heading', { name: 'Наличные', level: 1 });
    await user.click(await findByRole('button', { name: 'Сверка' }));
    expect(await findByRole('dialog', { name: 'Сверка: Наличные' })).toBeTruthy();
    expect(cash.id).toBeTruthy();
  });

  it('нет такого кошелька — «Такого кошелька нет» и ссылка к списку', async () => {
    const td = makeTestDeps();
    renderAppRoot(<AppRoutes />, { deps: td.deps, path: '/wallets/нет-такого' });
    expect(await findByRole('heading', { name: 'Такого кошелька нет' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К кошелькам' }).getAttribute('href')).toBe('/wallets');
  });
});
