import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (14:00 в Душанбе). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function addLimit(page: Page, category: string, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
  const dlg = sheet(page, 'Новый лимит');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: category });
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

const limitRow = (page: Page, category: string) => page.getByRole('button', { name: new RegExp(`^Лимит «${category}»`) });

test.describe('64. Фильтры списков: бюджеты и кошельки', () => {
  test('«Бюджеты»: фильтр по категории и по состоянию лимита, «Сбросить» возвращает всё', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { amount: '400', category: 'Еда' });
    await addTx(page, { amount: '100', category: 'Транспорт' });
    await addTx(page, { amount: '60', category: 'Развлечения' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await addLimit(page, 'Еда', '1000');
    await addLimit(page, 'Транспорт', '120');
    await addLimit(page, 'Развлечения', '50');
    await expect(limitRow(page, 'Еда')).toBeVisible();
    await expect(limitRow(page, 'Транспорт')).toBeVisible();
    await expect(limitRow(page, 'Развлечения')).toBeVisible();
    await shot(page, '64-budgets-all', testInfo);

    // по категории
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    const dlg = sheet(page, 'Фильтры лимитов');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('combobox', { name: 'Категория' }).selectOption({ label: 'Еда' });
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(dlg).toBeHidden();
    await expect(limitRow(page, 'Еда')).toBeVisible();
    await expect(limitRow(page, 'Транспорт')).toHaveCount(0);
    await expect(limitRow(page, 'Развлечения')).toHaveCount(0);
    await expect(page.getByTestId('active-filters')).toContainText('Еда');
    await shot(page, '64-budgets-by-category', testInfo);

    // сброс из строки под кнопкой
    await page.getByTestId('active-filters').getByRole('button', { name: 'Сбросить' }).click();
    await expect(limitRow(page, 'Транспорт')).toBeVisible();
    await expect(page.getByTestId('active-filters')).toHaveCount(0);

    // по состоянию: «Исчерпано» — только «Развлечения» (потрачено 60 из 50)
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await dlg.getByRole('button', { name: 'Исчерпано' }).click();
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(limitRow(page, 'Развлечения')).toBeVisible();
    await expect(limitRow(page, 'Еда')).toHaveCount(0);

    // ничего не подошло: категория «Еда» (в норме) + «Исчерпано»
    await page.getByRole('button', { name: /^Фильтры, включено/ }).click();
    await dlg.getByRole('combobox', { name: 'Категория' }).selectOption({ label: 'Еда' });
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByTestId('budgets-filter-empty')).toContainText('Нет лимитов, подходящих под выбранные фильтры');
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(limitRow(page, 'Еда')).toBeVisible();
    await expect(limitRow(page, 'Транспорт')).toBeVisible();
    await expect(limitRow(page, 'Развлечения')).toBeVisible();
  });

  test('«Кошельки»: фильтр по валюте сужает список, «Всего» не меняется', async ({ page }, testInfo) => {
    await openApp(page);
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '120' });
    await dismissToasts(page);
    await goSection(page, 'Кошельки');
    const total = page.getByTestId('wallets-total');
    const before = await total.innerText();
    await expect(page.getByRole('link', { name: /^Наличные/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Доллары/ })).toBeVisible();

    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    const dlg = sheet(page, 'Фильтры кошельков');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'USD', exact: true }).click();
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('link', { name: /^Доллары/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Наличные/ })).toHaveCount(0);
    await expect(page.getByTestId('wallets-filter-note')).toContainText('«Всего» считается по всем активным кошелькам');
    await expect(total).toHaveText(before);
    await shot(page, '64-wallets-by-currency', testInfo);

    await page.getByTestId('active-filters').getByRole('button', { name: 'Сбросить' }).click();
    await expect(page.getByRole('link', { name: /^Наличные/ })).toBeVisible();
    await expect(page.getByTestId('wallets-filter-note')).toHaveCount(0);
  });
});
