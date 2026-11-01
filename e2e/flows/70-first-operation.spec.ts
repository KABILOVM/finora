import { expect, openApp, shot, sheet, test } from '../helpers';

test.describe('70. «Запишите первую трату» на «Главной»', () => {
  test('у человека без операций: строка «Продукты 150» открывает заполненную форму, «Сохранить» — и карточка уходит', async ({ page }, testInfo) => {
    await openApp(page);
    const card = page.getByRole('region', { name: 'Запишите первую трату' });
    await expect(card).toBeVisible();
    await shot(page, '70-first-operation', testInfo);

    await card.getByRole('textbox', { name: 'Первая трата одной строкой' }).fill('Продукты 150');
    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue('150');
    await expect(dlg.getByRole('button', { name: /^Категория: Продукты/ })).toBeVisible();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();

    // первая операция есть — карточки больше нет, а операция видна в «Последних»
    await expect(page.getByRole('region', { name: 'Запишите первую трату' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Последние операции' })).toContainText('150');
  });

  test('строка без суммы: понятное сообщение, форма не открывается; пример подставляется нажатием', async ({ page }) => {
    await openApp(page);
    const card = page.getByRole('region', { name: 'Запишите первую трату' });
    await card.getByRole('textbox', { name: 'Первая трата одной строкой' }).fill('такси');
    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('Не вижу суммы');
    await expect(sheet(page, 'Новая операция')).toHaveCount(0);
    await card.getByRole('button', { name: 'Транспорт 20' }).click();
    await expect(card.getByRole('textbox', { name: 'Первая трата одной строкой' })).toHaveValue('Транспорт 20');
  });
});
