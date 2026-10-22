import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

const summary = (page: Page) => page.getByTestId('period-summary');

test.describe('52. Аналитика → «Периоды»', () => {
  test('год против прошлого: расходы, норма сбережений, куда ушли деньги, категории; квартал и свои даты; на 320 px ничего не вылезает', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    // 2026: доход 3 000 (сегодня); расходы: Еда 120 (10 февраля), Транспорт 30 (5 августа), Продукты 50 (2 октября). 2025: Еда 100, зарплата 2 000
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await addTx(page, { amount: '120', category: 'Еда', date: '2026-02-10' });
    await addTx(page, { amount: '30', category: 'Транспорт', date: '2026-08-05' });
    await addTx(page, { amount: '50', category: 'Продукты', date: '2026-10-02' });
    await addTx(page, { amount: '100', category: 'Еда', date: '2025-03-10' });
    await addTx(page, { kind: 'income', amount: '2000', category: 'Зарплата', date: '2025-03-01' });
    await dismissToasts(page);

    await goSection(page, 'Аналитика');
    await page.getByRole('radio', { name: 'Периоды' }).click();
    await expect(page).toHaveURL(/tab=periods/);

    // идущий год: сравнение с теми же днями прошлого
    await expect(summary(page)).toContainText('Расходы за 2026 год');
    await expect(summary(page)).toContainText(money('200 с.'));
    await expect(page.getByTestId('period-expense-delta')).toContainText('▲ +100%');
    await expect(page.getByTestId('period-range')).toContainText('Сравниваем с 01.01.2025 — 15.10.2025');
    await expect(page.getByTestId('savings-rate')).toContainText('93%');
    await expect(page.getByTestId('savings-rate-prev')).toContainText('было 95%');
    await shot(page, '52-periods-year', testInfo);

    // куда ушли деньги: категории и остаток
    const flow = page.getByTestId('income-flow');
    await expect(flow).toContainText('Еда');
    await expect(flow).toContainText('Осталось');
    await expect(flow).toContainText(money('2 800 с.'));
    await flow.scrollIntoViewIfNeeded();
    await shot(page, '52-periods-flow', testInfo);

    // категории против прошлого года и месяцы
    const cats = page.getByRole('list', { name: 'Расходы по категориям' });
    await expect(cats.getByRole('listitem').first()).toContainText('Еда');
    await expect(cats.getByRole('listitem').first()).toContainText('▲ +20%');
    await expect(page.getByTestId('period-months')).toBeVisible();
    await expect(page.getByTestId('period-highlights')).toContainText('Главная статья расходов — Еда');
    await page.getByTestId('period-highlights').scrollIntoViewIfNeeded();
    await shot(page, '52-periods-highlights', testInfo);
    await noHorizontalScroll(page, 'Периоды: год');

    // тёмная тема
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await flow.scrollIntoViewIfNeeded();
    await shot(page, '52-periods-flow-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // квартал: стрелка к прошлому кварталу (июль–сентябрь: только транспорт 30)
    await page.getByRole('radio', { name: 'Квартал' }).click();
    await expect(summary(page)).toContainText('Расходы за 4-й квартал 2026');
    await page.getByRole('button', { name: 'Предыдущий квартал' }).click();
    await expect(summary(page)).toContainText('Расходы за 3-й квартал 2026');
    await expect(summary(page)).toContainText(money('30 с.'));
    await expect(page).toHaveURL(/kind=quarter&q=3/);
    await noHorizontalScroll(page, 'Периоды: квартал');

    // свои даты: февраль 2026 — только еда 120; без графика по месяцам
    await page.getByRole('radio', { name: 'Свой период' }).click();
    await page.getByLabel('С', { exact: true }).fill('2026-02-01');
    await page.getByLabel('По', { exact: true }).fill('2026-02-28');
    await expect(summary(page)).toContainText('Расходы за 01.02.2026 — 28.02.2026');
    await expect(summary(page)).toContainText(money('120 с.'));
    await expect(page.getByTestId('period-months')).toHaveCount(0);
    await shot(page, '52-periods-custom', testInfo);
    await noHorizontalScroll(page, 'Периоды: свои даты');

    // неправильные даты: подсказка вместо отчёта
    await page.getByLabel('С', { exact: true }).fill('2026-03-10');
    await expect(page.getByText('Начало позже конца')).toBeVisible();
    await expect(summary(page)).toHaveCount(0);

    // выбор переживает обновление страницы
    await page.getByLabel('С', { exact: true }).fill('2026-02-01');
    await expect(summary(page)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Периоды', checked: true })).toBeVisible();
    await expect(summary(page)).toContainText('Расходы за 01.02.2026 — 28.02.2026');
  });
});
