import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, openApp, shot, sheet, test } from '../helpers';

/** Дата 'ГГГГ-ММ-ДД' по часовому поясу проекта (Asia/Dushanbe), сдвиг в днях от настоящего момента. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Dushanbe' });

/** Открыть «Платежи» и создать регулярный платёж (расход) через окно. */
async function addRule(page: Page, r: { amount: string; note: string; start: string }): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(r.amount);
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(r.note);
  await dlg.getByLabel('Первый платёж').fill(r.start);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('47. Регулярные платежи: сводка «в месяц», дата оплаты просроченного, «Провести» с отменой', () => {
  test('сводка «в месяц» над списком; просроченный платёж оплачивают сегодня — по умолчанию дата оплаты «Сегодня»', async ({ page }, testInfo) => {
    await openApp(page);
    await addRule(page, { amount: '500', note: 'аренда', start: day(-3) });
    await addRule(page, { amount: '120', note: 'интернет', start: day(5) });

    const summary = page.getByTestId('recurring-monthly');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(money('620 с.')); // 500 + 120 в месяц
    await expect(summary).toContainText('В месяц, примерно');
    // порядок: сводка выше «Просроченных»
    const box = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!.y;
    expect(await box(summary)).toBeLessThan(await box(page.getByRole('heading', { name: 'Просроченные' })));
    await shot(page, '47-recurring', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(400);
    await shot(page, '47-recurring-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // «Провести» просроченную: в окне есть «Дата оплаты», выбрано «Сегодня»
    await page.getByRole('button', { name: /^Провести: аренда/ }).first().click(); // самая давняя (просроченная) дата
    const dlg = sheet(page, 'Провести платёж');
    await expect(dlg).toBeVisible();
    const paid = dlg.getByRole('group', { name: 'Дата оплаты' });
    await expect(paid.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '47-post-overdue', testInfo);
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // платёж больше не просрочен
    await expect(page.getByRole('heading', { name: 'Просроченные' })).toHaveCount(0);
    // операция записана на сегодня: она в группе «Сегодня» журнала
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: 'Всё время' }).click();
    await expect(page.getByText('аренда').first()).toBeVisible();
    await expect(page.getByText('Сегодня', { exact: true }).first()).toBeVisible();
  });

  test('«Провести» одним касанием на «Главной» с отменой: платёж пропадает из операций и остаётся среди пропущенных', async ({ page }) => {
    await openApp(page);
    await addRule(page, { amount: '50', note: 'кофе', start: day(0) });
    await goSection(page, 'Главная');
    await page.getByRole('button', { name: /^Провести: кофе/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж проведён: кофе' })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж отменён' })).toBeVisible();
    await dismissToasts(page);
    await goSection(page, 'Платежи');
    await expect(page.getByRole('button', { name: 'Пропущенные · 1' })).toBeVisible();
  });
});
