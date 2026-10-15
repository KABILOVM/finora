import type { Locator, Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, norm, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

const summary = (page: Page): Locator => page.getByTestId('analytics-summary');

test.describe('30. Аналитика', () => {
  test('итог месяца и сравнение с прошлым; категории со ссылкой на операции; дни недели; крупные траты; месяцы листаются', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await addTx(page, { amount: '120', category: 'Еда', note: 'обед' });
    await addTx(page, { amount: '300', category: 'Еда', note: 'ужин в кафе', date: '2026-10-12' });
    await addTx(page, { amount: '45', category: 'Транспорт' });
    await addTx(page, { amount: '200', category: 'Продукты', note: 'базар', date: '2026-09-20' });
    await dismissToasts(page);

    await goSection(page, 'Аналитика');
    // октябрь: 120 + 300 + 45 = 465; сентябрь: 200 → на 133% больше
    await expect(summary(page)).toContainText('Расходы за октябрь 2026');
    await expect(summary(page)).toContainText(money('465 с.'));
    await expect(page.getByTestId('analytics-trend')).toHaveText('На 133% больше, чем в прошлом месяце');
    await expect(summary(page)).toContainText(money('3 000 с.'));
    await shot(page, '30-analytics-top', testInfo);

    // график по месяцам нарисован, у октября оба столбика не нулевые
    await expect(page.getByTestId('monthly-bars')).toBeVisible();
    const h = async (id: string) => Number(await page.getByTestId(id).getAttribute('height'));
    expect(await h('bar-expense-2026-10')).toBeGreaterThan(0);
    expect(await h('bar-income-2026-10')).toBeGreaterThan(await h('bar-expense-2026-10'));

    // категории: «Еда» первая, «новая»; «Продукты» (сентябрьская) — «нет трат»
    const cats = page.getByRole('list', { name: 'Расходы по категориям' });
    await expect(cats.getByRole('listitem').first()).toContainText('Еда');
    await expect(cats.getByRole('listitem').first()).toContainText(money('420 с.'));
    await expect(cats.getByRole('listitem').first()).toContainText('новая');
    await expect(cats.getByRole('listitem').filter({ hasText: 'Продукты' })).toContainText('нет трат');
    await shot(page, '30-analytics-categories', testInfo);

    // дни недели: 12 октября — понедельник (300), 15-го — четверг (120 + 45); понедельников до 15-го два (5 и 12)
    await expect(page.getByTestId('weekday-summary')).toContainText('Чаще всего вы тратите по понедельникам');
    await expect(page.getByTestId('weekday-summary')).toContainText(money('150 с.')); // 300 ÷ 2 понедельника (5 и 12 октября)
    await shot(page, '30-analytics-weekdays', testInfo);

    // самые крупные: ужин в кафе — первым
    const top = page.getByRole('list', { name: 'Самые крупные расходы' });
    await expect(top.getByRole('listitem').first()).toContainText('ужин в кафе');
    await noHorizontalScroll(page, 'Аналитика');

    // «Еда» → список операций этой категории за октябрь: две операции, «Транспорта» нет
    await cats.getByRole('link', { name: /Еда/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Операции' })).toBeVisible();
    await expect(page.getByRole('button', { name: /обед/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /ужин в кафе/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Транспорт/ })).toHaveCount(0);
    await shot(page, '30-analytics-drilldown', testInfo);

    // назад, предыдущий месяц: сентябрь — 200, сравнивать не с чем
    await page.goBack();
    await expect(summary(page)).toContainText('Расходы за октябрь 2026');
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(summary(page)).toContainText('Расходы за сентябрь 2026');
    await expect(summary(page)).toContainText(money('200 с.'));
    await expect(page.getByTestId('analytics-trend')).toHaveText('В прошлом месяце расходов не было');
    expect(norm(await page.getByRole('list', { name: 'Самые крупные расходы' }).innerText())).toContain('базар');
  });

  test('с «Главной» ссылка «Подробная аналитика» ведёт на выбранный месяц; пустой экран понятен', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Аналитика');
    await expect(page.getByRole('heading', { name: 'Пока нечего анализировать' })).toBeVisible();
    await shot(page, '30-analytics-empty', testInfo);

    await addTx(page, { amount: '80', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    await page.getByRole('link', { name: 'Подробная аналитика' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeVisible();
    await expect(summary(page)).toContainText('Расходы за октябрь 2026');
    await expect(summary(page)).toContainText(money('80 с.'));
  });
});
