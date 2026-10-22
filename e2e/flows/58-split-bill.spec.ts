import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, openApp, sheet, shot, test } from '../helpers';

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('58. Разделить счёт', () => {
  test('сумма и два друга → доли → расход на вашу долю и два долга «мне должны»; «Отменить»; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await goSection(page, 'Долги');
    await page.getByRole('button', { name: 'Разделить счёт' }).click();
    const dlg = sheet(page, 'Разделить счёт');
    await expect(dlg).toBeVisible();

    await dlg.getByRole('textbox', { name: /^Сумма счёта/ }).fill('100');
    await dlg.getByLabel('Друг 1', { exact: true }).fill('Алишер');
    await dlg.getByRole('button', { name: 'Добавить человека' }).click();
    await dlg.getByLabel('Друг 2', { exact: true }).fill('Фарход');
    await dlg.getByRole('textbox', { name: 'На что' }).fill('ужин');
    await expect(dlg.getByTestId('split-preview')).toContainText('Каждый друг');
    await expect(dlg.getByTestId('split-preview')).toContainText(money('33,33 с.'));
    await expect(dlg.getByTestId('split-preview')).toContainText(money('33,34 с.'));
    await dlg.getByTestId('split-preview').scrollIntoViewIfNeeded();
    await shot(page, '58-split-bill', testInfo);
    await noHorizontalScroll(page, 'Разделить счёт');

    await dlg.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Счёт разделён' })).toBeVisible();

    // долги на друзей: «Мне должны» — Алишер и Фарход
    await expect(page.getByText('Алишер').first()).toBeVisible();
    await expect(page.getByText('Фарход').first()).toBeVisible();

    // «Отменить» убирает и расход, и долги
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Алишер')).toHaveCount(0);
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /ужин/ })).toHaveCount(0);
  });
});
