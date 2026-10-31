import { expect, openApp, openCategories, shot, sheet, test } from '../helpers';

const CATALOG_BUTTON = 'Готовые категории с подкатегориями';

test.describe('67. Готовые категории с подкатегориями', () => {
  test('«Категории» → «Готовые категории»: наборы с галочками, состав раскрывается, выбранное добавляется под родителей', async ({ page }, testInfo) => {
    await openApp(page);
    await openCategories(page);
    const main = page.getByRole('main');
    await expect(main.getByText('Коммунальные услуги', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: CATALOG_BUTTON }).click();
    const dlg = sheet(page, 'Готовые категории');
    await expect(dlg.getByRole('checkbox', { name: 'Набор «Коммунальные услуги»' })).toBeChecked();
    await expect(dlg.getByRole('checkbox', { name: 'Набор «Путешествия»' })).not.toBeChecked();

    await dlg.getByRole('button', { name: 'Показать состав набора «Коммунальные услуги»' }).click();
    for (const name of ['Электричество', 'Вода', 'Газ', 'Отопление']) await expect(dlg.getByRole('checkbox', { name })).toBeChecked();
    await shot(page, '67-catalog-open', testInfo);

    // «Газ» не нужен: снимаем; «Путешествия» нужны целиком: отмечаем
    await dlg.getByRole('checkbox', { name: 'Газ' }).uncheck();
    await dlg.getByRole('checkbox', { name: 'Набор «Путешествия»' }).check();
    await dlg.getByRole('button', { name: /^Добавить выбранное · \d+$/ }).click();
    await expect(dlg).toBeHidden();

    await expect(main.getByText('Коммунальные услуги', { exact: true })).toBeVisible();
    await expect(main.getByText('Электричество', { exact: true })).toBeVisible();
    await expect(main.getByText('Газ', { exact: true })).toHaveCount(0);
    await expect(main.getByText('Путешествия', { exact: true })).toBeVisible();
    await expect(main.getByText('Мясо и птица', { exact: true })).toBeVisible(); // под стартовой «Продукты»
    await shot(page, '67-catalog-added', testInfo);

    // Повторное открытие: сделанное уже не предлагается, «Газ» и непринятые наборы — по-прежнему можно
    await page.getByRole('button', { name: CATALOG_BUTTON }).click();
    const again = sheet(page, 'Готовые категории');
    await expect(again.getByRole('checkbox', { name: 'Набор «Путешествия»' })).toHaveCount(0);
    await expect(again.getByRole('checkbox', { name: 'Набор «Коммунальные услуги»' })).toBeVisible();
  });

  test('в тёмной теме окно читается', async ({ page }, testInfo) => {
    await openApp(page);
    await page.evaluate(() => localStorage.setItem('finora-theme', 'dark'));
    await page.reload();
    await openCategories(page);
    await page.getByRole('button', { name: CATALOG_BUTTON }).click();
    const dlg = sheet(page, 'Готовые категории');
    await dlg.getByRole('button', { name: 'Показать состав набора «Семья»' }).click();
    await expect(dlg.getByRole('checkbox', { name: 'Дети' })).toBeChecked();
    await shot(page, '67-catalog-dark', testInfo);
  });
});
