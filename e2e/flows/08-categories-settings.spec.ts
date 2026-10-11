import { addTx, dismissToasts, expect, fillTx, goSection, openApp, shot, sheet, test } from '../helpers';

test.describe('8. Категории и настройки', () => {
  test('добавить категорию, она доступна при внесении; архивировать — пропадает из выбора, возвращается из архива', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Категории' }).click();
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
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Категории' }).click();
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

  test('«Настройки»: видны все разделы; в локальном режиме облако объяснено честно; «Проверка данных» ничего не находит в чистых данных', async ({ page }, testInfo) => {
    await openApp(page);
    await addTx(page, { amount: '12,5', category: 'Еда' });
    await goSection(page, 'Настройки');
    for (const title of [
      'Аккаунт', 'Синхронизация', 'Проверка облака', 'Валюта учёта', 'Курсы валют', 'Резервная копия', 'Проверка данных', 'Хранилище', 'О приложении',
    ]) {
      await expect(page.getByRole('region', { name: title }), `раздел «${title}»`).toBeVisible();
    }

    // Проверка облака: локальный режим объяснён, кнопки «Проверить» нет — нечего изображать
    const cloud = page.getByRole('region', { name: 'Проверка облака' });
    await expect(cloud).toContainText('Облако пока не подключено, поэтому проверять нечего');
    await expect(cloud.getByRole('button', { name: 'Проверить' })).toHaveCount(0);
    await expect(cloud.getByRole('link', { name: /README/ })).toBeVisible();

    // Синхронизация: честно «не подключено», а не «Синхронизировано»
    const sync = page.getByRole('region', { name: 'Синхронизация' });
    await expect(sync).toContainText('Облако не подключено');
    await expect(sync.getByText('Синхронизировано')).toHaveCount(0);
    await expect(sync.getByRole('button', { name: /Синхронизировать/ })).toHaveCount(0);

    // Курсы: в сети курсов нет, это сказано словами (а не пустой экран)
    const rates = page.getByRole('region', { name: 'Курсы валют' });
    await expect(rates.getByRole('button', { name: 'Обновить курсы' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'О приложении' })).toContainText('только на этом устройстве');

    // Проверка данных
    const check = page.getByRole('region', { name: 'Проверка данных' });
    await check.getByRole('button', { name: 'Проверить данные' }).click();
    await expect(check).toContainText('Проблем не найдено. Проверено 1 операция');
    await shot(page, '08-settings', testInfo);
  });

  test('«Обновить курсы» без доступа к источникам: понятная ошибка, приложение не ломается, остатки на месте', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '12,5', category: 'Еда' });
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Обновить курсы' }).click();
    // человек видит, что не получилось (тост или строка «Последняя попытка не удалась»), а не вечную крутилку
    await expect(page.getByText(/Не удалось обновить курсы/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить курсы' })).toBeEnabled();
    await goSection(page, 'Главная');
    await expect(page.getByTestId('home-total')).toContainText('12,50');
  });
});
