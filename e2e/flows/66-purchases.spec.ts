import { addLink, dismissToasts, expect, goSection, openApp, openCategoryList, shot, sheet, test } from '../helpers';

test.describe('66. «Что куплено» в «Новой операции»', () => {
  test('продукты в расходе: сумма = сумма строк, чек сохраняется, цены появляются в «Продуктах»', async ({ page }, testInfo) => {
    await openApp(page);
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();

    // у других категорий блока нет
    const group = await openCategoryList(dlg);
    await group.getByRole('button', { name: 'Еда', exact: true }).click();
    await expect(dlg.getByRole('button', { name: /^Что куплено/ })).toHaveCount(0);

    // у «Продуктов» — есть
    await (await openCategoryList(dlg)).getByRole('button', { name: 'Продукты', exact: true }).click();
    await dlg.getByRole('button', { name: 'Что куплено: добавить продукты' }).click();

    const buy = sheet(page, 'Что куплено');
    await expect(buy).toBeVisible();
    // картошка в родительном падеже находит «Картофель»
    await buy.getByRole('searchbox', { name: 'Найти продукт' }).fill('картошки');
    await buy.getByRole('button', { name: /^Картофель/ }).click();
    await buy.getByRole('textbox', { name: 'Количество' }).fill('2');
    await buy.getByRole('textbox', { name: 'Сумма за всё' }).fill('24');
    await expect(buy.getByText('Цена: 12,00 с. за кг')).toBeVisible();

    await buy.getByRole('searchbox', { name: 'Найти продукт' }).fill('молок');
    await buy.getByRole('button', { name: /^Молоко\s*Цены/ }).click();
    await buy.getByRole('textbox', { name: 'Сумма за всё' }).fill('13,50');
    await expect(buy.locator('p', { hasText: /Итого · 2 продукта/ })).toContainText('37,50');
    await shot(page, '66-purchases-sheet', testInfo);
    await buy.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(buy).toBeHidden();

    // сумма операции посчитана сама и недоступна для набора
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue('37,5');
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveAttribute('readonly', '');
    await expect(dlg.getByRole('button', { name: /^Что куплено: 2 продукта/ })).toContainText('37,50');
    await shot(page, '66-purchases-form', testInfo);

    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // в «Операциях» один расход на 37,50 в «Продуктах»
    await goSection(page, 'Операции');
    await expect(page.getByRole('main').getByText('Продукты').first()).toBeVisible();
    await expect(page.getByRole('main')).toContainText('37,50');

    // в «Продуктах» у картофеля и молока появились цены
    await goSection(page, 'Продукты');
    await expect(page.getByRole('button', { name: /^Картофель/ })).toContainText('Последняя 12,00 с.');
    await expect(page.getByRole('button', { name: /^Молоко\s/ }).first()).toContainText('Последняя 13,50 с.');
  });

  test('строка без суммы не даёт сохранить: окно открывается и показывает, что дописать', async ({ page }) => {
    await openApp(page);
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await (await openCategoryList(dlg)).getByRole('button', { name: 'Продукты', exact: true }).click();
    await dlg.getByRole('button', { name: 'Что куплено: добавить продукты' }).click();
    const buy = sheet(page, 'Что куплено');
    await buy.getByRole('searchbox', { name: 'Найти продукт' }).fill('хлеб');
    await buy.getByRole('button', { name: /^Хлеб\s*Цены/ }).click();
    await buy.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(buy.getByText('Введите сумму за этот продукт')).toBeVisible();
    await buy.getByRole('textbox', { name: 'Сумма за всё' }).fill('5');
    await buy.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(buy).toBeHidden();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue('5');
  });
});
