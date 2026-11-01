import { expect, openApp, sheet, test } from '../helpers';

/**
 * Ярлыки на иконке установленного приложения (манифест) открывают адреса `#/add`, `#/add?kind=income`, `#/add?kind=transfer`.
 * Здесь они открываются как есть, без перехода из приложения: форма «Новая операция» должна встать на нужный вид.
 */
test.describe('48. Ярлыки на иконке: адрес открывает форму операции сразу на нужном виде', () => {
  test('«Новый доход»: форма на вкладке «Доход»; закрытие ведёт на «Главную»', async ({ page }) => {
    await openApp(page, '/add?kind=income');
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('radio', { name: 'Доход' })).toBeChecked();
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    await expect(page).toHaveURL(/#\/$/); // прямой заход: «назад» вёл бы из приложения, поэтому запись заменена на «Главную»
    await expect(page.getByRole('heading', { name: 'Главная', level: 1 })).toBeVisible();
  });

  test('«Новый расход» (без параметра) — на «Расход»', async ({ page }) => {
    await openApp(page, '/add');
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('radio', { name: 'Расход' })).toBeChecked();
  });

  test('«Перевод»: при одном кошельке форма не ломается и остаётся на «Перевод»', async ({ page }) => {
    await openApp(page, '/add?kind=transfer');
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('radio', { name: 'Перевод' })).toBeChecked();
  });

  test('непонятный вид в адресе — обычный расход', async ({ page }) => {
    await openApp(page, '/add?kind=%D1%87%D1%83%D1%88%D1%8C');
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('radio', { name: 'Расход' })).toBeChecked();
  });
});
