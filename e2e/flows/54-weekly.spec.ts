import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: четверг 15 октября 2026. Прошедшая неделя — 5–11 октября. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('54. «Итоги недели» на «Главной»', () => {
  test('в начале недели: итоги прошедшей, «Подробнее» ведёт в «Периоды», «Скрыть» помнится после обновления; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { amount: '100', category: 'Еда', note: 'обед', date: '2026-10-05' });
    await addTx(page, { amount: '300', category: 'Еда', note: 'ужин в кафе', date: '2026-10-07' });
    await addTx(page, { amount: '200', category: 'Транспорт', date: '2026-10-11' });
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-10-09' });
    await addTx(page, { amount: '400', category: 'Еда', date: '2026-10-02' });
    await dismissToasts(page);

    await goSection(page, 'Главная');
    const card = page.getByTestId('weekly-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Итоги недели');
    await expect(card).toContainText('5–11 октября');
    await expect(page.getByTestId('weekly-expense')).toContainText(money('600 с.'));
    await expect(page.getByTestId('weekly-delta')).toContainText('▲ +50%');
    await expect(page.getByTestId('weekly-top')).toContainText('Еда');
    await expect(page.getByTestId('weekly-biggest')).toContainText('ужин в кафе');
    await card.scrollIntoViewIfNeeded();
    await shot(page, '54-weekly', testInfo);
    await noHorizontalScroll(page, 'Главная: итоги недели');
    for (const b of await card.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '54-weekly-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // «Подробнее»: те же даты на вкладке «Периоды», сравнение — с неделей до неё
    await card.getByRole('link', { name: 'Подробнее' }).click();
    await expect(page).toHaveURL(/tab=periods/);
    await expect(page.getByTestId('period-summary')).toContainText('Расходы за 05.10.2026 — 11.10.2026');
    await expect(page.getByTestId('period-summary')).toContainText(money('600 с.'));
    await expect(page.getByTestId('period-range')).toContainText('Сравниваем с 28.09.2026 — 04.10.2026');

    // «Скрыть» — до следующей недели, обновление страницы карточку не возвращает
    await goSection(page, 'Главная');
    await page.getByRole('button', { name: 'Скрыть итоги недели' }).click();
    await expect(page.getByTestId('weekly-card')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
    await expect(page.getByTestId('weekly-card')).toHaveCount(0);
  });
});
