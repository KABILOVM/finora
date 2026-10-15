import type { Locator, Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

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

    // чистый капитал: деньги в кошельках 3 000 − 120 − 300 − 45 − 200 (сентябрьская трата) = 2 335, долгов нет
    await expect(page.getByTestId('networth-total')).toContainText(money('2 335 с.'));
    await expect(page.getByTestId('networth-rows')).toContainText('Деньги в кошельках');
    await expect(page.getByTestId('networth-rows')).not.toContainText('Мне должны');
    await expect(page.getByTestId('balance-line')).toBeVisible();
    await shot(page, '30-analytics-networth', testInfo);

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

  test('«Темп трат»: прогноз на конец месяца, лимит, который не дотянет, и подсказка в «Бюджетах»', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await addTx(page, { amount: '420', category: 'Еда' });
    await addTx(page, { amount: '200', category: 'Продукты', date: '2026-09-20' });
    await dismissToasts(page);

    await goSection(page, 'Аналитика');
    // 420 с. за 15 дней из 31 → floor(42 000 × 31 ÷ 15) = 86 800 → ≈ 868 с.; в прошлом месяце было 200 с.
    const card = page.getByTestId('pace-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('pace-projection')).toContainText(money('868 с.'));
    await expect(page.getByTestId('pace-previous')).toContainText(money('200 с.'));
    await expect(page.getByTestId('pace-budget')).toHaveCount(0); // лимитов нет
    await shot(page, '30-pace-card', testInfo);
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByTestId('analytics-summary')).toContainText('Расходы за сентябрь 2026');
    await expect(card).toHaveCount(0); // в прошедшем месяце прогнозировать нечего

    // лимит на «Еду» 500 с.: при таком темпе кончится на ceil(500 × 15 ÷ 420) = 18-й день
    await goSection(page, 'Бюджеты');
    await page.getByRole('button', { name: 'Поставить первый лимит' }).click();
    const dlg = sheet(page, 'Новый лимит');
    await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: 'Еда' });
    await tapAmount(page, '500');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByTestId('budget-pace')).toHaveText('При таком темпе лимит закончится около 18 октября');
    await shot(page, '30-pace-budget-row', testInfo);

    await goSection(page, 'Аналитика');
    const item = page.getByTestId('pace-budget');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Еда');
    await expect(item).toContainText('закончится около 18 октября');
    await expect(item).toContainText(money('368 с.')); // 868 − 500
    await shot(page, '30-pace-card-budget', testInfo);
    await noHorizontalScroll(page, 'Аналитика с темпом');
  });
});

