import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { debtAction, dismissToasts, expect, goSection, money, openApp, sheet, shot, tapAmount, test } from '../helpers';

/**
 * Объединение долгов с РАЗНЫМИ условиями: у каждого вошедшего кредита остаются свои проценты, ставка, срок, даты и платежи.
 * «Сегодня» закреплено: 15 октября 2026.
 * Кредит 1: 10 000 с. под 24 % на 12 мес. (проценты 1 347,15), срок 01.12.2026. Кредит 2: 5 000 с. под 12 % на 6 мес.
 * (проценты вручную 300), срок 15.11.2026. Вместе к возврату 16 647,15.
 */
const NOW = new Date('2026-10-15T09:00:00Z');

async function credit(page: Page, o: { amount: string; rate: string; months: string; interest?: string; due: string }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: 'У кого я взял' }).fill('Банк');
  await tapAmount(page, o.amount);
  await dlg.getByRole('checkbox', { name: 'Есть проценты' }).check();
  await dlg.getByRole('textbox', { name: 'Ставка, % годовых' }).fill(o.rate);
  await dlg.getByRole('textbox', { name: 'Срок, месяцев' }).fill(o.months);
  if (o.interest !== undefined) await dlg.getByRole('textbox', { name: /^Проценты за весь срок/ }).fill(o.interest);
  await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
  await dlg.getByLabel('Срок возврата: календарь').fill(o.due);
  // тому же человеку: если предложено «добавить к существующему», берём отдельный долг
  const separate = dlg.getByRole('button', { name: 'Создать отдельный долг' });
  if (await separate.isVisible().catch(() => false)) await separate.click();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

const parts = (page: Page): Locator => page.getByTestId('debt-part');

test.describe('63. Объединённый долг: у каждого долга свои условия', () => {
  test('два кредита с разными процентами, сроками и датами: итог сверху, свои условия внутри, платёж в выбранную часть; переживает перезагрузку', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Долги');
    await credit(page, { amount: '10000', rate: '24', months: '12', due: '2026-12-01' });
    await credit(page, { amount: '5000', rate: '12', months: '6', interest: '300', due: '2026-11-15' });
    await expect(page.getByRole('link', { name: /^Банк/ })).toHaveCount(2);

    // объединяем: на странице первого кредита «Объединить…», одноимённый уже отмечен
    await page.getByRole('link', { name: /^Банк/ }).filter({ hasText: money('11 347,15 с.') }).first().click();
    await debtAction(page, 'Объединить…');
    const merge = sheet(page, 'Объединить долги');
    await expect(merge).toBeVisible();
    await expect(merge.getByRole('checkbox').first()).toBeChecked();
    await expect(merge.getByTestId('merge-preview')).toContainText(money('16 647,15 с.')); // остаток = сумма остатков частей
    await expect(merge.getByTestId('merge-preview')).toContainText('15.11.2026'); // ближайший срок
    await shot(page, '63-merge-sheet', testInfo);
    await merge.getByRole('button', { name: /^Объединить: 2 долга$/ }).click();
    await expect(merge).toBeHidden();
    await dismissToasts(page);

    // страница объединённого долга: итог и две составляющие, у каждой свои проценты, ставка, срок и даты
    await expect(page.getByTestId('debt-remaining')).toContainText(money('16 647,15 с.'));
    await expect(page.getByRole('heading', { name: /Из чего состоит · 2/ })).toBeVisible();
    await expect(parts(page)).toHaveCount(2);
    await expect(parts(page).nth(0)).toContainText('24 % годовых');
    await expect(parts(page).nth(0)).toContainText('12 месяцев');
    await expect(parts(page).nth(0)).toContainText('01.12.2026');
    await expect(parts(page).nth(0)).toContainText(money('11 347,15 с.'));
    await expect(parts(page).nth(1)).toContainText('12 % годовых');
    await expect(parts(page).nth(1)).toContainText('6 месяцев');
    await expect(parts(page).nth(1)).toContainText('15.11.2026');
    await expect(parts(page).nth(1)).toContainText(money('5 300 с.'));
    await shot(page, '63-group-detail', testInfo);
    // составляющие целиком (ниже первого экрана): снимок самого блока
    const dir = process.env.E2E_SHOTS ?? join(process.cwd(), 'test-results', 'shots');
    mkdirSync(dir, { recursive: true });
    await page.getByTestId('debt-parts').screenshot({ path: join(dir, `${testInfo.project.name}-63-group-parts.png`) });
    // на телефоне ничего не вылезает за экран
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'горизонтальной прокрутки нет').toBeLessThanOrEqual(1);

    // платёж 1 000 в ВТОРУЮ часть: её остаток уменьшился, первая не тронута
    await parts(page).nth(1).getByRole('button', { name: /^Платёж: / }).click();
    const pay = sheet(page, 'Платёж по долгу');
    await expect(pay).toBeVisible();
    const shown = (await pay.getByRole('textbox', { name: /^Сумма платежа/ }).inputValue()).replace(/[^\d,]/g, '');
    for (let i = 0; i < shown.length; i++) await pay.getByRole('button', { name: 'Стереть' }).click();
    await tapAmount(page, '1000');
    await pay.getByRole('button', { name: 'Записать платёж' }).click();
    await expect(pay).toBeHidden();
    await dismissToasts(page);
    await expect(parts(page).nth(1)).toContainText(money('4 300 с.'));
    await expect(parts(page).nth(0)).toContainText(money('11 347,15 с.'));
    await expect(page.getByTestId('debt-remaining')).toContainText(money('15 647,15 с.'));

    // в списке один долг с пометкой «2 долга» и общим остатком
    await goSection(page, 'Долги');
    const row = page.getByRole('link', { name: /^Банк/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2 долга');
    await expect(row).toContainText(money('15 647,15 с.'));
    await shot(page, '63-group-list', testInfo);

    // после перезагрузки всё на месте
    await page.reload();
    await expect(page.getByRole('link', { name: /^Банк/ })).toHaveCount(1);
    await page.getByRole('link', { name: /^Банк/ }).click();
    await expect(parts(page)).toHaveCount(2);
    await expect(page.getByTestId('debt-remaining')).toContainText(money('15 647,15 с.'));
  });
});
