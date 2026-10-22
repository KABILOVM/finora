import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { forgetTemplatesCache, readTemplates, saveTemplate } from '@/features/templates/templateStore';
import { amountField, clickSave, liveTxs, openAddSheet, opsDeps, pinToday, storeOf, tapAmount, unpinToday } from '@/features/transactions/__fixtures__/opsKit';

beforeEach(() => {
  localStorage.clear();
  forgetTemplatesCache();
  pinToday(); // 15.10.2026
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetTemplatesCache();
  vi.restoreAllMocks();
});

const GROUP = 'Шаблоны и частые операции';
const strip = () => screen.queryByRole('group', { name: GROUP });
/** Кнопка в окне «Название шаблона»: «Сохранить» есть и у самой формы, поэтому ищем только внутри окна. */
const dialogButton = (label: string): HTMLElement =>
  Array.from(screen.getByRole('alertdialog', { name: 'Название шаблона' }).querySelectorAll('button')).find((b) => b.textContent === label)!;
const openCategories = () => user.click(screen.getByRole('button', { name: /^Категория:/ }));

interface Ids {
  cash: string;
  food: string;
}

/** Шаблон «Кофе» 15 с. (Еда, «Наличные») и «Зарплата» (доход) лежат на устройстве ещё до открытия формы. */
function deps() {
  const ids: Ids = { cash: '', food: '' };
  const td = opsDeps([], {
    setup: async (s: Store) => {
      ids.cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      const cats = await s.db.categories.toArray();
      ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
      const salary = cats.find((c) => c.kind === 'income')!.id;
      saveTemplate(s.userId, 'Кофе', { kind: 'expense', walletId: ids.cash, toWalletId: null, amountMinor: 1_500, categoryId: ids.food, note: 'эспрессо' });
      saveTemplate(s.userId, 'Зарплата', { kind: 'income', walletId: ids.cash, toWalletId: null, amountMinor: 500_000, categoryId: salary, note: '' });
    },
  });
  return { ids, td };
}

describe('шаблоны в «Новой операции»', () => {
  it('в панели категорий шаблоны этого вида стоят первыми со звёздочкой; нажатие подставляет кошелёк, категорию, сумму и заметку', async () => {
    const { ids, td } = deps();
    await openAddSheet(td);
    await openCategories();
    await waitFor(() => expect(strip()).not.toBeNull());
    const chips = Array.from(strip()!.querySelectorAll('button'));
    expect(chips.map((b) => b.textContent)).toEqual([expect.stringContaining('Кофе')]); // «Зарплата» — доход, на вкладке «Расход» её нет
    await user.click(chips[0]!);
    expect((amountField() as HTMLInputElement).value.replace(/\s/g, '')).toBe('15');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    expect((screen.getByRole('textbox', { name: /^Заметка/ }) as HTMLInputElement).value).toBe('эспрессо');
    await clickSave();
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect((await liveTxs(td))[0]).toMatchObject({ kind: 'expense', walletId: ids.cash, categoryId: ids.food, amountMinor: 1_500, note: 'эспрессо' });
  });

  it('на вкладке «Доход» — свои шаблоны', async () => {
    const { td } = deps();
    await openAddSheet(td);
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await openCategories();
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(Array.from(strip()!.querySelectorAll('button')).map((b) => b.textContent)).toEqual([expect.stringContaining('Зарплата')]);
  });

  it('«Сохранить как шаблон» — в панели категорий: пока не набрана сумма, кнопки нет; название предлагается из заметки; шаблон сохраняется, форма остаётся', async () => {
    const td = opsDeps();
    const { onClose } = await openAddSheet(td);
    await openCategories();
    expect(screen.queryByRole('button', { name: 'Сохранить как шаблон' })).toBeNull();
    await openCategories(); // закрыли панель
    await tapAmount('45');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'обед в столовой');
    await openCategories();
    await user.click(await findByRole('button', { name: 'Сохранить как шаблон' }));
    const name = (await findByRole('textbox', { name: 'Название' })) as HTMLInputElement;
    expect(name.value).toBe('обед в столовой');
    await user.clear(name);
    await user.type(name, 'Обед');
    await user.click(dialogButton('Сохранить'));
    await waitFor(() => expect(readTemplates(storeOf(td).userId)).toHaveLength(1));
    expect(readTemplates(storeOf(td).userId)[0]).toMatchObject({ name: 'Обед', prefill: { kind: 'expense', amountMinor: 4_500, note: 'обед в столовой' } });
    await waitFor(() => expect(screen.getByText('Шаблон «Обед» сохранён')).toBeTruthy());
    // сама операция не сохранена, форма открыта
    expect(onClose).not.toHaveBeenCalled();
    expect(await liveTxs(td)).toHaveLength(0);
    expect((amountField() as HTMLInputElement).value.replace(/\s/g, '')).toBe('45');
  });

  it('без заметки название предлагается из категории', async () => {
    const td = opsDeps();
    await openAddSheet(td);
    await tapAmount('45');
    await openCategories();
    await user.click(screen.getByRole('button', { name: 'Еда' }));
    await openCategories();
    await user.click(await findByRole('button', { name: 'Сохранить как шаблон' }));
    expect(((await findByRole('textbox', { name: 'Название' })) as HTMLInputElement).value).toBe('Еда');
  });
});
