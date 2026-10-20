import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (14:00 в Душанбе). Прошлые месяцы для подсказок — сентябрь и август. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function seedHistory(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await openApp(page);
  await addTx(page, { kind: 'income', amount: '9000', category: 'Зарплата', date: '2026-08-01' });
  await addTx(page, { amount: '437', category: 'Еда', date: '2026-09-10' });
  await addTx(page, { amount: '200', category: 'Еда', date: '2026-08-05' });
  await addTx(page, { amount: '50', category: 'Транспорт' }); // текущий месяц
  await dismissToasts(page);
}

test.describe('44. Бюджеты: подсказки суммы, ссылка «Поставить лимит», прошлые месяцы', () => {
  test('новый лимит на категорию: подсказка по прошлым тратам, кнопки с суммами, подкатегории и сохранение', async ({ page }, testInfo) => {
    await seedHistory(page);
    await goSection(page, 'Бюджеты');
    await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
    const dlg = sheet(page, 'Новый лимит');
    await expect(dlg).toBeVisible();
    // общего лимита ещё нет — выбраны «Все расходы», подсказка уже по ним; у категории без прошлых трат её нет
    await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: 'Транспорт' });
    await expect(dlg.getByTestId('limit-hints')).toHaveCount(0);
    await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: 'Еда' });
    const hints = dlg.getByTestId('limit-hints');
    await expect(hints).toBeVisible();
    await expect.poll(async () => norm(await hints.innerText())).toMatch(/в прошлом месяце 437 с\.,? обычно 318,50 с\. в месяц/);
    await shot(page, '44-limit-hints', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(500);
    await shot(page, '44-limit-hints-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    await dlg.getByRole('button', { name: /^Как в прошлом месяце/ }).click();
    await expect(dlg.getByRole('textbox', { name: /^Сумма лимита/ })).toHaveValue('440');
    await dlg.getByRole('button', { name: /^Как обычно/ }).click();
    await expect(dlg.getByRole('textbox', { name: /^Сумма лимита/ })).toHaveValue('320');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const row = page.getByRole('button', { name: /^Лимит «Еда»/ });
    await expect(row).toBeVisible();
    await expect(row).toHaveAccessibleName(/из 320\sс\./); // суммы в имени кнопки-строки
    await shot(page, '44-budgets-list', testInfo);
  });

  test('«Поставить лимит» на «Главной» открывает форму сразу; прошлый месяц пояснён', async ({ page }, testInfo) => {
    await seedHistory(page);
    await goSection(page, 'Главная');
    await page.getByRole('link', { name: 'Поставить лимит' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Бюджеты' })).toBeVisible();
    const dlg = sheet(page, 'Новый лимит');
    await expect(dlg).toBeVisible();
    await expect(page).toHaveURL(/#\/budgets$/); // параметр убран: «Назад» и обновление не откроют форму снова
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Бюджеты' })).toBeVisible();
    await expect(sheet(page, 'Новый лимит')).toHaveCount(0);

    // лимитов нет — пояснять про прошлые месяцы нечего; поставили лимит — пояснение появляется только в прошлом месяце
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByTestId('budgets-past-note')).toHaveCount(0);
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
    const add = sheet(page, 'Новый лимит');
    await expect(add).toBeVisible();
    await tapAmount(page, '1000');
    await add.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(add).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByTestId('budgets-past-note')).toHaveCount(0);
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByTestId('budgets-past-note')).toContainText('по сегодняшним суммам лимитов');
    await shot(page, '44-budgets-past-month', testInfo);
  });
});
