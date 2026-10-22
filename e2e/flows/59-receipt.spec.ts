import type { Page } from '@playwright/test';
import { addLink, dismissToasts, expect, goSection, openApp, sheet, shot, test } from '../helpers';

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('59. Чек по позициям', () => {
  test('вручную: позиции двух категорий → два расхода, позиции видны в «Чеке» расхода; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addLink(page).click();
    const add = sheet(page, 'Новая операция');
    await add.getByRole('button', { name: 'Продиктовать операции' }).click();
    const dictate = sheet(page, 'Продиктовать операции');
    await dictate.getByRole('button', { name: /^Чек по позициям/ }).click();
    const dlg = sheet(page, 'Чек по позициям');
    await expect(dlg).toBeVisible();
    await shot(page, '59-receipt-start', testInfo);
    await dlg.getByRole('button', { name: 'Ввести вручную' }).click();

    await dlg.getByRole('textbox', { name: 'Название' }).fill('Хлеб');
    await dlg.getByRole('textbox', { name: 'Цена за всю позицию' }).fill('10');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await page.getByRole('option', { name: /Еда/ }).click();
    await dlg.getByRole('button', { name: 'Добавить позицию' }).click();
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Билет');
    await dlg.getByRole('textbox', { name: 'Цена за всю позицию' }).fill('5,5');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await page.getByRole('option', { name: /Транспорт/ }).click();

    await expect(dlg.getByTestId('receipt-group')).toHaveCount(2);
    await dlg.getByTestId('receipt-summary').scrollIntoViewIfNeeded();
    await shot(page, '59-receipt-edit', testInfo);
    await noHorizontalScroll(page, 'Чек по позициям');
    for (const b of await dlg.getByRole('button').all()) {
      const box = await b.boundingBox();
      if (box) expect(box.height, 'кнопка не ниже 44 px').toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '59-receipt-edit-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    await dlg.getByRole('button', { name: 'Сохранить 2 расхода' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Чек записан: 2 расхода' })).toBeVisible();
    await dismissToasts(page);

    // позиции видны в «Чеке» расхода
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Еда/ }).first().click();
    await expect(page.getByTestId('receipt')).toContainText('Хлеб');
    await expect(page.getByTestId('receipt')).toContainText('1 позиция');
  });
});
