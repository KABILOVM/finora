import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, norm, openApp, shot, sheet, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (14:00 в Душанбе) — вторая половина месяца. */
const NOW = new Date('2026-10-15T09:00:00Z');

/** На руках 9 000, кошелёк-накопление «Копилка» (вид «Накопления», без остатка). */
async function seed(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await openApp(page);
  await addTx(page, { kind: 'income', amount: '9000', category: 'Зарплата', date: '2026-10-01' });
  await goSection(page, 'Кошельки');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dlg = sheet(page, 'Новый кошелёк');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Название' }).fill('Копилка');
  await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('67. Цели накопления: «Отложить сейчас», напоминание, «Главная»', () => {
  test('цель с копилкой: напоминание → «Отложить сейчас» → напоминание уходит; на «Главной» есть строка о цели', async ({ page }, testInfo) => {
    await seed(page);
    await goSection(page, 'Бюджеты');
    await page.getByRole('button', { name: 'Поставить цель', exact: true }).click();
    const form = sheet(page, 'Новая цель');
    await form.getByRole('textbox', { name: 'Название' }).fill('Ноутбук');
    await form.getByRole('textbox', { name: /^Сколько накопить/ }).fill('3000');
    await form.getByRole('combobox', { name: 'Где копите' }).selectOption({ label: 'Копилка' });
    await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(form).toBeHidden();
    await dismissToasts(page);

    // вторая половина месяца, ничего не отложено — напоминание; копилка из мелочи на месте
    const nudge = page.getByTestId('goal-row-nudge');
    await expect(nudge).toContainText('Пора отложить');
    await expect(page.getByTestId('round-up-card')).toBeVisible();
    await shot(page, '67-goal-nudge', testInfo);

    // «Главная»: строка о цели в виджете и напоминание в «Требует внимания»
    await goSection(page, 'Главная');
    await expect(page.getByTestId('widget-goal-line')).toContainText('С учётом целей');
    await expect(page.getByTestId('attention-row')).toContainText('Пора отложить на цель «Ноутбук»');
    await shot(page, '67-home-goal', testInfo);

    // «Отложить сейчас»: по умолчанию предлагается недостающее за месяц (по 1 500 за два месяца)
    await goSection(page, 'Бюджеты');
    await page.getByRole('button', { name: 'Отложить сейчас на цель «Ноутбук»' }).click();
    const save = sheet(page, 'Отложить на «Ноутбук»');
    await expect(save).toBeVisible();
    await expect(save.getByRole('textbox', { name: /^Сколько отложить/ })).toHaveValue(/^1\s?500$/);
    await save.getByRole('button', { name: 'Отложить', exact: true }).click();
    await expect(save).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByTestId('goal-row-nudge')).toHaveCount(0);
    await expect.poll(async () => norm(await page.getByTestId('goal-row').innerText())).toMatch(/Накоплено 1\s?500/);

    await goSection(page, 'Главная');
    await expect(page.getByTestId('attention-row')).toHaveCount(0); // кроме этого напоминания, внимания ничто не требует
  });
});
