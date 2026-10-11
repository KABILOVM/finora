import {
  activateServiceWorker, addTx, expect, goSection, homeTotalText, money, norm, openApp, shot, test, waitReady,
} from '../helpers';

test.describe('2. Офлайн', () => {
  test('приложение открывается и работает без сети; данные переживают перезагрузку; сеть вернулась — всё цело; прямой заход на #/transactions офлайн', async ({
    page,
    context,
    errors,
  }, testInfo) => {
    await openApp(page);
    await activateServiceWorker(page);

    // 1) Без сети: перезагрузка — приложение открывается
    await context.setOffline(true);
    await page.reload();
    await waitReady(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
    await expect(page.getByRole('status').filter({ hasText: 'Офлайн' })).toBeVisible();
    await shot(page, '02-offline-home', testInfo);

    // 2) Внести расход офлайн
    await addTx(page, { amount: '12,5', category: 'Еда', note: 'офлайн-хлеб' });
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('−12,50 с.'));

    // 3) Перезагрузка офлайн: данные на месте
    await page.reload();
    await waitReady(page);
    expect(await homeTotalText(page)).toMatch(money('−12,50 с.'));
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(1);
    await expect(page.getByText('офлайн-хлеб')).toBeVisible();

    // 4) Сеть вернулась: ничего не ломается, плашка «Офлайн» уходит, можно вносить дальше
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Офлайн' })).toHaveCount(0);
    await addTx(page, { amount: '7,5', category: 'Транспорт' });
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('−20 с.'));
    await page.reload();
    await waitReady(page);
    expect(await homeTotalText(page)).toMatch(money('−20 с.'));

    // 5) Прямой заход на #/transactions офлайн в новой странице того же контекста
    await context.setOffline(true);
    const page2 = await context.newPage();
    errors.watch(page2);
    await page2.goto('/#/transactions');
    await waitReady(page2);
    await expect(page2.getByRole('heading', { level: 1, name: 'Операции' })).toBeVisible();
    await expect(page2.getByRole('button', { name: /Еда/ })).toHaveCount(1);
    await expect(page2.getByRole('button', { name: /Транспорт/ })).toHaveCount(1);
    expect(norm(await page2.locator('main').innerText())).toContain('−20 с.');
    await shot(page2, '02-offline-direct-transactions', testInfo);

    // и корневой адрес без хэша тоже открывается из кэша
    await page2.goto('/');
    await waitReady(page2);
    await context.setOffline(false);
    await page2.close();
  });
});
