import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, fillTx, goSection, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('57. Проверка данных', () => {
  test('из «Настроек»: дубль, операция без категории, дата в будущем; «Удалить лишнюю», «Это нормально», «Отменить»; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);

    // пока ничего нет — «Проблем не найдено»
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Проверка данных' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Проверка данных' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Проблем не найдено' })).toBeVisible();

    // деньги на кошельке есть, чтобы остаток не ушёл в минус; два одинаковых кофе, расход без категории и операция в 2062 году (опечатка в годе)
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата', date: '2026-10-01' });
    await addTx(page, { amount: '15', category: 'Еда', note: 'кофе', date: '2026-10-10' });
    await addTx(page, { amount: '15', category: 'Еда', note: 'кофе', date: '2026-10-10' });
    await addTx(page, { amount: '5', note: 'киоск', date: '2026-10-12' });
    // дата в будущем форма спрашивает отдельно: «Дата в будущем… Сохранить?»
    const future = await fillTx(page, { amount: '7', category: 'Еда', note: 'опечатка в годе', date: '2062-10-15' });
    await future.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Дата в будущем' }).getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(future).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Проверка данных' }).click();

    await expect(page.getByTestId('datacheck-summary')).toContainText('Найдено: 3 пункта');
    await expect(page.getByTestId('check-dupes')).toContainText('кофе');
    await expect(page.getByTestId('check-uncategorized')).toContainText('киоск');
    await expect(page.getByTestId('check-future')).toContainText('опечатка в годе');
    await shot(page, '57-data-check', testInfo);
    await noHorizontalScroll(page, 'Проверка данных');
    for (const b of await page.getByRole('main').getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0, 'кнопка не ниже 44 px').toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '57-data-check-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // «Удалить лишнюю»: дубль пропал, «Отменить» возвращает
    await page.getByRole('button', { name: 'Удалить лишнюю: кофе' }).click();
    await expect(page.getByTestId('check-dupes')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('check-dupes')).toBeVisible();

    // «Это нормально» — до обновления страницы и после него
    await page.getByRole('button', { name: 'Это нормально: опечатка в годе' }).click();
    await expect(page.getByTestId('check-future')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Проверка данных' })).toBeVisible();
    await expect(page.getByTestId('check-dupes')).toBeVisible();
    await expect(page.getByTestId('check-future')).toHaveCount(0);

    // «Выбрать категорию» открывает правку операции
    await page.getByRole('link', { name: 'Выбрать категорию' }).click();
    await expect(page.getByRole('dialog')).toContainText('Правка операции');
  });
});
