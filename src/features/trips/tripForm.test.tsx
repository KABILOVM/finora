import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import {
  choose,
  clickSave,
  fxNotice,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickWallet,
  pinToday,
  tapAmount,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, setActiveTrip } from './activeTrip';

/**
 * «Новая операция» в поездке: валюта, обменянная по своему курсу, пересчитывается по нему (а не по курсу Нацбанка),
 * и сумма в сомони видна, пока человек вводит трату. «Сегодня» закреплено на 15.10.2026.
 */

beforeEach(() => {
  pinToday();
  forgetActiveTripCache();
  window.localStorage.clear();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/** Кошелёк «Доллары» и обмен 1 100 с. → 100 $ с меткой поездки: 1 $ = 11 с. (курс Нацбанка в тестах 10,9). */
const exchanged = (tag: string | null) => async (s: Store) => {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные');
  if (!cash) throw new Error('Нет кошелька «Наличные»');
  const usd = await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' });
  await s.transactions.create({
    kind: 'transfer',
    walletId: cash.id,
    toWalletId: usd.id,
    amountMinor: 110_000,
    toAmountMinor: 10_000,
    occurredOn: '2026-10-14',
    note: 'Обмен #Самарканд',
  });
  if (tag !== null) setActiveTrip(s.userId, tag);
};

describe('форма траты в поездке', () => {
  it('в долларах: курс вашего обмена, «≈ N с.» при вводе, трата записана по курсу поездки (источник «trip»)', async () => {
    const td = opsDeps([{ asOf: '2026-10-10', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.9 }, source: 'nbt', fetchedAt: '2026-10-10T08:00:00.000Z' }], {
      setup: exchanged('Самарканд'),
    });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');

    await waitFor(() => expect(fxNotice()).toHaveTextContent('Курс вашего обмена'));
    expect(fxNotice()).toHaveTextContent('1 $ = 11 с.');
    expect(document.querySelector('[data-testid="fx-trip-preview"]')).toHaveTextContent('≈ 110 с.');

    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [t] = (await liveTxs(td)).filter((x) => x.kind === 'expense');
    expect(t).toMatchObject({ amountMinor: 1000, baseAmountMinor: 11_000, fxRate: 11, fxSource: 'trip' });
    expect(t?.note).toContain('#Самарканд');
  });

  it('поездка не начата — курс Нацбанка, как раньше', async () => {
    const td = opsDeps([{ asOf: '2026-10-10', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.9 }, source: 'nbt', fetchedAt: '2026-10-10T08:00:00.000Z' }], {
      setup: exchanged(null),
    });
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await waitFor(() => expect(fxNotice()).toHaveTextContent('1 $ = 10,9 с.'));
    expect(fxNotice()).not.toHaveTextContent('вашего обмена');
  });

  it('курса Нацбанка нет совсем, а обмен в поездке был — форма курс не просит', async () => {
    const td = opsDeps([], { setup: exchanged('Самарканд') });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('5');
    await waitFor(() => expect(fxNotice()).toHaveTextContent('Курс вашего обмена'));
    expect(screen.queryByRole('textbox', { name: /^Курс/ })).toBeNull();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td)).find((x) => x.kind === 'expense')).toMatchObject({ baseAmountMinor: 5500, fxSource: 'trip' });
  });
});

describe('оплата картой в сомони в поездке: сумма на чеке', () => {
  const nbt = [{ asOf: '2026-10-10', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.9 }, source: 'nbt', fetchedAt: '2026-10-10T08:00:00.000Z' }] as const;
  const receipt = () => screen.getByRole('textbox', { name: /^Сумма на чеке/ }) as HTMLInputElement;
  const openReceipt = () => user.click(screen.getByRole('button', { name: 'Сумма на чеке в другой валюте' }));
  const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('списали 135 с., на чеке 50 AED: обе суммы сохранены, курс карты виден', async () => {
    const td = opsDeps([...nbt], { setup: async (s) => void setActiveTrip(s.userId, 'Дубай') });
    const { onClose } = await openAddSheet(td);
    await tapAmount('135');
    await openReceipt();
    choose('Валюта чека', 'AED');
    await user.type(receipt(), '50');
    await waitFor(() => expect(tid('card-rate')).toHaveTextContent('Курс карты: 1 AED = 2,7 с.'));

    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [t] = (await liveTxs(td)).filter((x) => x.kind === 'expense');
    expect(t).toMatchObject({ amountMinor: 13_500, baseAmountMinor: 13_500, foreignCurrency: 'AED', foreignAmountMinor: 5_000 });
    expect(t?.note).toContain('#Дубай');
  });

  it('поездка не начата — кнопки «Сумма на чеке» нет', async () => {
    const td = opsDeps([...nbt]);
    await openAddSheet(td);
    await tapAmount('5');
    expect(screen.queryByRole('button', { name: 'Сумма на чеке в другой валюте' })).toBeNull();
  });

  it('сумма на чеке введена, валюта не выбрана — подсказка у поля, операция не записана', async () => {
    const td = opsDeps([...nbt], { setup: async (s) => void setActiveTrip(s.userId, 'Дубай') });
    const { onClose } = await openAddSheet(td);
    await tapAmount('135');
    await openReceipt();
    choose('Валюта чека', 'Валюта…');
    await user.type(receipt(), '50');
    await clickSave();
    await waitFor(() => expect(screen.getByText('Выберите валюту чека')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect((await liveTxs(td)).filter((x) => x.kind === 'expense')).toHaveLength(0);
  });

  it('открыли поле и ничего не ввели — операция сохраняется без суммы на чеке', async () => {
    const td = opsDeps([...nbt], { setup: async (s) => void setActiveTrip(s.userId, 'Дубай') });
    const { onClose } = await openAddSheet(td);
    await tapAmount('20');
    await openReceipt();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [t] = (await liveTxs(td)).filter((x) => x.kind === 'expense');
    expect(t).toMatchObject({ amountMinor: 2_000, foreignCurrency: null, foreignAmountMinor: null });
  });
});
