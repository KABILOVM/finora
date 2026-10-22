import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, money, norm, openApp, sheet, shot, test } from '../helpers';

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('55. Сверить все кошельки', () => {
  test('вводим фактические остатки на одном экране → расхождения → корректировки → «Отменить»; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' }); // «Наличные»: 1 000
    await createWallet(page, { name: 'Карта', opening: '500' });
    await dismissToasts(page);
    await goSection(page, 'Кошельки');

    await page.getByRole('button', { name: 'Сверить все кошельки' }).click();
    const dlg = sheet(page, 'Сверить все кошельки');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Наличные');
    await expect(dlg).toContainText('Карта');
    await expect(dlg.getByRole('button', { name: 'Введите, сколько на самом деле' })).toBeDisabled();

    await dlg.getByRole('textbox', { name: /^Сколько на самом деле: Наличные,/ }).fill('1200'); // в приложении 1 000
    await dlg.getByRole('textbox', { name: /^Сколько на самом деле: Карта,/ }).fill('500'); // в приложении 500
    await expect(dlg.getByTestId('recon-diff')).toContainText('В приложении меньше на');
    expect(norm(await dlg.getByTestId('recon-diff').innerText())).toMatch(money('запишем +200 с.'));
    await expect(dlg.getByText('Совпадает')).toBeVisible();
    await shot(page, '55-reconcile-all', testInfo);
    await noHorizontalScroll(page, 'Сверка всех кошельков');
    const apply = dlg.getByRole('button', { name: 'Записать корректировки · 1' });
    const box = await apply.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await apply.click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Записано 1 корректировка' })).toBeVisible();
    await expect(page.getByTestId('wallets-total')).toContainText(money('1 700 с.')); // 1 200 + 500
    // «Отменить» возвращает прежние остатки
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('wallets-total')).toContainText(money('1 500 с.'));
  });
});
