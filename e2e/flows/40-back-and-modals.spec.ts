import type { Page } from '@playwright/test';
import { addLink, addTx, confirmDiscard, dismissToasts, expect, goSection, openApp, openCategories, sheet, tapAmount, test } from '../helpers';

const hashOf = (page: Page) => new URL(page.url()).hash;
const main = (page: Page) => page.getByRole('main');
const ask = (page: Page) => page.getByRole('alertdialog', { name: 'Закрыть без сохранения?' });

async function addDebt(page: Page, name: string, amount: string): Promise<void> {
  await goSection(page, 'Долги');
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill(name);
  await tapAmount(page, amount);
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('40. «Назад» на вложенных экранах и в окнах', () => {
  test('«‹ Настройки» на экране «Категории» ведёт в Настройки, в том числе после прямого захода по ссылке', async ({ page }) => {
    await openApp(page);
    await openCategories(page);
    await main(page).getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();

    // прямой заход: истории в приложении нет, но кнопка ведёт на нужный экран, а не из приложения
    await openApp(page, '/settings/categories');
    await main(page).getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    expect(hashOf(page)).toBe('#/settings');
  });

  test('на странице долга «‹ Долги» ведёт в список, а браузерный «назад» — туда же, откуда пришли', async ({ page }) => {
    await openApp(page);
    await addDebt(page, 'Рустам', '300');
    await main(page).getByRole('link', { name: /Рустам/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Рустам' })).toBeVisible();
    // шапка телефона не повторяет «Sumoima» и переключатель темы: «назад» живёт в самой странице
    await main(page).getByRole('link', { name: 'Долги', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Долги' })).toBeVisible();

    await main(page).getByRole('link', { name: /Рустам/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Рустам' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Долги' })).toBeVisible();
  });

  test('после создания долга в истории нет лишней записи: «назад» уходит с экрана «Долги» сразу', async ({ page }) => {
    await openApp(page);
    await addDebt(page, 'Рустам', '300');
    await expect(page.getByRole('heading', { level: 1, name: 'Долги' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Долги' })).toBeHidden();
  });

  test('«назад» в браузере закрывает открытое окно, а страница остаётся прежней', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    const here = hashOf(page);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(sheet(page, 'Новый кошелёк')).toBeVisible();

    await page.goBack();
    await expect(sheet(page, 'Новый кошелёк')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Кошельки' })).toBeVisible();
    expect(hashOf(page)).toBe(here);
  });

  test('после закрытия окна крестиком лишних записей в истории нет: «назад» уходит со страницы, а не «закрывает» окно', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await sheet(page, 'Новый кошелёк').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(sheet(page, 'Новый кошелёк')).toBeHidden();
    await page.waitForTimeout(200); // запись окна снимается сразу после закрытия

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Кошельки' })).toBeHidden();
    await expect(sheet(page, 'Новый кошелёк')).toBeHidden();
  });

  test('с набранным названием «назад» и Esc спрашивают «Закрыть без сохранения?», «Остаться» ничего не теряет', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    const here = hashOf(page);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Копилка');

    await page.goBack();
    await expect(ask(page)).toBeVisible();
    expect(hashOf(page)).toBe(here);
    await ask(page).getByRole('button', { name: 'Остаться' }).click();
    await expect(ask(page)).toBeHidden();
    await expect(dlg.getByRole('textbox', { name: 'Название' })).toHaveValue('Копилка');

    await page.keyboard.press('Escape');
    await expect(ask(page)).toBeVisible();
    await confirmDiscard(page);
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Кошельки' })).toBeVisible();
    expect(hashOf(page)).toBe(here);
  });

  test('новая операция: с набранной суммой Esc спрашивает подтверждение, пустая форма закрывается сразу', async ({ page }) => {
    await openApp(page);
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();

    await addLink(page).click();
    await expect(dlg).toBeVisible();
    await tapAmount(page, '75');
    await page.keyboard.press('Escape');
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole('button', { name: 'Остаться' }).click();
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/75/);

    await page.keyboard.press('Escape');
    await confirmDiscard(page);
    await expect(dlg).toBeHidden();
    // запись окна не осталась в истории: адрес вернулся на «Главную», а «назад» не вернул шит
    expect(hashOf(page)).toBe('#/');
    await page.waitForTimeout(200);
    expect(hashOf(page)).toBe('#/');
    await expect(dlg).toBeHidden();
  });

  test('правка операции: удаление через подтверждение закрывает шит и остаётся на странице, откуда его открыли', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '40', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    const here = hashOf(page);
    await main(page).getByRole('button', { name: /Еда/ }).click();
    const dlg = sheet(page, 'Правка операции');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Удалить операцию' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Удалить операцию?' });
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(confirm).toBeHidden();
    await page.waitForTimeout(200);
    expect(hashOf(page)).toBe(here);
    await expect(dlg).toBeHidden();
  });
});
