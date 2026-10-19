import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import {
  allTxs,
  amountField,
  balancesOf,
  clickSave,
  contextChip,
  fxNotice,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickWallet,
  storeOf,
  table,
  tapAmount,
  withCard,
  withUsd,
} from '@/features/transactions/__fixtures__/opsKit';

afterEach(() => vi.restoreAllMocks());

describe('валюты', () => {
  it('расход в долларах: курс подставляется сам, в операции — снимок суммы в сомони', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    expect(fxNotice()).toHaveTextContent('1 $ = 10,9 с.');
    expect(fxNotice()).toHaveTextContent('≈ 109 с.');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const usd = (await storeOf(td).db.wallets.toArray()).find((w) => w.currency === 'USD');
    expect((await liveTxs(td))[0]).toMatchObject({
      walletId: usd?.id,
      amountMinor: 1000,
      baseCurrency: 'TJS',
      baseAmountMinor: 10_900,
      fxRate: 10.9,
      fxSource: 'nbt',
    });
  });

  it('устаревший курс: предупреждение с датой, но ввод не блокируется', async () => {
    const td = opsDeps([table({ asOf: '2026-10-01' })], { setup: withUsd }); // «сегодня» 10.10 → курсу 9 суток
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('1');
    expect(fxNotice()).toHaveTextContent('Курс устарел: он на 01.10.2026');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ baseAmountMinor: 1090, fxSource: 'nbt' });
  });

  it('ручной курс из настроек помечен, и в операции он как ручной', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    td.rates.setManualRate('USD', 'TJS', 11);
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('2');
    expect(fxNotice()).toHaveTextContent('задан вручную');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ baseAmountMinor: 2200, fxRate: 11, fxSource: 'manual' });
  });

  it('курса нет совсем: появляется поле «Курс»; без него операция не сохраняется, с ним — сохраняется как ручной курс', async () => {
    const td = opsDeps([], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    const rate = screen.getByRole('textbox', { name: /^Курс/ });

    await clickSave();
    expect(await waitFor(() => screen.getByText(/Курса пока нет — введите его/))).toBeInTheDocument();
    expect(await allTxs(td)).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    await user.type(rate, 'abc');
    await clickSave();
    expect(await waitFor(() => screen.getByText('Курс — число больше нуля, например 10,9'))).toBeInTheDocument();
    expect(await allTxs(td)).toHaveLength(0);

    await user.clear(rate);
    await user.type(rate, '10,95');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 1000, baseAmountMinor: 10_950, fxRate: 10.95, fxSource: 'manual' });
    // курс запомнен отдельным слоем «введённых» курсов (не «Свой курс»): он годится, пока нет свежего курса из сети,
    // и никогда не перекрывает свежий курс Нацбанка (см. src/rates/entered.test.ts)
    expect(td.rates.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, entered: true, manual: false });
  });

  it('вместо курса — мусор вроде «1e3», «0» или «-5»: не принимается', async () => {
    const td = opsDeps([], { setup: withUsd });
    await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('10');
    for (const bad of ['1e3', '0', '-5', '1,2,3']) {
      const rate = screen.getByRole('textbox', { name: /^Курс/ });
      await user.clear(rate);
      await user.type(rate, bad);
      await clickSave();
      await waitFor(() => expect(screen.getByText('Курс — число больше нуля, например 10,9')).toBeInTheDocument());
    }
    expect(await allTxs(td)).toHaveLength(0);
  });

  it('огромная сумма в долларах не помещается в сомони: понятная ошибка у суммы, ничего не записано', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await pickWallet('Доллары · USD');
    await tapAmount('9999999999999,99');
    await clickSave();
    await waitFor(() => expect(screen.getByText(/Сумма слишком велика для пересчёта/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(await allTxs(td)).toHaveLength(0);
    // после исправления суммы то же окно сохраняет (тот же номер операции, строки не было)
    for (let i = 0; i < 20; i++) await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await tapAmount('5');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await liveTxs(td)).toHaveLength(1);
  });
});

describe('переводы', () => {
  it('в разных валютах: «Получено» предлагается по курсу и правится; остатки обоих кошельков верны', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('109');
    const received = await waitFor(() => screen.getByRole('textbox', { name: /^Получено/ }));
    expect((received as HTMLInputElement).value).toBe('10');
    expect(screen.getByText(/получится ≈ 10 \$/)).toBeInTheDocument();

    await user.clear(received);
    await user.type(received, '9,5'); // курс обмена в обменнике хуже
    expect(screen.getByRole('button', { name: 'Подставить по курсу' })).toBeInTheDocument();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const wallets = await storeOf(td).db.wallets.toArray();
    const cash = wallets.find((w) => w.currency === 'TJS');
    const usd = wallets.find((w) => w.currency === 'USD');
    expect((await liveTxs(td))[0]).toMatchObject({
      kind: 'transfer',
      walletId: cash?.id,
      toWalletId: usd?.id,
      amountMinor: 10_900,
      toAmountMinor: 950,
      categoryId: null,
      baseAmountMinor: 0,
      fxRate: null,
      fxSource: null,
    });
    const balances = await balancesOf(td);
    expect(balances.get(cash?.id ?? '')).toBe(-10_900);
    expect(balances.get(usd?.id ?? '')).toBe(100_000 + 950);
  });

  it('«Подставить по курсу» возвращает предложенную сумму', async () => {
    const td = opsDeps([table()], { setup: withUsd });
    await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('109');
    const received = await waitFor(() => screen.getByRole('textbox', { name: /^Получено/ }));
    await user.clear(received);
    await user.type(received, '9');
    await user.click(screen.getByRole('button', { name: 'Подставить по курсу' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: /^Получено/ }) as HTMLInputElement).value).toBe('10'));
    expect(screen.queryByRole('button', { name: 'Подставить по курсу' })).toBeNull();
  });

  it('курса между валютами нет: перевод не блокируется — сумму зачисления вводят руками', async () => {
    const td = opsDeps([], { setup: withUsd });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('100');
    expect(screen.getByText(/Курса с\. → \$ нет/)).toBeInTheDocument();
    await clickSave();
    expect(await waitFor(() => screen.getByText('Курса нет — введите, сколько денег пришло'))).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Получено/ }), '9');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 10_000, toAmountMinor: 900 });
  });

  it('в одной валюте: зачисление равно списанию; комиссия суммой вычитается из зачисления', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('100');
    expect(screen.queryByRole('textbox', { name: 'Комиссия' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    const fee = screen.getByRole('textbox', { name: /^Комиссия/ });
    await user.type(fee, '2');
    expect(screen.getByText('Получит: 98 с.')).toBeInTheDocument();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 10_000, toAmountMinor: 9800 });
  });

  it('комиссия в процентах считается сама и пересчитывается при смене суммы', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('200');
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    await user.click(screen.getByRole('radio', { name: 'Проценты' }));
    await user.type(screen.getByRole('textbox', { name: 'Комиссия в процентах' }), '1,5');
    expect(screen.getByText('Комиссия: 3 с.')).toBeInTheDocument();
    expect(screen.getByText('Получит: 197 с.')).toBeInTheDocument();
    await tapAmount('⌫0'); // 200 → 20 → 200
    // ещё один нуль: 2000
    await tapAmount('0');
    expect(screen.getByText('Получит: 1 970 с.')).toBeInTheDocument();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 200_000, toAmountMinor: 197_000 });
  });

  it('на телефоне комиссия суммой тоже печатается экранной клавиатурой (системная не открывается)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const td = opsDeps([], { setup: withCard });
      await openAddSheet(td);
      await user.click(screen.getByRole('radio', { name: 'Перевод' }));
      await tapAmount('200');
      await user.click(screen.getByRole('button', { name: 'Комиссия' }));
      const fee = screen.getByRole('textbox', { name: /^Комиссия/ }) as HTMLInputElement;
      expect(fee.getAttribute('inputmode')).toBe('none');
      await tapAmount('5');
      expect(fee.value).toBe('5');
      expect(screen.getByText('Получит: 195 с.')).toBeInTheDocument();
      await user.click(screen.getByRole('textbox', { name: 'Сумма списания, Сомони' }));
      await tapAmount('0');
      expect(fee.value).toBe('5');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('на телефоне комиссия суммой с копейками: «2 , 5» — это 2,50, а не 25; запятая видна сразу, «⌫» стирает по знаку', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const td = opsDeps([], { setup: withCard });
      const { onClose } = await openAddSheet(td);
      await user.click(screen.getByRole('radio', { name: 'Перевод' }));
      await tapAmount('200');
      await user.click(screen.getByRole('button', { name: 'Комиссия' }));
      const fee = screen.getByRole('textbox', { name: /^Комиссия/ }) as HTMLInputElement;
      await tapAmount('2,');
      expect(fee.value).toBe('2,');
      await tapAmount('5');
      expect(fee.value).toBe('2,5');
      expect(screen.getByText('Получит: 197,50 с.')).toBeInTheDocument();
      await tapAmount('⌫');
      expect(fee.value).toBe('2,');
      await tapAmount('05');
      expect(fee.value).toBe('2,05');
      expect(screen.getByText('Получит: 197,95 с.')).toBeInTheDocument();
      // клавиши снова у основной суммы: комиссия остаётся прежней
      await user.click(screen.getByRole('textbox', { name: 'Сумма списания, Сомони' }));
      await tapAmount('0');
      expect(fee.value).toBe('2,05');
      expect(amountField().value).toBe('2\u00A0000');
      await clickSave();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 200_000, toAmountMinor: 199_795 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('на телефоне расход с комиссией «0 , 5»: в поле 0,5, в итоге и в операции +50 дирамов', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const td = opsDeps([], { setup: withCard });
      const { onClose } = await openAddSheet(td);
      await tapAmount('100');
      await user.click(screen.getByRole('button', { name: 'Комиссия' }));
      const fee = screen.getByRole('textbox', { name: /^Комиссия/ }) as HTMLInputElement;
      await tapAmount('0,5');
      expect(fee.value).toBe('0,5');
      expect(screen.getByText('Итого спишется: 100,50 с.')).toBeInTheDocument();
      // знаки калькулятора в комиссию не попадают
      await user.click(screen.getByRole('button', { name: 'Плюс' }));
      expect(fee.value).toBe('0,5');
      expect(amountField().value).toBe('100');
      await clickSave();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await liveTxs(td))[0]).toMatchObject({ kind: 'expense', amountMinor: 10_050 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('на телефоне процент комиссии печатается экранной клавиатурой (системная не открывается), тап по сумме возвращает клавиши к ней', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const td = opsDeps([], { setup: withCard });
      const { onClose } = await openAddSheet(td);
      await user.click(screen.getByRole('radio', { name: 'Перевод' }));
      await tapAmount('200');
      await user.click(screen.getByRole('button', { name: 'Комиссия' }));
      await user.click(screen.getByRole('radio', { name: 'Проценты' }));
      const pct = screen.getByRole('textbox', { name: 'Комиссия в процентах' }) as HTMLInputElement;
      expect(pct.getAttribute('inputmode')).toBe('none');
      await tapAmount('1,5');
      expect(pct.value).toBe('1,5');
      expect(screen.getByText('Получит: 197 с.')).toBeInTheDocument();
      await tapAmount('⌫⌫⌫2,,');
      expect(pct.value).toBe('2,');
      await user.click(screen.getByRole('textbox', { name: 'Сумма списания, Сомони' }));
      await tapAmount('0');
      expect(pct.value).toBe('2,');
      expect(screen.getByText(/Получит: 1 960 с\./)).toBeInTheDocument();
      await clickSave();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 200_000, toAmountMinor: 196_000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('комиссия не меньше суммы перевода нельзя: сообщение у поля, ничего не сохранено', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('100');
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    await user.type(screen.getByRole('textbox', { name: /^Комиссия/ }), '100');
    await clickSave();
    expect(await waitFor(() => screen.getByText('Комиссия должна быть меньше суммы перевода'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(await allTxs(td)).toHaveLength(0);
  });

  it('расход: комиссия добавляется к списанию, итог показан, сохраняется одной операцией на всю сумму', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await tapAmount('100');
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    await user.click(screen.getByRole('radio', { name: 'Проценты' }));
    await user.type(screen.getByRole('textbox', { name: 'Комиссия в процентах' }), '2');
    expect(screen.getByText('Итого спишется: 102 с.')).toBeInTheDocument();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'expense', amountMinor: 10_200 });
  });

  it('комиссия расхода не пропадает при смене кошелька в той же валюте и убирается при смене валюты', async () => {
    const td = opsDeps([table()], {
      setup: async (st) => {
        await withCard(st);
        await withUsd(st);
      },
    });
    const { onClose } = await openAddSheet(td);
    await tapAmount('100');
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    await user.click(screen.getByRole('radio', { name: 'Проценты' }));
    await user.type(screen.getByRole('textbox', { name: 'Комиссия в процентах' }), '2');
    expect(screen.getByText('Итого спишется: 102 с.')).toBeInTheDocument();
    // «Наличные» → «Карта»: обе в сомони — комиссия остаётся
    await pickWallet('Карта · TJS');
    expect(screen.getByText('Итого спишется: 102 с.')).toBeInTheDocument();
    // другая валюта — как и раньше, комиссия сбрасывается
    await pickWallet('Доллары · USD');
    expect(screen.queryByText(/Итого спишется/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('неверный процент: понятная ошибка, расход не сохраняется', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await tapAmount('100');
    await user.click(screen.getByRole('button', { name: 'Комиссия' }));
    await user.click(screen.getByRole('radio', { name: 'Проценты' }));
    await user.type(screen.getByRole('textbox', { name: 'Комиссия в процентах' }), '150');
    await clickSave();
    expect(await waitFor(() => screen.getByText(/Процент — число больше нуля и меньше 100/))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(await allTxs(td)).toHaveLength(0);
  });

  it('без комиссии зачисление равно списанию, даже если сумму потом поменяли', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await tapAmount('100⌫5'); // 100 → 10 → 105
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 10_500, toAmountMinor: 10_500 });
  });

  it('«Куда» не совпадает с «Откуда»; при одном кошельке переводить некуда — сообщение вместо чипов', async () => {
    await openAddSheet();
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.getByText(/Для перевода нужен второй кошелёк/)).toBeInTheDocument();
    await tapAmount('10');
    await clickSave();
    expect(await waitFor(() => screen.getByText('Выберите, куда переводите'))).toBeInTheDocument();
  });

  it('смена «Откуда» на кошелёк «Куда» подбирает другой «Куда»', async () => {
    const td = opsDeps([], { setup: withCard });
    await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    // по умолчанию: откуда «Наличные», куда «Карта»
    expect(contextChip('Куда').getAttribute('aria-label')).toBe('Куда: Карта');
    await pickWallet('Карта', 'Откуда');
    // «Куда» было «Карта» — теперь оно совпало бы с «Откуда», поэтому подобрался другой кошелёк
    expect(contextChip('Откуда').getAttribute('aria-label')).toBe('Откуда: Карта');
    expect(contextChip('Куда').getAttribute('aria-label')).toBe('Куда: Наличные');
  });
});
