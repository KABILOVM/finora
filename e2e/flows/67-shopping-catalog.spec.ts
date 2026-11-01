import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, norm, openApp, sheet, shot, tapAmount, test } from '../helpers';

/**
 * 67. Каталог продуктов в «Покупках»: подсказки при вводе названия, личные цены, «В список покупок» из карточки продукта.
 */

const addButton = (page: Page) => page.getByRole('button', { name: 'Добавить позицию' }).first();
const row = (page: Page, name: string) => page.getByTestId('shopping-item').filter({ hasText: name });

test.describe('67. Покупки: каталог и цены', () => {
  test('из каталога в список, цена запоминается, «Картошка» и «Картофель» — один продукт, «В список покупок» из «Продуктов»', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Покупки');

    // «картошки» (родительный падеж) находит «Картофель»; выбор подставляет название и единицу
    await addButton(page).click();
    let dlg = sheet(page, 'Новая позиция');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('картошки');
    const hint = dlg.getByRole('button', { name: /^Картофель/ });
    await expect(hint).toContainText('Цены пока нет · за кг');
    await shot(page, '67-catalog-suggestions', testInfo);
    await hint.click();
    await expect(dlg.getByRole('textbox', { name: 'Название' })).toHaveValue('Картофель');
    await expect(dlg.getByRole('radio', { name: 'кг', exact: true })).toBeChecked();
    await dlg.getByRole('textbox', { name: /^Количество/ }).fill('2');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(row(page, 'Картофель')).toContainText('Картофель 2 кг');

    // в магазине: 24 с. за 2 кг → 12 с. за кг; подтверждаем покупку
    await page.getByRole('checkbox', { name: 'Положить в корзину: Картофель' }).click();
    const price = sheet(page, 'Цена в магазине');
    await expect(price).toBeVisible();
    await tapAmount(page, '24');
    await price.getByRole('button', { name: 'В корзину', exact: true }).click();
    await expect(price).toBeHidden();
    await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
    const confirm = sheet(page, 'Подтвердить покупку');
    await confirm.getByRole('group', { name: 'Категория' }).getByRole('button', { name: /Продукты/ }).click();
    await confirm.getByRole('button', { name: 'Записать расход' }).click();
    await expect(confirm).toBeHidden();
    await dismissToasts(page);

    // «Продукты»: у картофеля появилась личная цена; «В список покупок» кладёт его в список
    await goSection(page, 'Продукты');
    const potato = page.getByRole('button', { name: /^Картофель/ });
    await expect(potato).toContainText('Последняя 12,00 с. · средняя 12,00 с. за кг');
    await potato.click();
    const card = sheet(page, 'Картофель');
    await card.getByRole('button', { name: 'В список покупок' }).click();
    await expect(card).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'В списке покупок: Картофель' }).first()).toBeVisible();
    await dismissToasts(page);

    // в «Покупках»: «Картофель» 1 кг с ожидаемой ценой по прошлой покупке
    await goSection(page, 'Покупки');
    await expect(row(page, 'Картофель')).toContainText(money('обычно 12,00 с./кг'));
    await expect(row(page, 'Картофель')).toContainText(money('≈ 12,00 с.'));

    // новая позиция «картошка»: в подсказке личные цены, под полями — «Прошлый раз …»
    await addButton(page).click();
    dlg = sheet(page, 'Новая позиция');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('картошка');
    await expect(dlg.getByRole('button', { name: /^Картофель/ })).toContainText(money('Последняя 12,00 с. · средняя 12,00 с. за кг'));
    await dlg.getByRole('button', { name: /^Картофель/ }).click();
    await expect(page.getByTestId('item-past-price')).toContainText(money('Прошлый раз 12,00 с., в среднем 12,00 с. за кг'));
    expect(norm(await page.getByTestId('item-past-price').textContent())).toContain('за кг');
    await shot(page, '67-catalog-past-price', testInfo);
  });
});
