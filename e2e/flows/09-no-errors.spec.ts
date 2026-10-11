import { addTx, createWallet, expect, goSection, openApp, test, waitReady } from '../helpers';

// Каждый тест в этом проекте дополнительно проверяется автоматически: pageerror и console.error (кроме сетевых сбоев) = провал.
test.describe('9. Нет ошибок в консоли', () => {
  test('обход всех экранов и шитов с данными: без pageerror и console.error', async ({ page }) => {
    await openApp(page);
    await createWallet(page, { name: 'Карта', opening: '300' });
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '5' });
    await addTx(page, { amount: '12,5', category: 'Еда', wallet: 'Наличные' });
    await addTx(page, { kind: 'income', amount: '100', wallet: 'Карта' });
    await addTx(page, { kind: 'transfer', amount: '10', wallet: 'Карта', toWallet: 'Наличные' });
    for (let i = 0; i < 3; i++) {
      for (const s of ['Главная', 'Операции', 'Кошельки', 'Настройки'] as const) await goSection(page, s);
    }
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Категории' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
  });

  test('особые адреса: прямой #/add, несуществующий маршрут, чужой #/edit/…, «назад» и Esc закрывают шит', async ({ page }) => {
    // прямой заход на «Новая операция»
    await page.goto('/#/add');
    await waitReady(page);
    const add = page.getByRole('dialog', { name: 'Новая операция' });
    await expect(add).toBeVisible();
    await add.getByRole('button', { name: 'Закрыть' }).click();
    await expect(add).toBeHidden();
    await expect(page).toHaveURL(/#\/$/);

    // несуществующий маршрут → «Главная»
    await page.goto('/#/нет-такой-страницы');
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();

    // правка несуществующей операции: понятное сообщение, шит закрыт, приложение живо
    await page.goto('/#/edit/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Операция не найдена')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/#/edit/%00%00');
    await waitReady(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // «+» → кнопка браузера «назад» закрывает шит и остаётся в приложении
    await page.goto('/#/transactions');
    await waitReady(page);
    await page.locator('a[href="#/add"]:visible').first().click();
    await expect(add).toBeVisible();
    await page.goBack();
    await expect(add).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Операции' })).toBeVisible();

    // Esc закрывает шит
    await page.locator('a[href="#/add"]:visible').first().click();
    await expect(add).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add).toBeHidden();
  });

  test('подсказка «Установка» закрывается и не возвращается после перезагрузки', async ({ page }) => {
    await openApp(page);
    const hint = page.getByRole('button', { name: 'Закрыть подсказку' });
    test.skip((await hint.count()) === 0, 'подсказки нет в этом окружении');
    await hint.click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await waitReady(page);
    await expect(page.getByRole('button', { name: 'Закрыть подсказку' })).toHaveCount(0);
  });
});
