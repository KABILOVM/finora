import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('60. Поездки', () => {
  test('«Начать поездку» → операции получают метку → отчёт по поездке; «Завершить» — дальше без метки; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);

    // деньги на кошельке, чтобы остаток не ушёл в минус
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-10-01' });
    await dismissToasts(page);

    await goSection(page, 'Поездки');
    await expect(page.getByText('Поездок пока нет')).toBeVisible();
    await page.getByRole('textbox', { name: 'Название поездки' }).fill('Самарканд');
    await expect(page.getByText('Новые операции получат метку #Самарканд')).toBeVisible();
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.getByTestId('trip-active')).toContainText('Идёт поездка: Самарканд');
    await dismissToasts(page);

    // «Главная» напоминает, что поездка идёт
    await goSection(page, 'Главная');
    await expect(page.getByTestId('trip-card')).toContainText('Идёт поездка: Самарканд');

    // операции получают метку сами
    await addTx(page, { amount: '250', category: 'Еда', note: 'плов', date: '2026-10-12' });
    await dismissToasts(page);
    await addTx(page, { amount: '400', category: 'Транспорт', note: 'такси', date: '2026-10-14' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /плов #Самарканд/ })).toBeVisible();

    // отчёт
    await goSection(page, 'Поездки');
    await expect(page.getByTestId('trip-row')).toHaveCount(1);
    await expect(page.getByTestId('trip-row')).toContainText(money('650 с.'));
    await shot(page, '60-trips-list', testInfo);
    await noHorizontalScroll(page, 'Поездки (список)');
    await page.getByTestId('trip-row').getByRole('button').click();
    await expect(page.getByTestId('trip-summary')).toContainText(money('650 с.'));
    await expect(page.getByTestId('trip-summary')).toContainText('3 дня');
    await expect(page.getByTestId('trip-cat')).toHaveCount(2);
    await expect(page.getByTestId('trip-op')).toHaveCount(2);
    await shot(page, '60-trips-report', testInfo);
    await noHorizontalScroll(page, 'Поездки (отчёт)');
    for (const b of await page.getByRole('main').getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0, 'кнопка не ниже 44 px').toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '60-trips-report-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // операция из отчёта открывается на правку
    await page.getByTestId('trip-op').first().click();
    await expect(page.getByRole('dialog')).toContainText('Правка операции');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // «Завершить»: следующая операция без метки, в поездку не попадает
    await page.getByRole('button', { name: 'Завершить поездку' }).click();
    await goSection(page, 'Главная');
    await expect(page.getByTestId('trip-card')).toHaveCount(0);
    await addTx(page, { amount: '30', category: 'Еда', note: 'кофе дома', date: '2026-10-15' });
    await goSection(page, 'Поездки');
    await page.getByTestId('trip-row').getByRole('button').click();
    await expect(page.getByTestId('trip-summary')).toContainText(money('650 с.'));
  });
});
