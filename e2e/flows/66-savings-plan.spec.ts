import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, norm, openApp, shot, sheet, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (14:00 в Душанбе) — до конца месяца 17 дней. */
const NOW = new Date('2026-10-15T09:00:00Z');

/**
 * Три прошлых месяца: приходит 15 000 и тратится 15 000 на «Еду» (деньги не копятся); в октябре пришло 9 000, потрачено ничего:
 * на руках 9 000 с., а привычные траты на «Еду» за оставшиеся 17 дней — около 8 200 с.
 */
async function seedHistory(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await openApp(page);
  for (const month of ['2026-07', '2026-08', '2026-09']) {
    await addTx(page, { kind: 'income', amount: '15000', category: 'Зарплата', date: `${month}-01` });
    await addTx(page, { amount: '15000', category: 'Еда', date: `${month}-10` });
  }
  await addTx(page, { kind: 'income', amount: '9000', category: 'Зарплата', date: '2026-10-01' });
  await dismissToasts(page);
}

test.describe('66. Бюджеты: цель накопления и план трат', () => {
  test('цель считает, сколько можно тратить, что сократить, и учитывает обязательные категории', async ({ page }, testInfo) => {
    await seedHistory(page);
    await goSection(page, 'Бюджеты');

    // целей нет — приглашение
    await expect(page.getByTestId('goals-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Поставить цель', exact: true }).click();
    const dlg = sheet(page, 'Новая цель');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Отпуск');
    await dlg.getByRole('textbox', { name: /^Сколько накопить/ }).fill('3000');
    await dlg.getByRole('button', { name: 'Через 3 месяца' }).click();
    await shot(page, '66-goal-form', testInfo);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // цель в списке, план на день и разбор: «Еда» нужно сократить
    const row = page.getByRole('button', { name: 'Цель «Отпуск»: править' });
    await expect(row).toBeVisible();
    const plan = page.getByTestId('goal-plan');
    await expect(plan).toBeVisible();
    await expect.poll(async () => norm(await plan.innerText())).toContain('С учётом целей можно тратить');
    await expect.poll(async () => norm(await plan.innerText())).toContain('сократите привычные траты');
    const food = plan.getByTestId('goal-advice-row').filter({ hasText: 'Еда' });
    await expect(food).toHaveCount(1);
    await expect(food).toContainText('Не больше');
    await shot(page, '66-goal-plan', testInfo);

    // «Еда» — обязательная: резать нечего, остаётся честно сказать, что не хватает
    await plan.getByRole('button', { name: 'Обязательные категории' }).click();
    const essential = sheet(page, 'Обязательные категории');
    await expect(essential).toBeVisible();
    await essential.getByRole('switch', { name: 'Обязательная: Еда' }).click();
    await expect(essential.getByRole('switch', { name: 'Обязательная: Еда' })).toBeChecked();
    await essential.getByRole('button', { name: 'Готово' }).click();
    await expect(essential).toBeHidden();
    await expect.poll(async () => norm(await plan.innerText())).toContain('Даже без необязательных трат не хватает');
    await expect(plan.getByTestId('goal-advice-row').filter({ hasText: 'Еда' })).toHaveAttribute('data-advice', 'essential');
    // и подсказка срока: самая ранняя реалистичная дата, а не просто «не хватает»
    await expect(plan.getByTestId('goal-catchup')).toContainText('не раньше');
    await shot(page, '66-goal-plan-tight', testInfo);

    // цель можно убрать в архив и вернуть
    await row.click();
    await sheet(page, 'Цель накопления').getByRole('button', { name: 'Убрать в архив' }).click();
    await expect(row).toBeHidden();
    await dismissToasts(page);
    await page.getByRole('button', { name: /^Архив целей/ }).click();
    await page.getByRole('button', { name: 'Вернуть цель: Отпуск' }).click();
    await expect(page.getByRole('button', { name: 'Цель «Отпуск»: править' })).toBeVisible();
  });
});
