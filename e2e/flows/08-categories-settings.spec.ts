import { addTx, openCategories, openCategoryList, createWallet, dismissToasts, expect, fillTx, goSection, openApp, shot, sheet, test } from '../helpers';

test.describe('8. Категории и настройки', () => {
  test('добавить категорию, она доступна при внесении; архивировать — пропадает из выбора, возвращается из архива', async ({ page }, testInfo) => {
    await openApp(page);
    await openCategories(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();

    // Добавить «Кафе»
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    let dlg = sheet(page, 'Новая категория расходов');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Кафе');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    const list = page.getByRole('main').getByRole('list').first();
    await expect(list.getByText('Кафе', { exact: true })).toBeVisible();
    await shot(page, '08-categories', testInfo);

    // Повтор названия отвергается понятным текстом, а не молча
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    dlg = sheet(page, 'Новая категория расходов');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('кафе');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText('Такая категория уже есть')).toBeVisible();
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(list.getByText('Кафе', { exact: true })).toHaveCount(1);

    // Новая категория предлагается при внесении операции, и операция в ней сохраняется
    await dismissToasts(page);
    const add = await fillTx(page, { amount: '15', category: 'Кафе' });
    await add.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(add).toBeHidden();
    await dismissToasts(page);

    // Архивировать
    await openCategories(page);
    await page.getByRole('button', { name: /^Кафе/ }).click();
    dlg = sheet(page, 'Правка категории');
    await dlg.getByRole('button', { name: 'Убрать в архив' }).click();
    const confirm = page.getByRole('alertdialog', { name: /Убрать «Кафе» в архив/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'В архив' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: /^Кафе/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Архив · 1 категория/ })).toBeVisible();
    await dismissToasts(page);

    // В архиве — не предлагается при новой операции
    const add2 = await fillTx(page, { amount: '1' });
    await openCategoryList(add2);
    await expect(add2.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Кафе', exact: true })).toHaveCount(0);
    await expect(add2.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда', exact: true })).toBeVisible();
    await add2.getByRole('button', { name: 'Закрыть' }).click();
    await expect(add2).toBeHidden();

    // Старая операция осталась со своей категорией
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Кафе/ })).toHaveCount(1);

    // Вернуть из архива
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Категории' }).click();
    await page.getByRole('button', { name: /^Архив · 1 категория/ }).click();
    await page.getByRole('button', { name: 'Вернуть: Кафе' }).click();
    await expect(page.getByRole('button', { name: /^Кафе/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Архив/ })).toHaveCount(0);

    // Данные переживают перезагрузку
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Кафе/ })).toHaveCount(1);
  });

  test('вкладка «Доходы»: своя категория дохода вносится в доход', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Категории' }).click();
    await page.getByRole('radio', { name: 'Доходы' }).click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новая категория доходов');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Фриланс');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await addTx(page, { kind: 'income', amount: '250', category: 'Фриланс' });
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Фриланс/ })).toContainText('250');
  });

  test('«Настройки»: только нужное, технических разделов нет; курсы появляются вместе с валютным кошельком', async ({ page }, testInfo) => {
    await openApp(page);
    await addTx(page, { amount: '12,5', category: 'Еда' });
    await goSection(page, 'Настройки');
    for (const title of ['Оформление', 'Валюта учёта', 'Резервная копия']) {
      await expect(page.getByRole('region', { name: title }), `раздел «${title}»`).toBeVisible();
    }
    for (const title of ['Аккаунт', 'Синхронизация', 'Проверка облака', 'Курсы валют', 'Проверка данных', 'Хранилище', 'Установка на телефон', 'О приложении']) {
      await expect(page.getByRole('region', { name: title }), `лишний раздел «${title}»`).toHaveCount(0);
    }
    await shot(page, '08-settings', testInfo);

    // кошелёк в другой валюте → нужны курсы → раздел появился
    await createWallet(page, { name: 'Доллары', currency: 'USD' });
    await goSection(page, 'Настройки');
    await expect(page.getByRole('region', { name: 'Курсы валют' }).getByRole('button', { name: 'Обновить курсы' })).toBeVisible();
  });

  test('«Обновить курсы» без доступа к источникам: понятная ошибка, приложение не ломается, остатки на месте', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '12,5', category: 'Еда' });
    await createWallet(page, { name: 'Доллары', currency: 'USD' });
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Обновить курсы' }).click();
    // человек видит, что не получилось (тост или строка «Последняя попытка не удалась»), а не вечную крутилку
    await expect(page.getByText(/Не удалось обновить курсы/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить курсы' })).toBeEnabled();
    await goSection(page, 'Главная');
    await expect(page.getByTestId('home-total')).toContainText('12,50');
  });
});
