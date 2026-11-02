import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, fillTx, goSection, money, norm, openApp, saveNewTx, shot, sheet, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('68. Поездка: обмен валюты и курс поездки', () => {
  test('обмен 1 100 с. → 100 $ заводит кошелёк, трата в долларах идёт по курсу обмена, «сколько можно в день», сумма на чеке, завершение', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);

    // деньги на кошельке «Наличные» (сомони)
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-10-01' });
    await dismissToasts(page);

    // начало поездки: название и дни
    await goSection(page, 'Поездки');
    await page.getByRole('textbox', { name: 'Название поездки' }).fill('Дубай');
    await page.getByRole('textbox', { name: /^Сколько дней/ }).fill('5');
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.getByTestId('trip-active')).toContainText('Идёт поездка: Дубай');
    await dismissToasts(page);
    await expect(page.getByTestId('trip-money')).toContainText('Обменяйте сомони');
    await noHorizontalScroll(page, 'Поездки (до обмена)');

    // обмен: отдал 1 100 с., получил 100 $
    await page.getByRole('button', { name: 'Обмен валюты', exact: true }).click();
    const dlg = sheet(page, 'Обмен валюты');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('textbox', { name: /^Отдаю/ }).fill('1100');
    await dlg.getByRole('textbox', { name: /^Получаю,/ }).fill('100');
    await expect(dlg.getByTestId('exchange-rate')).toContainText(money('1 $ = 11 с.'));
    await shot(page, '68-exchange-sheet', testInfo);
    await noHorizontalScroll(page, 'Обмен валюты');
    await dlg.getByRole('button', { name: 'Записать обмен' }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // кошелёк «USD · Дубай» заведён сам, остаток виден в сомони по курсу обмена
    const row = page.getByTestId('trip-wallet');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('USD · Дубай');
    await expect(row).toContainText(money('100 $'));
    await expect(page.getByTestId('trip-wallet-value')).toContainText(money('≈ 1 100 с.'));
    await expect(page.getByTestId('trip-rates')).toContainText(money('1 $ = 11 с.'));

    // трата в долларах: курс вашего обмена и «≈ 110 с.» под суммой
    const add = await fillTx(page, { amount: '10', wallet: 'USD · Дубай', note: 'такси' });
    await expect(add.getByTestId('fx-notice')).toContainText('Курс вашего обмена');
    await expect(add.getByTestId('fx-trip-preview')).toContainText(money('≈ 110 с.'));
    await shot(page, '68-expense-in-usd', testInfo);
    await saveNewTx(add);
    await expect(add).toBeHidden();
    await dismissToasts(page);

    // «Главная»: остаток 90 $ ≈ 990 с.; на 5 дней — (90 + 10) ÷ 5 = 20 $ в день, сегодня потрачено 10 — ещё 10 $
    await goSection(page, 'Главная');
    const card = page.getByTestId('trip-card-wallet');
    await expect(card).toContainText(money('Осталось 90 $'));
    await expect(card).toContainText(money('≈ 990 с.'));
    await expect(card).toContainText(money('сегодня ещё можно 10 $'));
    await shot(page, '68-home-trip-card', testInfo);

    // «Операции»: у траты в долларах под суммой «≈ 110 с.»
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /такси #Дубай/ })).toContainText(money('≈ 110 с.'));

    // оплата картой в сомони: списали 135 с., на чеке 50 AED
    const card2 = await fillTx(page, { amount: '135', wallet: 'Наличные', note: 'кафе' });
    await card2.getByRole('button', { name: 'Сумма на чеке в другой валюте' }).click();
    await card2.getByRole('combobox', { name: 'Валюта чека' }).selectOption('AED');
    await card2.getByRole('textbox', { name: /^Сумма на чеке/ }).fill('50');
    await expect(card2.getByTestId('card-rate')).toContainText(money('1 AED = 2,7 с.'));
    await card2.getByTestId('foreign-field').scrollIntoViewIfNeeded();
    await shot(page, '68-receipt-field', testInfo);
    await noHorizontalScroll(page, 'Сумма на чеке');
    await saveNewTx(card2);
    await expect(card2).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByRole('button', { name: /кафе #Дубай/ })).toContainText(money('на чеке 50 AED'));

    // отчёт поездки: «Чем платили» — валюты и сколько списано картой
    await goSection(page, 'Поездки');
    await page.getByTestId('trip-row').getByRole('button').click();
    await expect(page.getByTestId('trip-currency').filter({ hasText: 'AED' })).toContainText(money('картой списано 135 с.'));
    await noHorizontalScroll(page, 'Поездки (отчёт)');
    await shot(page, '68-trip-report', testInfo);

    // завершение: в кошельке остались доллары — об этом сказано, кошелёк на месте
    await page.getByRole('button', { name: 'Завершить поездку' }).click();
    await expect(page.getByText(/остались деньги: 90\s\$/)).toBeVisible();
    await goSection(page, 'Главная');
    await expect(page.getByTestId('trip-card')).toHaveCount(0);
    expect(norm(await page.getByRole('main').innerText())).toContain('USD · Дубай');
  });
});
