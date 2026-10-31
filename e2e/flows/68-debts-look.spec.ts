import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function addDebt(page: Page, d: { name: string; amount: string; borrowed?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  await tapAmount(page, d.amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

async function pay(page: Page, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Платёж по долгу');
  await expect(dlg).toBeVisible();
  const shown = (await dlg.getByRole('textbox', { name: /^Сумма платежа/ }).inputValue()).replace(/[^\d,]/g, '');
  for (let i = 0; i < shown.length; i++) await dlg.getByRole('button', { name: 'Стереть' }).click();
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Записать платёж' }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('68. Долги: цветной итог, кружки людей, общая полоса', () => {
  test('итог показывает открытые долги и «Возвращено N%», у строк кружки с инициалами; вкладка «Люди» тоже', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер Каримов', amount: '500' });
    await addDebt(page, { name: 'Бобур', amount: '300' });
    await page.getByRole('link', { name: /^Алишер Каримов/ }).click();
    await pay(page, '200');
    await page.getByRole('link', { name: 'Долги', exact: true }).first().click().catch(() => undefined);
    await goSection(page, 'Долги');

    const totals = page.getByTestId('debts-totals');
    await expect(totals).toContainText('Вам должны всего');
    await expect(totals).toContainText('2 открытых долга');
    await expect(totals).toContainText('Возвращено 25%'); // вернули 200 из 800
    await expect(page.getByRole('progressbar', { name: 'Итого: Возвращено 25%' })).toBeVisible();

    const first = page.getByRole('list', { name: 'Мне должны' }).getByRole('link').first();
    await expect(first.locator('[data-initials]')).toBeVisible();
    await expect(page.locator('[data-initials="АК"]')).toBeVisible();
    await shot(page, '68-debts-look', testInfo);

    await page.getByRole('radio', { name: 'Люди' }).click();
    await expect(page.getByRole('list', { name: 'Люди' })).toBeVisible();
    await expect(page.locator('[data-initials="Б"]')).toBeVisible();
    await shot(page, '68-debts-people', testInfo);
  });
});
