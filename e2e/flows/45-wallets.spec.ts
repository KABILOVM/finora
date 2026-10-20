import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, norm, openApp, shot, sheet, test } from '../helpers';

const rows = (page: Page) => page.getByRole('region').getByRole('button');

test.describe('45. Кошельки: строка ведёт к операциям, правка и сверка в форме, ?new=1', () => {
  test('нажатие на кошелёк открывает его операции за всё время; карандаш — правка; «Сверка остатка» — из правки', async ({ page }, testInfo) => {
    await openApp(page);
    await createWallet(page, { name: 'Карта', opening: '500' });
    await addTx(page, { amount: '10', category: 'Еда', wallet: 'Наличные', note: 'кофе' });
    await addTx(page, { amount: '20', category: 'Транспорт', wallet: 'Карта', note: 'такси' });
    await dismissToasts(page);
    await goSection(page, 'Кошельки');
    await shot(page, '45-wallets-list', testInfo);

    // строка — ссылка на экран кошелька: остаток, кнопки, последние операции только этого кошелька
    await page.getByRole('link', { name: /Карта/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Карта' })).toBeVisible();
    await expect(page).toHaveURL(/#\/wallets\/[^/]+$/);
    await expect(page.getByTestId('wallet-balance')).toContainText('480');
    await expect(page.getByRole('link', { name: 'Расход' })).toBeVisible();
    await expect(page.getByText('такси')).toBeVisible();
    await expect(page.getByText('кофе')).toHaveCount(0);
    await shot(page, '45-wallet-screen', testInfo);
    // «Расход» открывает форму сразу с этим кошельком
    await page.getByRole('link', { name: 'Расход' }).click();
    await expect(page.getByRole('button', { name: 'Кошелёк: Карта' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть' }).first().click();

    // «Все операции» — история кошелька (все даты), чужие операции не показаны
    await page.getByRole('link', { name: 'Все операции' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Операции' })).toBeVisible();
    await expect(page).toHaveURL(/#\/transactions\?wallet=[^&]+&period=all$/);
    await expect(page.getByRole('button', { name: 'Всё время' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('такси')).toBeVisible();
    await expect(page.getByText('кофе')).toHaveCount(0);

    // карандаш — правка; из правки — сверка
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Изменить: Карта' }).click();
    const dlg = sheet(page, 'Правка кошелька');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Сверка остатка' }).click();
    const rec = sheet(page, 'Сверка: Карта');
    await expect(rec).toBeVisible();
    await expect(rec).toContainText('= Остаток');
    await expect(rec).toContainText('Совпадает с остатком на экране «Кошельки»');
  });

  test('/wallets?new=1 открывает «Новый кошелёк» сразу; обновление страницы форму не открывает', async ({ page }) => {
    await openApp(page, '/wallets?new=1');
    const dlg = sheet(page, 'Новый кошелёк');
    await expect(dlg).toBeVisible();
    await expect(page).toHaveURL(/#\/wallets$/);
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Кошельки' })).toBeVisible();
    await expect(sheet(page, 'Новый кошелёк')).toHaveCount(0);
  });

  test('форма: вид — первым и с пояснением, «Банк» только у карты; «Всего» с разбивкой по валютам', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('Деньги на руках.')).toBeVisible();
    await expect(dlg.getByRole('group', { name: 'Банк' })).toHaveCount(0);
    await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Карта' }).click();
    await expect(dlg.getByRole('group', { name: 'Банк' })).toBeVisible();
    await shot(page, '45-wallet-form-card', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(500);
    await shot(page, '45-wallet-form-card-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();

    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '120' });
    await dismissToasts(page);
    const line = page.getByTestId('wallets-by-currency');
    await expect(line).toBeVisible();
    expect(norm(await line.innerText())).toMatch(/0 с\. · 120 \$/);
    await shot(page, '45-wallets-total-by-currency', testInfo);
  });
});
