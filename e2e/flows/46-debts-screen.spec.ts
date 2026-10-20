import type { Page } from '@playwright/test';
import { addTx, closeActionMenu, debtAction, dismissToasts, expect, goSection, openActionMenu, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

/** Новый долг: экран «Долги» уже открыт. */
async function addDebt(page: Page, d: { name: string; amount: string; borrowed?: boolean; paper?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  await tapAmount(page, d.amount);
  if (d.paper) await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Платёж по открытому долгу на заданную сумму (страница долга открыта). */
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

test.describe('46. Долги: страница долга с меню «⋯», вкладка по данным, «Погашены»', () => {
  test('страница долга: на виду главное, редкое — в меню; платёж открывается; погашенный долг предлагает закрыться', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '2000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Бобур', amount: '500' });
    await page.getByRole('link', { name: /^Бобур/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Бобур' })).toBeVisible();

    // на виду — три главные кнопки и «Править»; редкое спрятано
    for (const name of ['Добавить платёж', 'Дал ещё в долг', 'Править']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Закрыть долг', 'В архив', 'Удалить долг', 'Получать частями']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await shot(page, '46-debt-page', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(400);
    await shot(page, '46-debt-page-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    const menu = await openActionMenu(page);
    for (const name of ['Получать частями', 'Закрыть долг', 'В архив', 'Удалить долг']) {
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await shot(page, '46-debt-menu', testInfo);
    await closeActionMenu(page);

    // строка платежа открывает операцию
    await pay(page, '200');
    await page.getByRole('button', { name: /^Открыть платёж: / }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: 'Бобур' })).toBeVisible();

    // выплатили всё — плашка «Закрыть долг» на виду, в меню этого пункта нет
    await pay(page, '300');
    await expect(page.getByText('Долг погашен полностью. Закройте его, чтобы он не висел среди открытых.')).toBeVisible();
    await shot(page, '46-debt-settled', testInfo);
    await debtAction(page, 'Закрыть долг');
    const confirm = page.getByRole('alertdialog', { name: 'Закрыть долг?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Закрыть долг', exact: true }).click();
    await expect(page.getByTestId('debt-summary')).toContainText('Закрыт');
    await dismissToasts(page);
    const menuAfter = await openActionMenu(page);
    await expect(menuAfter.getByRole('button', { name: 'Открыть снова', exact: true })).toBeVisible();
    await closeActionMenu(page);
  });

  test('«Мне должны» пусто, а «Я должен» есть — экран открывается на «Я должен»; погашенные долги собраны в «Погашены» и закрываются разом', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Банк', amount: '300', borrowed: true, paper: true });

    // уходим с экрана и возвращаемся без вкладки в адресе
    await goSection(page, 'Главная');
    await goSection(page, 'Долги');
    await expect(page.getByRole('radio', { name: 'Я должен' })).toBeChecked();
    await expect(page.getByRole('link', { name: /^Банк/ })).toBeVisible();

    // явная вкладка «Мне должны» остаётся, даже пустая
    await page.getByRole('radio', { name: 'Мне должны' }).click();
    await expect(page).toHaveURL(/dir=lent/);
    await expect(page.getByRole('heading', { name: 'Вам пока никто не должен' })).toBeVisible();

    // два долга, оба выплачены полностью
    await addDebt(page, { name: 'Алишер', amount: '100', paper: true });
    await page.getByRole('link', { name: /^Алишер/ }).click();
    await pay(page, '100');
    await page.getByRole('main').getByRole('link', { name: 'Долги', exact: true }).click();
    const settled = page.getByTestId('debts-settled');
    await expect(settled).toContainText('Погашены · 1');
    await expect(page.getByRole('list', { name: 'Мне должны' })).toHaveCount(0); // открытых нет — отдельного списка нет
    await shot(page, '46-debts-settled', testInfo);
    await page.getByRole('button', { name: 'Закрыть погашенный долг' }).click();
    await expect(page.getByTestId('debts-settled')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Закрытые · 1' })).toBeVisible();
  });
});
