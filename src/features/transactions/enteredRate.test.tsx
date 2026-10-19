import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import {
  allTxs,
  clickSave,
  fxNotice,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickWallet,
  pinToday,
  storeOf,
  table,
  tapAmount,
  unpinToday,
  withUsd,
} from './__fixtures__/opsKit';

/**
 * Курс, который человек набрал в форме операции, запоминается как «введённый» (отдельный запасной слой).
 * «Сегодня» закреплено на 15.10.2026; сервис курсов живёт в 10.10.2026, поэтому курс подписан «введён вручную 10.10».
 */

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const rateField = () => screen.getByRole('textbox', { name: /^Курс/ }) as HTMLInputElement;
const changeRate = () => user.click(screen.getByRole('button', { name: 'Изменить курс' }));

describe('курс набран в «Новой операции»', () => {
  it('курса не было: после сохранения он запомнен как введённый (не «Свой курс»), операция — по нему', async () => {
    const td = opsDeps([], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await user.type(rateField(), '11');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 1000, baseAmountMinor: 11_000, fxRate: 11, fxSource: 'manual' });
    expect(td.rates.listEnteredRates()).toMatchObject([{ from: 'USD', to: 'TJS', rate: 11, enteredOn: '2026-10-10' }]);
    expect(td.rates.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true, manual: false, asOf: '2026-10-10' });
  });

  it('не сохранилось — не запомнилось', async () => {
    const td = opsDeps([], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(storeOf(td).transactions, 'create').mockRejectedValue(new Error('диск полон'));
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await user.type(rateField(), '11');
    await clickSave();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(td.rates.listEnteredRates()).toEqual([]);
    expect(td.rates.getRate('USD', 'TJS')).toBeNull();
  });

  it('не прошла проверка формы (курс — мусор) — тоже не запомнилось', async () => {
    const td = opsDeps([], { setup: withUsd });
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await user.type(rateField(), '1e3');
    await clickSave();
    await waitFor(() => expect(screen.getByText('Курс — число больше нуля, например 10,9')).toBeInTheDocument());
    expect(td.rates.listEnteredRates()).toEqual([]);
  });

  it('«Сохранить и добавить ещё»: следующая операция в долларах уже идёт по введённому курсу, поле спрятано за «Изменить»', async () => {
    const td = opsDeps([], { setup: withUsd });
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await user.type(rateField(), '11');
    await clickSave('Сохранить и добавить ещё');
    await waitFor(() => expect(td.rates.listEnteredRates()).toHaveLength(1));

    // форма очищена; курс подставлен сам и подписан
    await waitFor(() => expect(fxNotice()).toHaveTextContent('введён вручную 10.10'));
    expect(fxNotice()).toHaveTextContent('1 $ = 11 с.');
    expect(screen.queryByRole('textbox', { name: /^Курс/ })).toBeNull();
    await tapAmount('5');
    expect(fxNotice()).toHaveTextContent('≈ 55 с.');

    const remember = vi.spyOn(td.rates, 'rememberEnteredRate');
    await clickSave();
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(2));
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 500, baseAmountMinor: 5500, fxRate: 11, fxSource: 'manual' });
    expect(remember).not.toHaveBeenCalled(); // курс не набирали — запоминать нечего
  });

  it('«Изменить»: новый курс идёт в операцию и заменяет введённый', async () => {
    const td = opsDeps([], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 11);
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await changeRate();
    expect(rateField().value).toBe(''); // пустое поле = оставить курс как есть
    await user.type(rateField(), '12');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ baseAmountMinor: 12_000, fxRate: 12, fxSource: 'manual' });
    expect(td.rates.listEnteredRates()).toMatchObject([{ rate: 12 }]);
  });

  it('«Изменить», но набрали тот же курс: ничего заново не запоминается', async () => {
    const td = opsDeps([], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 11);
    const remember = vi.spyOn(td.rates, 'rememberEnteredRate');
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await changeRate();
    await user.type(rateField(), '11,0');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ baseAmountMinor: 11_000, fxRate: 11 });
    expect(remember).not.toHaveBeenCalled();
  });

  it('«Изменить» и мусор вместо курса: понятная ошибка, ничего не сохранено и не запомнено', async () => {
    const td = opsDeps([], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 11);
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    await changeRate();
    await user.type(rateField(), 'abc');
    await clickSave();
    await waitFor(() => expect(screen.getByText('Курс — число больше нуля, например 10,9')).toBeInTheDocument());
    expect(await allTxs(td)).toHaveLength(0);
    expect(td.rates.getRate('USD', 'TJS')).toMatchObject({ rate: 11 });
  });

  it('свежий курс Нацбанка сильнее введённого: операция по Нацбанку, «Изменить» не предлагается, ничего не запоминается', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 99);
    const remember = vi.spyOn(td.rates, 'rememberEnteredRate');
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    expect(fxNotice()).toHaveTextContent('1 $ = 10,9 с.');
    expect(fxNotice()).not.toHaveTextContent('введён');
    expect(screen.queryByRole('button', { name: 'Изменить курс' })).toBeNull();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ baseAmountMinor: 10_900, fxRate: 10.9, fxSource: 'nbt' });
    expect(remember).not.toHaveBeenCalled();
  });

  it('курс Нацбанка устарел: введённый ранее курс его заменяет (и подписан), «Своего курса» это не касается', async () => {
    const td = opsDeps([table({ asOf: '2026-10-01' })], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 11);
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    expect(fxNotice()).toHaveTextContent('введён вручную 10.10');
    expect(fxNotice()).not.toHaveTextContent('устарел');
    td.rates.setManualRate('USD', 'TJS', 10.5);
    await waitFor(() => expect(fxNotice()).toHaveTextContent('задан вручную'));
    expect(fxNotice()).toHaveTextContent('1 $ = 10,5 с.');
  });

  it('перевод между валютами по введённому курсу: подпись «введён вручную», в тексте нет двойной точки', async () => {
    const td = opsDeps([], { setup: withUsd });
    td.rates.rememberEnteredRate('USD', 'TJS', 11);
    await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('10');
    // сначала списываем сомони (курса с. → $ не вводили), потом доллары (курс $ → с. введён)
    expect(await waitFor(() => screen.getByText(/Курса с\. → \$ нет/))).toBeInTheDocument();
    await pickWallet('Доллары · USD', 'Откуда');
    const text = await waitFor(() => screen.getByText(/По курсу 1/));
    expect(text.textContent).toContain('введён вручную 10.10');
    expect(text.textContent).not.toContain('..');
    expect(text.textContent).toMatch(/получится ≈ [\d\s,]+с\. Сумму можно изменить\.$/);
  });
});
