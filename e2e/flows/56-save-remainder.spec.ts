import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, money, openApp, sheet, shot, test } from '../helpers';

/** «Сегодня» закреплено: 3 октября 2026 (первые дни месяца). */
const NOW = new Date('2026-10-03T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('56. Отложить остаток', () => {
  test('прошлый месяц с остатком → карточка на «Главной» → готовый перевод на накопление; «Не сейчас» помнится; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    // сентябрь: доход 5 000, расход 3 800 — осталось 1 200 (лежат в «Наличных»)
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-09-05' });
    await addTx(page, { amount: '3800', category: 'Еда', date: '2026-09-20' });
    await dismissToasts(page);
    // накопление «Отпуск»
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const wallet = sheet(page, 'Новый кошелёк');
    await wallet.getByRole('textbox', { name: 'Название' }).fill('Отпуск');
    await wallet.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
    await wallet.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(wallet).toBeHidden();
    await dismissToasts(page);

    await goSection(page, 'Главная');
    const card = page.getByTestId('save-remainder');
    await expect(card).toBeVisible();
    await expect(card).toContainText('За сентябрь 2026 осталось');
    await expect(card).toContainText(money('1 200 с.'));
    await expect(card).toContainText('в «Отпуск»');
    await card.scrollIntoViewIfNeeded();
    await shot(page, '56-save-remainder', testInfo);
    await noHorizontalScroll(page, 'Главная: отложить остаток');
    for (const b of await card.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // «Отложить»: форма «Новая операция» — перевод, сумма 1 200 уже стоит
    await card.getByRole('link', { name: 'Отложить' }).click();
    const add = sheet(page, 'Новая операция');
    await expect(add).toBeVisible();
    await expect(add.getByRole('radio', { name: 'Перевод', checked: true })).toBeVisible();
    await expect(add).toContainText(/1\s200\s*с\./);
    await add.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(add).toBeHidden();
    // отложили — предложения больше нет
    await expect(page.getByTestId('save-remainder')).toHaveCount(0);
  });

  test('«Не сейчас» убирает карточку и обновление страницы её не возвращает', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-09-05' });
    await addTx(page, { amount: '3800', category: 'Еда', date: '2026-09-20' });
    await createWallet(page, { name: 'Копилка' });
    await dismissToasts(page);
    // «Копилка» создана обычным кошельком: накоплением её делаем в правке
    await page.getByRole('button', { name: 'Изменить: Копилка' }).click();
    const edit = sheet(page, 'Правка кошелька');
    await edit.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);

    await goSection(page, 'Главная');
    await expect(page.getByTestId('save-remainder')).toBeVisible();
    await page.getByRole('button', { name: 'Не откладывать в этом месяце' }).click();
    await expect(page.getByTestId('save-remainder')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
    await expect(page.getByTestId('save-remainder')).toHaveCount(0);
  });
});
