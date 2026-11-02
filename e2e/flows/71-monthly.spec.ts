import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: воскресенье 1 ноября 2026. Прошедший месяц — октябрь; недельной карточки в воскресенье нет. */
const NOW = new Date('2026-11-01T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('71. «Итоги месяца» на «Главной»', () => {
  test('в первые дни месяца: итоги прошедшего, «Подробнее» ведёт в «Аналитику» на этом месяце, «Скрыть» помнится после обновления; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { amount: '100', category: 'Еда', note: 'обед', date: '2026-10-05' });
    await addTx(page, { amount: '300', category: 'Еда', note: 'ужин в кафе', date: '2026-10-17' });
    await addTx(page, { amount: '200', category: 'Транспорт', date: '2026-10-30' });
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-10-09' });
    await addTx(page, { amount: '400', category: 'Еда', date: '2026-09-12' });
    await dismissToasts(page);

    await goSection(page, 'Главная');
    const card = page.getByTestId('monthly-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Итоги месяца');
    await expect(card).toContainText('Октябрь 2026');
    await expect(page.getByTestId('monthly-expense')).toContainText(money('600 с.'));
    await expect(page.getByTestId('monthly-delta')).toContainText('▲ +50%');
    await expect(page.getByTestId('monthly-top')).toContainText('Еда');
    await expect(page.getByTestId('monthly-biggest')).toContainText('ужин в кафе');
    await expect(page.getByTestId('monthly-net')).toContainText('Осталось');
    await card.scrollIntoViewIfNeeded();
    await shot(page, '71-monthly', testInfo);
    await noHorizontalScroll(page, 'Главная: итоги месяца');
    for (const b of await card.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '71-monthly-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // «Подробнее»: «Аналитика» на октябре (в ней те же 600 с. расходов)
    await card.getByRole('link', { name: 'Подробнее' }).click();
    await expect(page).toHaveURL(/month=2026-10/);
    await expect(page.getByTestId('analytics-summary')).toContainText('Расходы за октябрь 2026');
    await expect(page.getByTestId('analytics-summary')).toContainText(money('600 с.'));

    // «Скрыть» — до следующего месяца, обновление страницы карточку не возвращает
    await goSection(page, 'Главная');
    await page.getByRole('button', { name: 'Скрыть итоги месяца' }).click();
    await expect(page.getByTestId('monthly-card')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
    await expect(page.getByTestId('monthly-card')).toHaveCount(0);
  });
});
