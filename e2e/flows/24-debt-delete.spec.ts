import type { Page } from '@playwright/test';
import {
  addTx, dismissToasts, expect, goSection, homeTotalText, money, moneyExact, monthRow, openApp, sheet, shot, tapAmount, test, walletRowText,
} from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

/** Доход 1000, затем долг «Алишер» 500 с выдачей денег и платёж 200: кошелёк 700, две операции по долгу. */
async function setup(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await openApp(page);
  await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
  await dismissToasts(page);
  await goSection(page, 'Долги');
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Алишер');
  await tapAmount(page, '500');
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
  await page.getByRole('link', { name: /^Алишер/ }).click();
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const pay = sheet(page, 'Платёж по долгу');
  const shown = (await pay.getByRole('textbox', { name: /^Сумма платежа/ }).inputValue()).replace(/[^\d,]/g, '');
  for (let i = 0; i < shown.length; i++) await pay.getByRole('button', { name: 'Стереть' }).click();
  await tapAmount(page, '200');
  await pay.getByRole('button', { name: 'Записать платёж' }).click();
  await expect(pay).toBeHidden();
  await dismissToasts(page);
}

const openDelete = async (page: Page) => {
  await page.getByRole('button', { name: 'Удалить долг', exact: true }).click();
  const dlg = page.getByRole('alertdialog', { name: /Удалить долг «Алишер»/ });
  await expect(dlg).toBeVisible();
  return dlg;
};

const wallet = async (page: Page): Promise<string> => {
  await goSection(page, 'Кошельки');
  return walletRowText(page, 'Наличные');
};

test.describe('24. Удаление долга', () => {
  test('«Удалить только долг»: операции остаются обычными, деньги не меняются; «Отменить» всё возвращает', async ({ page }, testInfo) => {
    await setup(page);
    const dlg = await openDelete(page);
    // вариант заранее не выбран: «Удалить» недоступно, пока не решили, что делать с операциями
    await expect(dlg.getByRole('radio', { name: 'Удалить только долг' })).not.toBeChecked();
    await expect(dlg.getByRole('radio', { name: 'Удалить долг и его операции' })).not.toBeChecked();
    await expect(dlg.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('Выберите, что сделать с 2 операциями');
    await dlg.getByRole('radio', { name: 'Удалить только долг' }).check();
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('2 операции останутся');
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('попадут в итоги и бюджеты');
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('в расходы добавится');
    await expect(dlg).toContainText('отправьте его в архив');
    await shot(page, '24-delete-dialog', testInfo);

    // «Отмена» ничего не меняет
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();

    const again = await openDelete(page);
    await expect(again.getByRole('radio', { name: 'Удалить только долг' })).not.toBeChecked(); // выбор не запоминается
    await again.getByRole('radio', { name: 'Удалить только долг' }).check();
    await again.getByRole('button', { name: 'Удалить', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Долг удалён' });
    await expect(toast).toBeVisible();
    await expect(page).toHaveURL(/#\/debts/);
    await expect(page.getByRole('link', { name: /^Алишер/ })).toHaveCount(0);
    await expect(page.getByTestId('attention-row')).toHaveCount(0);
    await shot(page, '24-deleted-toast', testInfo);

    // деньги те же (700), но теперь это обычные операции: расходы месяца 500, доходы 1000 + 200
    expect(await wallet(page)).toMatch(money('700 с.'));
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('−500 с.'));
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Долг: Алишер/ })).toHaveCount(0);

    await toast.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Долг возвращён' })).toBeVisible();
    await goSection(page, 'Долги');
    await expect(page.getByRole('link', { name: /^Алишер/ })).toContainText(money('300 с.'));
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('0 с.'));
    expect(await homeTotalText(page)).toMatch(money('700 с.'));
  });

  test('«Удалить долг и его операции»: кошелёк как до долга; «Отменить» возвращает всё', async ({ page }, testInfo) => {
    await setup(page);
    expect(await wallet(page)).toMatch(money('700 с.'));
    await goSection(page, 'Долги');
    await page.getByRole('link', { name: /^Алишер/ }).click();
    const dlg = await openDelete(page);
    await dlg.getByRole('radio', { name: 'Удалить долг и его операции' }).check();
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('2 операции');
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('расходов на');
    await expect(dlg.getByTestId('debt-delete-hint')).toContainText('доходов на');
    await shot(page, '24-delete-dialog-with-ops', testInfo);
    await dlg.getByRole('button', { name: 'Удалить', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Долг удалён' });
    await expect(toast).toBeVisible();
    await expect(page.getByRole('link', { name: /^Алишер/ })).toHaveCount(0);

    expect(await wallet(page)).toMatch(money('1 000 с.'));
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('0 с.'));
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Алишер|Долг/ })).toHaveCount(0);

    await toast.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Долг возвращён' })).toBeVisible();
    expect(await wallet(page)).toMatch(money('700 с.'));
    await goSection(page, 'Долги');
    await expect(page.getByRole('link', { name: /^Алишер/ })).toContainText(money('300 с.'));
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Долг: Алишер/ })).toHaveCount(2);
  });
});
