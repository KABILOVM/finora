import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

/** Добавить лимит через шит на экране «Бюджеты». */
async function addLimit(page: Page, scope: string, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
  const dlg = sheet(page, 'Новый лимит');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: scope });
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('35. Подсказки о лимитах', () => {
  test('70%, 90% и превышение: подсказки по ходу трат; выключатель на экране «Бюджеты»', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await addLimit(page, 'Еда', '500');
    const alerts = page.getByRole('switch', { name: 'Подсказки о лимитах' });
    await expect(alerts).toHaveAttribute('aria-checked', 'true');

    // 100 из 500 — 20%: тихо
    await addTx(page, { amount: '100', category: 'Еда' });
    await dismissToasts(page);
    // +260 — 72%: первая подсказка
    await addTx(page, { amount: '260', category: 'Еда' });
    const first = page.getByText(/«Еда»: потрачено 72% лимита\. Осталось/);
    await expect(first).toBeVisible();
    await expect(first).toContainText(money('140 с.'));
    await shot(page, '35-budget-alert', testInfo);
    await dismissToasts(page);

    // +100 — 92%
    await addTx(page, { amount: '100', category: 'Еда' });
    await expect(page.getByText(/«Еда»: потрачено 92% лимита/)).toBeVisible();
    await dismissToasts(page);

    // +100 — превышено на 60 с.
    await addTx(page, { amount: '100', category: 'Еда' });
    await expect(page.getByText(/Лимит «Еда» исчерпан: превышен на/)).toContainText(money('60 с.'));
    await dismissToasts(page);

    // выключатель: выключили — запомнилось, после перезагрузки тоже
    await goSection(page, 'Бюджеты');
    await alerts.click();
    await expect(alerts).toHaveAttribute('aria-checked', 'false');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Бюджеты' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Подсказки о лимитах' })).toHaveAttribute('aria-checked', 'false');
  });
});
