import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import { catBtn, clickSave, liveTxs, openAddSheet, storeOf, tapAmount } from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, setActiveTrip } from '@/features/trips/activeTrip';

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
});
afterEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
  vi.restoreAllMocks();
});

describe('«Новая операция» в режиме поездки', () => {
  it('пока поездка идёт, заметка получает метку; тост называет её', async () => {
    const { td, onClose } = await openAddSheet();
    setActiveTrip(storeOf(td).userId, 'Самарканд');
    await tapAmount('25');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'такси');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 2500, note: 'такси #Самарканд' });
    await waitFor(() => expect(screen.getByText('Сохранено · #Самарканд')).toBeTruthy());
  });

  it('пустая заметка превращается в одну метку; метка, набранная руками, не дублируется', async () => {
    const { td, onClose } = await openAddSheet();
    setActiveTrip(storeOf(td).userId, 'Самарканд');
    await tapAmount('10');
    await user.click(catBtn('Еда'));
    await clickSave('Сохранить и добавить ещё одну');
    await waitFor(() => expect(screen.getByText('Сохранено · #Самарканд')).toBeTruthy());
    await waitFor(() => expect((screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value).toBe(''));
    await tapAmount('5');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'плов #самарканд');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const notes = (await liveTxs(td)).map((t) => t.note).sort();
    expect(notes).toEqual(['#Самарканд', 'плов #самарканд']);
  });

  it('без поездки заметка остаётся как есть, тост прежний', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('25');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'такси');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]!.note).toBe('такси');
    await waitFor(() => expect(screen.getByText('Сохранено')).toBeTruthy());
  });
});
