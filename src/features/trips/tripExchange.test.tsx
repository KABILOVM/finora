import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { choose, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, readActiveTrip, setActiveTrip } from './activeTrip';
import { forgetTripPlanCache } from './tripPlan';
import TripsPage from './TripsPage';

/** Обмен валюты в поездке: кошелёк заводится сам, курс считается из «отдал / получил», остаток возвращается в сомони. */

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
  forgetTripPlanCache();
  pinToday(); // 15 октября 2026
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetActiveTripCache();
  forgetTripPlanCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

async function openPage(setup: (s: Store) => Promise<unknown> = async () => undefined) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      await s.wallets.update(cash.id, { openingBalanceMinor: 500_000 });
      setActiveTrip(s.userId, 'Самарканд');
      await setup(s);
    },
  });
  await showApp(<TripsPage />, td, '/trips');
  await findByRole('heading', { name: 'Поездки', level: 1 });
  return td;
}

/** Имя поля суммы — «Отдаю, Сомони»: подпись и название валюты. */
const amount = (name: string) => screen.getByRole('textbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;

/** Открывает «Обмен валюты» и ждёт, пока форма загрузится (пока кошельки читаются, в окне только «Загружаем…»). */
async function openExchange() {
  await user.click(screen.getByRole('button', { name: 'Обмен валюты' }));
  await findByRole('dialog', { name: 'Обмен валюты' });
  await findByRole('textbox', { name: /^Отдаю/ });
}

async function exchange(give: string, get: string) {
  await openExchange();
  await user.type(amount('Отдаю'), give);
  await user.type(amount('Получаю'), get);
  await user.click(screen.getByRole('button', { name: 'Записать обмен' }));
}

describe('обмен валюты в поездке', () => {
  it('отдал 1 100 с., получил 100 $: кошелёк «USD · Самарканд» заведён сам, курс 11, остаток в сомони виден', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    expect(norm(tid('trip-money')!.textContent)).toContain('Обменяйте сомони');

    await exchange('1100', '100');
    await waitFor(() => expect(all('trip-wallet')).toHaveLength(1));

    const wallets = (await storeOf(td).db.wallets.toArray()).filter((w) => w.currency === 'USD');
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ name: 'USD · Самарканд', kind: 'cash', openingBalanceMinor: 0 });
    const txs = (await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ amountMinor: 110_000, toAmountMinor: 10_000, toWalletId: wallets[0]!.id });
    expect(txs[0]!.note).toBe('Обмен валюты #Самарканд');

    const row = norm(tid('trip-wallet')!.textContent);
    expect(row).toContain('USD · Самарканд');
    expect(row).toContain('100 $');
    expect(row).toContain('≈ 1 100 с.');
    expect(norm(tid('trip-rates')!.textContent)).toContain('1 $ = 11 с.');
  });

  it('второй обмен в ту же валюту идёт в тот же кошелёк, курс — средневзвешенный', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await exchange('1100', '100'); // 11,0
    await waitFor(() => expect(all('trip-wallet')).toHaveLength(1));
    await exchange('565', '50'); // 11,3
    await waitFor(() => expect(norm(tid('trip-wallet')!.textContent)).toContain('150 $'));

    expect((await storeOf(td).db.wallets.toArray()).filter((w) => w.currency === 'USD')).toHaveLength(1);
    expect(all('trip-wallet')).toHaveLength(1);
    // 1 665 с. ÷ 150 $ = 11,1
    expect(norm(tid('trip-rates')!.textContent)).toContain('1 $ = 11,1 с.');
    expect(norm(tid('trip-rates')!.textContent)).toContain('2 обмена');
    expect(norm(tid('trip-wallet')!.textContent)).toContain('≈ 1 665 с.');
  });

  it('нет суммы — обмен не записан, видно, что не хватает', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await openExchange();
    await user.click(screen.getByRole('button', { name: 'Записать обмен' }));
    await waitFor(() => expect(screen.getByText('Укажите, сколько отдаёте')).toBeInTheDocument());
    expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer')).toHaveLength(0);
    expect((await storeOf(td).db.wallets.toArray()).filter((w) => w.currency === 'USD')).toHaveLength(0);
  });

  it('вернуть остаток в сомони: курс поездки не меняется, итог «с учётом возврата» показывает потерю на курсе', async () => {
    await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await exchange('1000', '100'); // 10 с. за $
    await waitFor(() => expect(all('trip-wallet')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /Вернуть остаток в с\./ }));
    await findByRole('textbox', { name: /^Отдаю/ });
    await user.click(screen.getByRole('button', { name: 'Весь остаток' }));
    expect(amount('Отдаю').value).toBe('100');
    await user.type(amount('Получаю'), '950'); // курс 9,5 вместо 10
    await user.click(screen.getByRole('button', { name: 'Записать обмен' }));

    await waitFor(() => expect(tid('trip-net')).not.toBeNull());
    expect(norm(tid('trip-net')!.textContent)).toContain('потеряно на курсе 50 с.');
    expect(norm(tid('trip-rates')!.textContent)).toContain('1 $ = 10 с.');
  });

  it('валюта получения совпала с валютой списания — подсказка, обмен не записан', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await openExchange();
    // «Получаю в валюте» не предлагает валюту кошелька списания
    const select = screen.getByRole('combobox', { name: 'Получаю в валюте' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain('TJS');
    choose('Получаю в валюте', 'EUR — Евро');
    expect(select.value).toBe('EUR');
    expect((await storeOf(td).db.transactions.toArray()).filter((t) => t.kind === 'transfer')).toHaveLength(0);
  });
});

describe('завершение поездки', () => {
  it('пустой кошелёк поездки уходит в архив; с остатком — остаётся, и об этом сказано', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await exchange('1000', '100');
    await waitFor(() => expect(all('trip-wallet')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Завершить' }));
    await waitFor(() => expect(readActiveTrip(storeOf(td).userId)).toBeNull());
    await waitFor(() => expect(screen.getByText(/остались деньги: 100 \$/)).toBeInTheDocument());
    const usd = (await storeOf(td).db.wallets.toArray()).find((w) => w.currency === 'USD')!;
    expect(usd.archivedAt).toBeNull(); // деньги остались — кошелёк не прячем
  });

  it('кошелёк с нулевым остатком архивируется при завершении', async () => {
    const td = await openPage(async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      const usd = await s.wallets.create({ name: 'USD · Самарканд', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#0ea5e9', icon: '✈️' });
      await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 110_000, toAmountMinor: 10_000, occurredOn: '2026-10-14', note: 'Обмен #Самарканд' });
      await s.transactions.create({ kind: 'expense', walletId: usd.id, amountMinor: 10_000, categoryId: null, occurredOn: '2026-10-14', note: 'всё потратили #Самарканд', fx: { rate: 11, source: 'trip' } });
    });
    await waitFor(() => expect(tid('trip-money')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Завершить' }));
    await vi.waitFor(async () => {
      const usd = (await storeOf(td).db.wallets.toArray()).find((w) => w.currency === 'USD')!;
      expect(usd.archivedAt).not.toBeNull();
    });
  });
});

describe('сколько можно тратить в день', () => {
  it('дни заданы: остаток делится на оставшиеся дни, потраченное сегодня возвращается в остаток', async () => {
    await openPage(async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      const usd = await s.wallets.create({ name: 'USD · Самарканд', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#0ea5e9', icon: '✈️' });
      await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 110_000, toAmountMinor: 10_000, occurredOn: '2026-10-14', note: 'Обмен #Самарканд' });
      // сегодня (15.10) потрачено 20 $: остаток 80 $
      await s.transactions.create({ kind: 'expense', walletId: usd.id, amountMinor: 2_000, categoryId: null, occurredOn: '2026-10-15', note: 'ужин #Самарканд', fx: { rate: 11, source: 'trip' } });
    });
    await waitFor(() => expect(tid('trip-plan-form')).not.toBeNull());
    expect(tid('trip-allowance')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: /Сколько дней осталось/ }), '4');
    await user.click(screen.getByRole('button', { name: 'Задать' }));

    await waitFor(() => expect(tid('trip-allowance')).not.toBeNull());
    // (80 + 20) ÷ 4 дня = 25 $ в день; сегодня потрачено 20 — ещё 5 $
    const text = norm(tid('trip-allowance')!.textContent);
    expect(text).toContain('Можно тратить в день: 25 $');
    expect(text).toContain('(≈ 275 с.)');
    expect(text).toContain('ещё можно 5 $');
    expect(norm(tid('trip-plan')!.textContent)).toContain('ещё на 4 дня');
  });
});
