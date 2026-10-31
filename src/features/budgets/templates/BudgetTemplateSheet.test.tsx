import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import BudgetsPage from '../BudgetsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
type Setup = (s: Store) => Promise<unknown>;

async function openPage(setup?: Setup) {
  const td = opsDeps([table()], { setup: setup ? async (s: Store) => void (await setup(s)) : undefined });
  await showApp(<BudgetsPage />, td, '/budgets');
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}
const live = async (td: ReturnType<typeof opsDeps>) => (await storeOf(td).db.budgets.toArray()).filter((b) => b.deletedAt === null && b.archivedAt === null);
const catId = async (td: ReturnType<typeof opsDeps>, name: string) => (await storeOf(td).db.categories.toArray()).find((c) => c.name === name && c.kind === 'expense')!.id;

async function openTemplates(emptyState: boolean) {
  await user.click(screen.getByRole('button', { name: emptyState ? 'Начать с шаблона' : 'Шаблоны лимитов' }));
  return findByRole('dialog', { name: 'Шаблоны лимитов' });
}
const pickTemplate = async (name: string | RegExp) => {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${typeof name === 'string' ? name : name.source}`) }));
  await findByRole('dialog', { name: /^Шаблон «/ });
};
/** Вводит доход в поле суммы (экранной клавиатуры в этом окне нет: набирают системной). */
async function typeIncome(text: string) {
  const field = screen.getByRole('textbox', { name: /Доход в месяц/ });
  await user.clear(field);
  await user.type(field, text);
}

describe('«Бюджеты» → шаблоны лимитов', () => {
  it('в пустом состоянии есть «Начать с шаблона», а когда лимиты уже есть — «Шаблоны лимитов»', async () => {
    await openPage();
    expect(screen.getByRole('button', { name: 'Начать с шаблона' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Шаблоны лимитов' })).toBeNull();
  });

  it('список шаблонов: названия и короткие подписи', async () => {
    await openPage();
    await openTemplates(true);
    const list = screen.getByRole('list', { name: 'Шаблоны лимитов' });
    const names = Array.from(list.querySelectorAll('button')).map((b) => norm(b.textContent));
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names.some((n) => n.startsWith('50 / 30 / 20') && n.includes('20% накопления'))).toBe(true);
    expect(names.some((n) => n.startsWith('Семья с детьми'))).toBe(true);
  });

  it('«50 / 30 / 20» при доходе 10 000: общий лимит 8 000 и лимиты по категориям; ставятся одним нажатием', async () => {
    const td = await openPage();
    await openTemplates(true);
    await pickTemplate('50 / 30 / 20');
    await typeIncome('10000');

    await eventually(() => {
      expect(screen.getByRole('checkbox', { name: 'Продукты' })).toBeTruthy(); // категории читаются из базы: список строится после них
    });
    const total = screen.getByRole('checkbox', { name: 'Общий лимит на все расходы' }).closest('li')!;
    expect(norm(total.textContent)).toContain(fmt(8_000_00));
    const food = screen.getByRole('checkbox', { name: 'Продукты' }).closest('li')!;
    expect(norm(food.textContent)).toContain(fmt(1_400_00));
    expect(norm(food.textContent)).toContain('14% дохода');
    expect(norm(document.querySelector('[data-testid="template-savings"]')?.textContent)).toContain(`На накопления остаётся 20%: ${fmt(2_000_00)}`);

    // отмечены все (лимитов ещё нет): снимаем «Развлечения»
    await user.click(screen.getByRole('checkbox', { name: 'Развлечения' }));
    const button = screen.getByRole('button', { name: /^Поставить лимиты · \d+$/ });
    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const rows = await live(td);
    expect(rows.find((b) => b.categoryId === null)?.amountMinor).toBe(8_000_00);
    expect(rows.find((b) => b.categoryId === null)?.currency).toBe('TJS');
    const foodId = await catId(td, 'Продукты');
    expect(rows.find((b) => b.categoryId === foodId)?.amountMinor).toBe(1_400_00);
    const funId = await catId(td, 'Развлечения');
    expect(rows.find((b) => b.categoryId === funId)).toBeUndefined(); // снятая галочка
    // страница показала поставленные лимиты
    await waitFor(() => expect(screen.getByRole('button', { name: 'Шаблоны лимитов' })).toBeTruthy());
  });

  it('стоящий лимит не отмечен заранее, подписан «сейчас … · обновим»; отметили — сумма обновляется, второго лимита нет', async () => {
    const td = await openPage(async (s) => {
      const food = (await s.db.categories.toArray()).find((c) => c.name === 'Продукты' && c.kind === 'expense')!;
      await s.budgets.create({ categoryId: food.id, amountMinor: 900_00 });
    });
    await openTemplates(false);
    await pickTemplate('50 / 30 / 20');
    await typeIncome('10000');
    await eventually(() => {
      expect(screen.getByRole('checkbox', { name: 'Продукты' })).toBeTruthy();
    });
    const box = screen.getByRole('checkbox', { name: 'Продукты' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(norm(box.closest('li')?.textContent)).toContain(`сейчас ${fmt(900_00)} · обновим`);
    await user.click(screen.getByRole('button', { name: /^Поставить лимиты · \d+$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const foodId = await catId(td, 'Продукты');
    expect((await live(td)).find((b) => b.categoryId === foodId)?.amountMinor).toBe(900_00); // не тронут

    // второй заход: отмечаем и обновляем
    await user.click(screen.getByRole('button', { name: 'Шаблоны лимитов' }));
    await findByRole('dialog', { name: 'Шаблоны лимитов' });
    await pickTemplate('50 / 30 / 20');
    await typeIncome('10000');
    await eventually(() => {
      expect(screen.getByRole('checkbox', { name: 'Продукты' })).toBeTruthy();
    });
    await user.click(screen.getByRole('checkbox', { name: 'Продукты' }));
    await user.click(screen.getByRole('button', { name: /^Поставить лимиты · \d+$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = (await live(td)).filter((b) => b.categoryId === foodId);
    expect(after).toHaveLength(1);
    expect(after[0]?.amountMinor).toBe(1_400_00);
  });

  it('доход подставляется по последним месяцам, пока человек не ввёл свой', async () => {
    await openPage(async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      const salary = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата')!.id;
      for (const m of ['2026-07', '2026-08', '2026-09']) {
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 5_000_00, categoryId: salary, occurredOn: `${m}-05` });
      }
    });
    await openTemplates(true);
    await pickTemplate('Семья с детьми');
    await eventually(() => {
      expect(screen.getByText(/Подставили обычный доход за последние месяцы/)).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Общий лимит на все расходы' })).toBeTruthy();
    });
    expect(norm(screen.getByText(/Подставили обычный доход/).textContent)).toContain(fmt(5_000_00));
    // общий лимит семьи: 93% от 5 000 = 4 650, округлённо до двух значащих знаков — 4 700
    expect(norm(screen.getByRole('checkbox', { name: 'Общий лимит на все расходы' }).closest('li')?.textContent)).toContain(fmt(4_700_00));
  });

  it('без дохода предлагает его указать, ничего не ставит; «Другой шаблон» возвращает к списку', async () => {
    const td = await openPage();
    await openTemplates(true);
    await pickTemplate('Студент');
    await eventually(() => {
      expect(screen.getByText('Укажите доход, и мы посчитаем лимиты.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Отметьте лимиты' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Другой шаблон' }));
    expect(screen.getByRole('list', { name: 'Шаблоны лимитов' })).toBeTruthy();
    expect((await live(td)).length).toBe(0);
  });

  it('набор, которого нет среди категорий человека, объясняется, а не молча пропадает', async () => {
    await openPage();
    await openTemplates(true);
    await pickTemplate('Семья с детьми');
    await typeIncome('5000');
    await eventually(() => {
      expect(document.querySelector('[data-testid="template-missing"]')).not.toBeNull();
    });
    const note = norm(document.querySelector('[data-testid="template-missing"]')?.textContent);
    expect(note).toContain('Готовые категории');
    expect(note).toContain('Коммунальные услуги'); // у нового человека её ещё нет
  });
});
