import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, user, waitFor } from '@/components/testUtils';
import { ValidationError } from '@/db';
import {
  allTxs,
  amountField,
  clickSave,
  currentPath,
  dateInput,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickDate,
  setDateInput,
  storeOf,
  tapAmount,
} from '@/features/transactions/__fixtures__/opsKit';

afterEach(() => vi.restoreAllMocks());

describe('проверка ввода', () => {
  it('пустая сумма и ноль не сохраняются: понятное сообщение у поля, шит остаётся открытым', async () => {
    const { td, onClose } = await openAddSheet();
    await clickSave();
    expect(await waitFor(() => screen.getByText('Введите сумму'))).toBeInTheDocument();
    await tapAmount('0');
    await clickSave();
    expect(await waitFor(() => screen.getByText('Сумма должна быть больше нуля'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(await allTxs(td)).toHaveLength(0);
  });

  it('сообщение об ошибке пропадает, когда человек начал исправлять поле', async () => {
    await openAddSheet();
    await clickSave();
    await waitFor(() => expect(screen.getByText('Введите сумму')).toBeInTheDocument());
    await tapAmount('5');
    expect(screen.queryByText('Введите сумму')).toBeNull();
  });

  it('мусор в поле суммы: буквы и знаки отбрасываются, «1e5» и два числа не читаются', async () => {
    const { td } = await openAddSheet();
    const field = amountField() as HTMLInputElement;
    await user.type(field, 'abc');
    expect(field.value).toBe('');
    await user.type(field, '-');
    expect(field.value).toBe('');
    await user.paste('1e5');
    expect(await waitFor(() => screen.getByText('Не удалось прочитать сумму. Введите её вручную.'))).toBeInTheDocument();
    expect(field.value).toBe('');
    await user.paste('12abc34');
    expect(field.value).toBe('');
    await clickSave();
    expect(await waitFor(() => screen.getByText('Введите сумму'))).toBeInTheDocument();
    expect(await allTxs(td)).toHaveLength(0);
  });

  it('большое число: больше 13 цифр до запятой не набрать; максимум сохраняется точно', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('99999999999999999'); // 17 девяток — лишние молча игнорируются
    expect((amountField() as HTMLInputElement).value.replace(/\s/g, '')).toBe('9999999999999');
    await tapAmount(',99');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.amountMinor).toBe(999_999_999_999_999);
  });

  it('вставка «1 234,56 с.» читается как 1234,56; «1.234» — нет (неоднозначно)', async () => {
    const { td, onClose } = await openAddSheet();
    const field = amountField() as HTMLInputElement;
    await user.click(field);
    await user.paste('1.234');
    expect(field.value).toBe('');
    await user.paste('1 234,56 с.');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.amountMinor).toBe(123_456);
  });

  it('заметка: ровно 500 символов можно, 501 — нет', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('1');
    const note = screen.getByRole('textbox', { name: /^Заметка/ });
    await user.click(note);
    await user.paste('я'.repeat(501));
    await clickSave();
    expect(await waitFor(() => screen.getByText('Заметка не длиннее 500 символов (сейчас 501)'))).toBeInTheDocument();
    expect(await allTxs(td)).toHaveLength(0);
    await user.clear(note);
    await user.paste('я'.repeat(500));
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.note).toHaveLength(500);
  });

  it('даты вне 2000–2100 и пустая дата отвергаются', async () => {
    const { td, onClose } = await openAddSheet();
    await tapAmount('1');
    await pickDate('Другая дата');
    const input = dateInput();
    for (const bad of ['1999-12-31', '2100-01-02', '0001-01-01', '9999-12-31']) {
      setDateInput(input, bad);
      await clickSave();
      await waitFor(() => expect(screen.getByText('Дата должна быть между 2000 и 2100 годом')).toBeInTheDocument());
    }
    setDateInput(input, '');
    await clickSave();
    await waitFor(() => expect(screen.getByText('Укажите дату')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(await allTxs(td)).toHaveLength(0);
  });
});

describe('ошибки репозитория', () => {
  it('ValidationError показывается у своего поля простым языком, кнопка снова доступна', async () => {
    const { td, onClose } = await openAddSheet();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi
      .spyOn(storeOf(td).transactions, 'create')
      .mockRejectedValueOnce(new ValidationError('Заметка: не длиннее 500 символов'));
    await tapAmount('3');
    await clickSave();
    await waitFor(() => expect(screen.getByText('Заметка: не длиннее 500 символов')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Сохранить' })).not.toBeDisabled();
    // повтор проходит, на этот раз по-настоящему
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('ошибка, не относящаяся к полю, показывается внизу формы', async () => {
    const { td } = await openAddSheet();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(storeOf(td).transactions, 'create').mockRejectedValueOnce(new ValidationError('Операция удалена: сначала восстановите её'));
    await tapAmount('3');
    await clickSave();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Операция удалена: сначала восстановите её'));
  });
});

describe('нет кошельков', () => {
  it('ни одного кошелька: понятный текст и кнопка на экран «Кошельки»', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        for (const w of await s.db.wallets.toArray()) await s.db.wallets.update(w.id, { deletedAt: new Date().toISOString() });
      },
    });
    const { onClose } = await openAddSheet(td);
    expect(screen.getByText('Сначала создайте кошелёк')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Создать кошелёк' }));
    await waitFor(() => expect(currentPath()).toBe('/wallets'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('все кошельки в архиве: подсказка вернуть кошелёк из архива', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        for (const w of await s.db.wallets.toArray()) await s.wallets.archive(w.id);
      },
    });
    await openAddSheet(td);
    expect(screen.getByText('Все кошельки в архиве')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открыть кошельки' })).toBeInTheDocument();
  });

  it('закрытие крестиком вызывает onClose', async () => {
    const { onClose } = await openAddSheet();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
