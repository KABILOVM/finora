import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, openApp, sheet, shot, tapAmount, test } from '../helpers';

/**
 * Проценты по долгу — кредит в банке. «Сегодня» закреплено: 15 октября 2026 (14:00 в Душанбе).
 * 10 000 с. под 24 % годовых на 12 месяцев (равными платежами): платёж 945,60, проценты 1 347,15, всего 11 347,15.
 */
const NOW = new Date('2026-10-15T09:00:00Z');

async function pinClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
}

test.describe('62. Проценты по долгу', () => {
  test('кредит в банке: ставка и срок считают проценты; остаток с процентами в списке и на странице долга; переживает перезагрузку; платёж уменьшает остаток', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Долги');

    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
    await dlg.getByRole('textbox', { name: 'У кого я взял' }).fill('Банк');
    await tapAmount(page, '10000');

    // проценты выключены по умолчанию; включаем — появляются ставка и срок
    const toggle = dlg.getByRole('checkbox', { name: 'Есть проценты' });
    await expect(toggle).not.toBeChecked();
    await expect(dlg.getByRole('textbox', { name: 'Ставка, % годовых' })).toHaveCount(0);
    await toggle.check();
    await dlg.getByRole('textbox', { name: 'Ставка, % годовых' }).fill('24');
    await dlg.getByRole('textbox', { name: 'Срок, месяцев' }).fill('12');

    // проценты посчитались сами; видно, сколько всего вернуть и сколько платить в месяц
    await expect(dlg.getByRole('textbox', { name: /^Проценты за весь срок/ })).toHaveValue(/1\s347,15/);
    const preview = dlg.getByTestId('interest-preview');
    await expect(preview).toContainText(money('11 347,15 с.'));
    await expect(preview).toContainText(money('945,60 с.'));
    await shot(page, '62-interest-sheet', testInfo);

    // «Сохранить» остаётся в экране, даже когда форма стала длиннее
    const vp = page.viewportSize()!;
    const saveBox = await dlg.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox();
    expect(saveBox, 'кнопка «Сохранить» видна').not.toBeNull();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(vp.height);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // в списке — остаток вместе с процентами
    const row = page.getByRole('link', { name: /^Банк/ });
    await expect(row).toContainText(money('11 347,15 с.'));
    await expect(row).toContainText('с процентами');
    await shot(page, '62-interest-list', testInfo);

    // на странице долга: сумма, проценты со ставкой и сроком, всего к возврату
    await row.click();
    await expect(page.getByTestId('debt-remaining')).toContainText(money('11 347,15 с.'));
    const summary = page.getByTestId('debt-summary');
    await expect(summary).toContainText(money('10 000 с.'));
    await expect(page.getByTestId('debt-interest')).toContainText(money('1 347,15 с.'));
    await expect(summary).toContainText('24 % годовых · 12 месяцев');
    await expect(page.getByTestId('debt-total')).toContainText(money('11 347,15 с.'));
    await shot(page, '62-interest-detail', testInfo);

    // после перезагрузки всё на месте (хранится на устройстве)
    await page.reload();
    await expect(page.getByTestId('debt-remaining')).toContainText(money('11 347,15 с.'));

    // платёж по договору уменьшает остаток с процентами
    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    const pay = sheet(page, 'Платёж по долгу');
    await expect(pay).toBeVisible();
    const shown = (await pay.getByRole('textbox', { name: /^Сумма платежа/ }).inputValue()).replace(/[^\d,]/g, '');
    for (let i = 0; i < shown.length; i++) await pay.getByRole('button', { name: 'Стереть' }).click();
    await tapAmount(page, '945,60');
    await pay.getByRole('button', { name: 'Записать платёж' }).click();
    await expect(pay).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByTestId('debt-remaining')).toContainText(money('10 401,55 с.'));
  });

  test('правка: проценты можно снять, и остаток снова только сумма долга', async ({ page }) => {
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Долги');
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
    await dlg.getByRole('textbox', { name: 'У кого я взял' }).fill('Банк');
    await tapAmount(page, '10000');
    await dlg.getByRole('checkbox', { name: 'Есть проценты' }).check();
    await dlg.getByRole('textbox', { name: 'Ставка, % годовых' }).fill('24');
    await dlg.getByRole('textbox', { name: 'Срок, месяцев' }).fill('12');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await page.getByRole('link', { name: /^Банк/ }).click();
    await expect(page.getByTestId('debt-remaining')).toContainText(money('11 347,15 с.'));
    await page.getByRole('button', { name: 'Править', exact: true }).click();
    const edit = sheet(page, 'Правка долга');
    await expect(edit.getByRole('checkbox', { name: 'Есть проценты' })).toBeChecked();
    await expect(edit.getByRole('textbox', { name: 'Ставка, % годовых' })).toHaveValue('24');
    await expect(edit.getByRole('textbox', { name: 'Срок, месяцев' })).toHaveValue('12');
    await edit.getByRole('checkbox', { name: 'Есть проценты' }).uncheck();
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByTestId('debt-remaining')).toContainText(money('10 000 с.'));
    await expect(page.getByTestId('debt-interest')).toHaveCount(0);
  });
});
