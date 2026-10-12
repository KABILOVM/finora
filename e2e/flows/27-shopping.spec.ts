import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, isPhone, money, norm, openApp, sheet, shot, tapAmount, test } from '../helpers';

/**
 * 27. Покупки: список с флажками, память цен, «Подтвердить покупку» = один расход с чеком.
 * Деньги проверяем по тексту на экране; разметка — без горизонтальной прокрутки на узких телефонах.
 */

const addButton = (page: Page) => page.getByRole('button', { name: 'Добавить позицию' }).first();
const row = (page: Page, name: string) => page.getByTestId('shopping-item').filter({ hasText: name });

async function addItem(page: Page, name: string, qty: string, unit: 'шт' | 'кг' | 'л'): Promise<void> {
  await addButton(page).click();
  const dlg = sheet(page, 'Новая позиция');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Название' }).fill(name);
  await dlg.getByRole('radio', { name: unit, exact: true }).click();
  await dlg.getByRole('textbox', { name: /^Количество/ }).fill(qty);
  await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(row(page, name)).toBeVisible();
}

/** Положить позицию в корзину: цена с ценника на экранной клавиатуре (пусто — взять подставленную ожидаемую). */
async function putInCart(page: Page, name: string, price?: string): Promise<void> {
  await page.getByRole('checkbox', { name: `Положить в корзину: ${name}` }).click();
  const dlg = sheet(page, 'Цена в магазине');
  await expect(dlg).toBeVisible();
  if (price !== undefined) {
    // подставленную ожидаемую цену стираем и набираем свою
    const back = dlg.getByRole('button', { name: 'Стереть' });
    while ((await back.isEnabled().catch(() => false)) && /\d/.test(norm(await dlg.getByRole('textbox', { name: 'Цена за всю позицию' }).inputValue().catch(() => '')))) {
      await back.click();
    }
    await tapAmount(page, price);
  }
  await dlg.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('checkbox', { name: `Достать из корзины: ${name}` })).toBeVisible();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('27. Покупки', () => {
  test('основной сценарий: список → цены в магазине → один расход с чеком → цены запомнены', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Покупки');
    await expect(page.getByRole('heading', { level: 1, name: 'Покупки' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Список покупок пуст' })).toBeVisible();

    await addItem(page, 'Молоко', '2', 'л');
    await addItem(page, 'Яблоки', '1,4', 'кг');
    await addItem(page, 'Хлеб', '3', 'шт');
    await expect(row(page, 'Молоко')).toContainText('Молоко 2 л');
    await expect(row(page, 'Яблоки')).toContainText('Яблоки 1,4 кг');
    await expect(row(page, 'Хлеб')).toContainText('Хлеб × 3');
    // цен ещё нет: план нулевой, корзина пустая, кнопка покупки недоступна
    await expect(page.getByTestId('shopping-plan')).toContainText('без цены: 3');
    await expect(page.getByTestId('shopping-cart')).toContainText(money('0 с.'));
    await expect(page.getByRole('button', { name: 'Подтвердить покупку' })).toBeDisabled();

    // в магазине: цены вписываем; под ценой — цена за единицу
    await putInCart(page, 'Молоко', '26');
    await expect(row(page, 'Молоко')).toContainText(money('26,00 с.'));
    await expect(row(page, 'Молоко')).toContainText('13,00 за л');
    await putInCart(page, 'Хлеб', '10,5');
    await expect(row(page, 'Хлеб')).toContainText(money('10,50 с.'));
    await expect(row(page, 'Хлеб')).toContainText('3,50 за шт');
    await expect(page.getByTestId('shopping-cart')).toContainText(money('36,50 с.'));
    await shot(page, '27-shopping-cart', testInfo);

    // подтверждение: ОДИН расход на сумму отмеченного
    await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
    const dlg = sheet(page, 'Подтвердить покупку');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(money('36,50 с.'));
    await expect(dlg).toContainText('2 позиции в корзине');
    await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: /Продукты/ }).click();
    await shot(page, '27-shopping-confirm', testInfo);
    await dlg.getByRole('button', { name: 'Записать расход' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Покупка записана' }).first()).toBeVisible();
    await dismissToasts(page);

    // купленное ушло из списка; осталось неотмеченное
    await expect(row(page, 'Молоко')).toHaveCount(0);
    await expect(row(page, 'Хлеб')).toHaveCount(0);
    await expect(row(page, 'Яблоки')).toBeVisible();
    await expect(page.getByTestId('shopping-cart')).toContainText(money('0 с.'));

    // цены запомнены: новое молоко 3 л = «≈ 39,00 с.», «обычно 13,00 с./л»
    await addItem(page, 'Молоко', '3', 'л');
    const milk = row(page, 'Молоко');
    await expect(milk).toContainText(money('≈ 39,00 с.'));
    await expect(milk).toContainText(money('обычно 13,00 с./л'));
    await expect(page.getByTestId('shopping-plan')).toContainText(money('≈ 39,00 с.'));
    // ставим в корзину с подставленной ожидаемой ценой: «раньше 13,00 с./л», цена за литр та же
    await putInCart(page, 'Молоко');
    await expect(milk).toContainText(money('39,00 с.'));
    await expect(milk).toContainText('13,00 за л');
    await expect(milk).toContainText(money('раньше 13,00 с./л'));
    // достали из корзины — снова «≈»
    await page.getByRole('checkbox', { name: 'Достать из корзины: Молоко' }).click();
    await expect(milk).toContainText(money('≈ 39,00 с.'));
    await dismissToasts(page);

    // расход с чеком в «Операциях»
    await goSection(page, 'Операции');
    const tx = page.getByRole('button', { name: /36,50/ }).first();
    await expect(tx).toBeVisible();
    await tx.click();
    const edit = sheet(page, /Операция|Правка/);
    await expect(edit).toBeVisible();
    const receipt = edit.getByTestId('receipt');
    await expect(receipt).toContainText('Чек · 2 позиции');
    await expect(receipt).toContainText('Молоко 2 л');
    await expect(receipt).toContainText(money('26,00 с.'));
    await expect(receipt).toContainText('Хлеб × 3');
    await expect(receipt).toContainText(money('10,50 с.'));
    await expect(receipt).toContainText(money('36,50 с.'));
    await shot(page, '27-shopping-receipt', testInfo);
  });

  test('пустая корзина: покупку подтвердить нельзя; позицию можно изменить и удалить с возвратом', async ({ page }) => {
    await openApp(page, '/shopping');
    await addItem(page, 'Сыр', '0,5', 'кг');
    await expect(page.getByRole('button', { name: 'Подтвердить покупку' })).toBeDisabled();
    await row(page, 'Сыр').getByRole('button', { name: /^Изменить:/ }).click();
    const dlg = sheet(page, 'Позиция');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Сыр твёрдый');
    await dlg.getByRole('textbox', { name: /^Количество/ }).fill('0,75');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(row(page, 'Сыр твёрдый')).toContainText('Сыр твёрдый 0,75 кг');

    await row(page, 'Сыр твёрдый').getByRole('button', { name: /^Изменить:/ }).click();
    await sheet(page, 'Позиция').getByRole('button', { name: 'Удалить позицию' }).click();
    await expect(row(page, 'Сыр твёрдый')).toHaveCount(0);
    await page.getByRole('status').filter({ hasText: 'Удалено: Сыр твёрдый' }).getByRole('button', { name: 'Отменить' }).click();
    await expect(row(page, 'Сыр твёрдый')).toBeVisible();
  });

  test('ошибки ввода: пустое название, дробные штуки, лишние знаки в количестве', async ({ page }) => {
    await openApp(page, '/shopping');
    await addButton(page).click();
    const dlg = sheet(page, 'Новая позиция');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg.getByText('Впишите название товара')).toBeVisible();
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Яйца');
    await dlg.getByRole('textbox', { name: /^Количество/ }).fill('1,5');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg.getByText('Штуки — целое число')).toBeVisible();
    await dlg.getByRole('radio', { name: 'кг', exact: true }).click();
    await dlg.getByRole('textbox', { name: /^Количество/ }).fill('1,2345');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg.getByText(/до трёх знаков/)).toBeVisible();
    await dlg.getByRole('textbox', { name: /^Количество/ }).fill('1,234');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(row(page, 'Яйца')).toContainText('Яйца 1,234 кг');
  });

  test('двойное нажатие «Записать расход» создаёт один расход', async ({ page }) => {
    await openApp(page, '/shopping');
    await addItem(page, 'Рис', '1', 'кг');
    await putInCart(page, 'Рис', '12');
    await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
    const dlg = sheet(page, 'Подтвердить покупку');
    await dlg.getByRole('button', { name: 'Записать расход' }).dblclick();
    await expect(dlg).toBeHidden();
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /12 с\./ })).toHaveCount(1);
  });

  test('экраны и окна без горизонтальной прокрутки: 390×844, 375×667, 320×568', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'только телефон');
    await openApp(page, '/shopping');
    await addItem(page, 'Очень длинное название товара для проверки переноса строки', '1000', 'кг');
    await addItem(page, 'Молоко', '2', 'л');
    await putInCart(page, 'Молоко', '99999,99');
    for (const [w, h] of [[390, 844], [375, 667], [320, 568]] as const) {
      await page.setViewportSize({ width: w, height: h });
      expect(await noHorizontalScroll(page), `страница ${w}×${h}`).toBe(true);
      await shot(page, `27-shopping-${w}x${h}`, testInfo);
      await addButton(page).click();
      const add = sheet(page, 'Новая позиция');
      await expect(add).toBeVisible();
      expect(await noHorizontalScroll(page), `окно позиции ${w}×${h}`).toBe(true);
      const box = await add.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= w, `окно позиции в экране ${w}×${h}`).toBe(true);
      await add.getByRole('button', { name: 'Закрыть' }).click();
      await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
      const buy = sheet(page, 'Подтвердить покупку');
      await expect(buy).toBeVisible();
      expect(await noHorizontalScroll(page), `окно покупки ${w}×${h}`).toBe(true);
      await buy.getByRole('button', { name: 'Закрыть' }).click();
    }
  });

  test('«Добавить списком»: текст (диктовка) разбирается на позиции, их видно до добавления', async ({ page }, testInfo) => {
    await openApp(page, '/shopping');
    await page.getByRole('button', { name: 'Добавить списком' }).first().click();
    const dlg = sheet(page, 'Добавить списком');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled();
    await dlg.getByRole('textbox', { name: 'Что купить' }).fill('молоко два литра, хлеб три штуки, яблоки полтора килограмма и соль');
    const preview = dlg.getByTestId('parsed-items');
    await expect(preview).toContainText('Молоко');
    await expect(preview).toContainText('2 л');
    await expect(preview).toContainText('× 3');
    await expect(preview).toContainText('1,5 кг');
    await expect(dlg.getByRole('button', { name: 'Добавить 4 позиции' })).toBeVisible();
    if (isPhone(page)) expect(await noHorizontalScroll(page), 'окно списком без горизонтальной прокрутки').toBe(true);
    await shot(page, '27-shopping-list-text', testInfo);
    await dlg.getByRole('button', { name: 'Добавить 4 позиции' }).click();
    await expect(dlg).toBeHidden();
    await expect(row(page, 'Молоко')).toContainText('Молоко 2 л');
    await expect(row(page, 'Хлеб')).toContainText('Хлеб × 3');
    await expect(row(page, 'Яблоки')).toContainText('Яблоки 1,5 кг');
    await expect(row(page, 'Соль')).toBeVisible();
  });
});
