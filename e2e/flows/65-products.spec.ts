import { expect, goSection, openApp, shot, sheet, test } from '../helpers';

test.describe('65. Продукты (каталог)', () => {
  test('«Продукты» в меню: разделы, поиск по синониму и падежу, карточка продукта без покупок', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Продукты');

    // каталог по разделам, цен пока нет
    await expect(page.getByRole('heading', { level: 2, name: 'Овощи' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Дом и гигиена' })).toBeAttached();
    await shot(page, '65-products', testInfo);

    // поиск: «картошки» (родительный падеж) находит «Картофель»; чипов разделов в поиске нет
    const search = page.getByRole('searchbox', { name: 'Поиск продукта' });
    await search.fill('картошки');
    await expect(page.getByRole('button', { name: /^Картофель/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Покупал' })).toHaveCount(0);
    await search.fill('фывапролдж');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await search.fill('');

    // раздел «Покупал» пуст, пока нет покупок с ценой
    await page.getByRole('button', { name: 'Покупал' }).click();
    await expect(page.getByText('Покупок с ценой пока нет')).toBeVisible();

    // карточка продукта без покупок объясняет, откуда возьмётся цена
    await page.getByRole('button', { name: 'Овощи', exact: true }).click();
    await page.getByRole('button', { name: /^Картофель/ }).click();
    const card = sheet(page, 'Картофель');
    await expect(card).toBeVisible();
    await expect(card.getByText('Цены пока нет')).toBeVisible();
    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card).toBeHidden();
  });
});
