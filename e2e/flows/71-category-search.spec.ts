import { addLink, expect, isPhone, openApp, shot, sheet, tapAmount, test } from '../helpers';

async function openCategories(page: Parameters<typeof addLink>[0]) {
  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /^Категория:/ }).click();
  return dlg;
}

test.describe('71. Поиск категории в окне «Новая операция»', () => {
  test('набор сужает список, найденное выбирается одним касанием и сохраняется с операцией', async ({ page }, testInfo) => {
    await openApp(page);
    const dlg = await openCategories(page);
    const search = dlg.getByRole('searchbox', { name: 'Поиск категории' });
    await expect(search).toBeVisible();
    // на ПК курсор в поле сразу, на телефоне — нет: клавиатура закрыла бы сетку
    if (isPhone(page)) await expect(search).not.toBeFocused();
    else await expect(search).toBeFocused();

    await search.fill('здор');
    const grid = dlg.getByRole('group', { name: 'Категория' });
    await expect(grid.getByRole('button', { name: 'Здоровье' })).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Транспорт' })).toHaveCount(0);
    await shot(page, '71-category-search', testInfo);

    await grid.getByRole('button', { name: 'Здоровье' }).click();
    await expect(dlg.getByRole('button', { name: 'Категория: Здоровье' })).toBeVisible();
    await tapAmount(page, '40');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('region', { name: 'Последние операции' })).toContainText('Здоровье');
  });

  test('Enter выбирает лучшее совпадение и не сохраняет операцию', async ({ page }) => {
    test.skip(isPhone(page), 'Enter с физической клавиатуры — сценарий для ПК');
    await openApp(page);
    const dlg = await openCategories(page);
    await page.keyboard.type('транс');
    await page.keyboard.press('Enter');
    await expect(dlg.getByRole('button', { name: 'Категория: Транспорт' })).toBeVisible();
    await expect(dlg).toBeVisible(); // окно не закрылось: форма не отправлена
  });

  test('не нашлось: «Новая» подставляет набранное название, и категория сразу выбирается', async ({ page }) => {
    await openApp(page);
    const dlg = await openCategories(page);
    await dlg.getByRole('searchbox', { name: 'Поиск категории' }).fill('Кофейня');
    await expect(dlg.getByRole('status')).toContainText('Такой категории нет');
    await dlg.getByRole('button', { name: 'Новая категория' }).click();
    await expect(dlg.getByRole('textbox', { name: 'Название новой категории' })).toHaveValue('Кофейня');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg.getByRole('button', { name: 'Категория: Кофейня' })).toBeVisible();
  });
});
