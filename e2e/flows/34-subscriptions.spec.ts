import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, sheet, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

const MONTHLY = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'];

test.describe('34. Подписки: «Похоже на подписки»', () => {
  test('повторяющиеся расходы предлагают завести платёж; «Создать платёж» заполняет окно; «Не показывать» убирает подсказку', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    for (const date of MONTHLY) await addTx(page, { amount: '49', note: 'Netflix', date });
    for (const date of MONTHLY) await addTx(page, { amount: '15', note: 'Музыка', date });
    await addTx(page, { amount: '120', note: 'обед' }); // единичная трата подсказки не даёт
    await dismissToasts(page);

    await goSection(page, 'Платежи');
    const card = page.getByTestId('subscriptions-card');
    await expect(card).toBeVisible();
    // подсказки свёрнуты в одну строку «Похоже на подписки · N»: раскрываем
    const toggle = card.getByRole('button', { name: 'Похоже на подписки · 2' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByTestId('subscription-item')).toHaveCount(0);
    await toggle.click();
    const items = card.getByTestId('subscription-item');
    await expect(items).toHaveCount(2);
    // дороже — выше: Netflix 49 против 15
    await expect(items.first()).toContainText('Netflix');
    await expect(items.first()).toContainText(money('49 с.'));
    await expect(items.first()).toContainText('раз в месяц');
    await expect(items.first()).toContainText('4 платежа, последний 3 октября');
    await expect(card).not.toContainText('обед');
    await shot(page, '34-subscriptions', testInfo);
    await noHorizontalScroll(page, 'Платежи');

    // «Создать платёж»: окно с заполненными полями, первый платёж — ближайшая дата по серии
    await card.getByRole('button', { name: 'Создать платёж: Netflix' }).click();
    const dlg = sheet(page, 'Новый регулярный платёж');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: 'Название или заметка' })).toHaveValue('Netflix');
    await expect(dlg.getByLabel('Первый платёж')).toHaveValue('2026-11-03');
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/49/);
    await shot(page, '34-subscriptions-sheet', testInfo);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();

    // Netflix заведён — подсказка пропала, платёж виден среди правил; «Музыка» осталась
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Музыка');
    await expect(page.getByRole('region', { name: 'Все правила' }).getByText('Netflix')).toBeVisible();

    // «Не показывать»: подсказки больше нет, и после перезагрузки тоже
    await items.first().getByRole('button', { name: 'Не показывать: Музыка' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Регулярные платежи' })).toBeVisible();
    await expect(page.getByTestId('subscriptions-card')).toHaveCount(0);
  });
  test('подорожало: «было 49, стало 59 (+20%)», годовая сумма у подписки и общая; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    for (const date of ['2026-05-03', '2026-06-03']) await addTx(page, { amount: '49', note: 'Netflix', date });
    for (const date of ['2026-07-03', '2026-08-03', '2026-09-03']) await addTx(page, { amount: '59', note: 'Netflix', date });
    await dismissToasts(page);

    await goSection(page, 'Платежи');
    const card = page.getByTestId('subscriptions-card');
    await expect(card).toBeVisible();
    // свёрнутая строка уже говорит про сумму за год и про подорожание
    await expect(card).toContainText('В сумме ≈');
    await expect(card).toContainText('Подорожало: 1.');
    await card.getByRole('button', { name: 'Похоже на подписки · 1' }).click();
    await expect(card.getByTestId('subscription-rise')).toHaveText('Подорожало: было 49 с., стало 59 с. (+20%)');
    await expect(card.getByTestId('subscriptions-total')).toContainText('Всего в год: ≈');
    await expect(card.getByTestId('subscription-item').first()).toContainText('В год ≈');
    await expect(card.getByTestId('subscription-rise')).toBeInViewport();
    await noHorizontalScroll(page, 'Платежи (подорожало)');
    await shot(page, '34-subscriptions-rise', testInfo);
  });
});
