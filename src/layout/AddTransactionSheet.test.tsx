import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { act, screen, user, waitFor } from '@/components/testUtils';
import {
  allTxs,
  amountField,
  balancesOf,
  cashWallet,
  categoryByName,
  chipLabels,
  clickSave,
  contextChip,
  dateInput,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickDate,
  pickWallet,
  setDateInput,
  storeOf,
  tapAmount,
  withCard,
} from '@/features/transactions/__fixtures__/opsKit';
import { addDays, todayLocal } from '@/lib/dates';

afterEach(() => vi.restoreAllMocks());

describe('обычный расход', () => {
  it('сумма «12,5» → категория → «Сохранить»: в базе 1250, кошелёк и дата подставились сами', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('12,5');
    await user.click(screen.getByRole('button', { name: 'Еда' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const [tx, ...rest] = await liveTxs(td);
    expect(rest).toHaveLength(0);
    const cash = await cashWallet(td);
    const food = await categoryByName(td, 'Еда');
    expect(tx).toMatchObject({
      kind: 'expense',
      walletId: cash.id,
      amountMinor: 1250,
      categoryId: food.id,
      occurredOn: todayLocal(),
      note: '',
      baseCurrency: 'TJS',
      baseAmountMinor: 1250,
      fxRate: 1,
      fxSource: 'same',
      toWalletId: null,
      toAmountMinor: null,
      dirty: 1,
    });
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
  });

  it('сумма вводится с клавиатуры ПК: «12,5» и «12.5» дают одно и то же', async () => {
    const { td, onClose } = await openAddSheet();
    await user.type(amountField(), '12.5');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.amountMinor).toBe(1250);
  });

  it('категорию можно не выбирать; повторное касание выбранной категории снимает выбор', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('30');
    const food = screen.getByRole('button', { name: 'Еда' });
    await user.click(food);
    expect(screen.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Еда' }));
    expect(screen.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'false');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 3000, categoryId: null });
  });

  it('заметка сохраняется без лишних пробелов', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('5');
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), '  хлеб и молоко ');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.note).toBe('хлеб и молоко');
  });

  it('«Вчера» одним касанием', async () => {
    const { td } = await openAddSheet();
    await tapAmount('7');
    await pickDate('Вчера');
    await clickSave();
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect((await liveTxs(td))[0]?.occurredOn).toBe(addDays(todayLocal(), -1));
  });

  it('другая дата: календарь; граничные 2000-01-01 и 2100-01-01 принимаются', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('7');
    await pickDate('Другая дата');
    setDateInput(dateInput(), '2000-01-01');
    await user.click(screen.getByRole('button', { name: 'Сохранить и добавить ещё' }));
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));

    await tapAmount('8');
    setDateInput(dateInput(), '2100-01-01');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect((await liveTxs(td)).map((t) => t.occurredOn).sort()).toEqual(['2000-01-01', '2100-01-01']);
  });
});

describe('доход', () => {
  it('переключатель «Доход» показывает категории доходов; остаток растёт', async () => {
    const { td, onClose } = await openAddSheet();
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.queryByRole('button', { name: 'Еда' })).toBeNull();
    await tapAmount('1000');
    await user.click(screen.getByRole('button', { name: 'Зарплата' }));
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const salary = await categoryByName(td, 'Зарплата', 'income');
    const cash = await cashWallet(td);
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'income', amountMinor: 100_000, categoryId: salary.id });
    expect((await balancesOf(td)).get(cash.id)).toBe(100_000);
  });

  it('при смене вида выбранная категория сбрасывается (расход и доход — разные категории)', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('10');
    await user.click(screen.getByRole('button', { name: 'Еда' }));
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await user.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(screen.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'false');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.categoryId).toBeNull();
  });
});

describe('кошелёк по умолчанию и частые категории', () => {
  it('подставляется кошелёк последней внесённой операции', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        await withCard(s);
        const card = (await s.db.wallets.toArray()).find((w) => w.name === 'Карта');
        await s.transactions.create({ kind: 'expense', walletId: card?.id ?? '', amountMinor: 100, occurredOn: todayLocal() });
      },
    });
    await openAddSheet(td);
    expect(contextChip('Кошелёк').getAttribute('aria-label')).toBe('Кошелёк: Карта');
  });

  it('операций ещё нет — берётся кошелёк по умолчанию из настроек', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        await withCard(s);
        const card = (await s.db.wallets.toArray()).find((w) => w.name === 'Карта');
        await s.settings.update({ defaultWalletId: card?.id ?? null });
      },
    });
    await openAddSheet(td);
    expect(contextChip('Кошелёк').getAttribute('aria-label')).toBe('Кошелёк: Карта');
  });

  it('кошелёк меняется чипом; операция попадает в выбранный', async () => {
    const td = opsDeps([], { setup: withCard });
    const { onClose } = await openAddSheet(td);
    await pickWallet('Карта');
    expect(contextChip('Кошелёк').getAttribute('aria-label')).toBe('Кошелёк: Карта');
    await tapAmount('15');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const card = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Карта');
    expect((await liveTxs(td))[0]?.walletId).toBe(card?.id);
  });

  it('категории: сначала самые частые за 90 дней, затем остальные в обычном порядке', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray())[0];
        const cats = await s.db.categories.toArray();
        const id = (name: string) => cats.find((c) => c.name === name && c.kind === 'expense')?.id ?? '';
        const add = (name: string, on: string) =>
          s.transactions.create({ kind: 'expense', walletId: cash?.id ?? '', amountMinor: 100, categoryId: id(name), occurredOn: on });
        const today = todayLocal();
        await add('Транспорт', today);
        await add('Транспорт', addDays(today, -3));
        await add('Транспорт', addDays(today, -10));
        await add('Покупки', addDays(today, -5));
        // старше 90 дней — не считается
        await add('Здоровье', addDays(today, -200));
        await add('Здоровье', addDays(today, -201));
        await add('Здоровье', addDays(today, -202));
      },
    });
    await openAddSheet(td);
    const labels = chipLabels('Категория');
    expect(labels.slice(0, 5)).toEqual(['Транспорт', 'Покупки', 'Еда', 'Продукты', 'Жильё']); // остальные — в порядке из затравки
    expect(labels).toHaveLength(12);
  });
});

describe('защита от двойного нажатия и повтора', () => {
  it('два нажатия «Сохранить» подряд — одна операция', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('42');
    const button = screen.getByRole('button', { name: 'Сохранить' });
    // оба нажатия — до того как React успел перерисовать кнопку
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await allTxs(td)).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('пока идёт сохранение, обе кнопки отключены, а повторный вызов не создаёт вторую операцию', async () => {
    const { td, onClose } = await openAddSheet();
    const store = storeOf(td);
    const real = store.transactions.create.bind(store.transactions);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const spy = vi.spyOn(store.transactions, 'create').mockImplementationOnce(async (input, opts) => {
      await gate;
      return real(input, opts);
    });
    await tapAmount('42');
    await clickSave();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Сохранить и добавить ещё' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await allTxs(td)).toHaveLength(1);
  });

  it('сбой «после записи»: повторное «Сохранить» отправляет тот же номер операции — дубля нет', async () => {
    const { td, onClose } = await openAddSheet();
    const store = storeOf(td);
    const real = store.transactions.create.bind(store.transactions);
    const spy = vi.spyOn(store.transactions, 'create').mockImplementationOnce(async (input, opts) => {
      await real(input, opts); // записалось…
      throw new Error('ответ потерян'); // …а экран об этом не узнал
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await tapAmount('99');
    await clickSave();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить'));
    expect(onClose).not.toHaveBeenCalled();
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[1]?.id).toBeTruthy();
    expect(spy.mock.calls[0]?.[1]?.id).toBe(spy.mock.calls[1]?.[1]?.id);
    expect(await allTxs(td)).toHaveLength(1);
  });
});

describe('тост «Сохранено» и отмена', () => {
  it('«Отменить» в тосте мягко удаляет операцию: строка остаётся, остаток возвращается', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('250');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const cash = await cashWallet(td);
    expect((await balancesOf(td)).get(cash.id)).toBe(-25_000);

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.getByText('Операция отменена')).toBeInTheDocument());
    const rows = await allTxs(td);
    expect(rows).toHaveLength(1); // физически не удалена
    expect(rows[0]?.deletedAt).not.toBeNull();
    expect((await balancesOf(td)).get(cash.id)).toBe(0);
  });
});

describe('«Сохранить и добавить ещё»', () => {
  it('сохраняет, очищает сумму и категорию, оставляет шит открытым; вторая операция — отдельная', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('5');
    await user.click(screen.getByRole('button', { name: 'Еда' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить и добавить ещё' }));
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect((amountField() as HTMLInputElement).value).toBe(''));
    expect(screen.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'false');

    await tapAmount('7');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const rows = await liveTxs(td);
    expect(rows.map((r) => r.amountMinor).sort()).toEqual([500, 700]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});
