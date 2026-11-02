import { dismissToasts, expect, goSection, openApp, shot, sheet, test } from '../helpers';

test.describe('69. Бюджеты: шаблоны лимитов', () => {
  test('«Начать с шаблона» → «50 / 30 / 20»: доход, список лимитов с галочками, «Поставить лимиты»', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Бюджеты');
    await page.getByRole('button', { name: 'Начать с шаблона' }).click();
    const list = sheet(page, 'Шаблоны лимитов');
    await expect(list.getByRole('button', { name: /^50 \/ 30 \/ 20/ })).toBeVisible();
    await shot(page, '69-templates-list', testInfo);

    await list.getByRole('button', { name: /^50 \/ 30 \/ 20/ }).click();
    const dlg = sheet(page, /^Шаблон «50 \/ 30 \/ 20»/);
    await expect(dlg.getByText('Укажите доход, и мы посчитаем лимиты.')).toBeVisible();
    await dlg.getByRole('textbox', { name: /Доход в месяц/ }).fill('10000');
    await expect(dlg.getByRole('checkbox', { name: 'Общий лимит на все расходы' })).toBeChecked();
    await expect(dlg.getByRole('checkbox', { name: 'Продукты' })).toBeChecked();
    await expect(dlg.getByTestId('template-savings')).toContainText('На накопления остаётся 20%');
    await shot(page, '69-templates-review', testInfo);

    await dlg.getByRole('checkbox', { name: 'Развлечения' }).uncheck();
    await dlg.getByRole('button', { name: /^Поставить лимиты · \d+$/ }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // лимиты появились на странице; шаблоны остались доступны
    const main = page.getByRole('main');
    await expect(main.getByText('Продукты', { exact: true })).toBeVisible();
    await expect(main.getByText('Развлечения', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Шаблоны лимитов' })).toBeVisible();
    await shot(page, '69-templates-done', testInfo);
  });
});
