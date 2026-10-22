import type { Page } from '@playwright/test';
import { addTx, confirmDiscard, dismissToasts, expect, fillTx, goSection, money, openApp, saveNewTx, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('61. Шаблоны операций', () => {
  test('«Сохранить как шаблон» в форме → строка на «Главной» → внесение в один тап → «Шаблоны операций»: переименовать, удалить, отменить; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);

    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата', date: '2026-10-01' });
    await dismissToasts(page);

    // форма: сумма, категория, заметка → «Сохранить как шаблон» (Enter подтверждает название) → форма остаётся открытой
    const dlg = await fillTx(page, { amount: '45', category: 'Еда', note: 'обед в столовой' });
    await dlg.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Название шаблона' });
    await expect(ask.getByRole('textbox', { name: 'Название' })).toHaveValue('обед в столовой');
    await ask.getByRole('textbox', { name: 'Название' }).fill('Обед');
    await ask.getByRole('textbox', { name: 'Название' }).press('Enter');
    await expect(ask).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Шаблон «Обед» сохранён' })).toBeVisible();
    await expect(dlg).toBeVisible();
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // «Главная»: строка шаблонов
    await goSection(page, 'Главная');
    const row = page.getByTestId('home-templates');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('home-template')).toHaveCount(1);
    await expect(row).toContainText('Обед');
    await expect(row).toContainText(money('45 с.'));
    await shot(page, '61-templates-home', testInfo);
    await noHorizontalScroll(page, 'Главная с шаблонами');

    // один тап: форма открыта с готовыми полями; «Сохранить» вносит вторую такую же операцию
    await row.getByTestId('home-template').click();
    const add = page.getByRole('dialog', { name: 'Новая операция' });
    await expect(add).toBeVisible();
    await expect(add.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/45/);
    await saveNewTx(add);
    await expect(add).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /обед в столовой/ })).toHaveCount(2);

    // в панели категорий формы шаблон стоит первым
    const form = await fillTx(page, { amount: '10' });
    await form.getByRole('button', { name: /^Категория:/ }).click();
    const strip = form.getByRole('group', { name: 'Шаблоны и частые операции' });
    await expect(strip.getByRole('button').first()).toContainText('Обед');
    await shot(page, '61-templates-panel', testInfo);
    await page.keyboard.press('Escape'); // первый Esc закрывает панель категорий, второй — саму форму (с вопросом о несохранённом)
    await page.keyboard.press('Escape');
    await confirmDiscard(page);
    await expect(form).toBeHidden();

    // «Настройки» → «Шаблоны операций»
    await goSection(page, 'Настройки');
    await page.getByRole('link', { name: 'Шаблоны операций' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Шаблоны операций' })).toBeVisible();
    const item = page.getByTestId('template-row');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Расход · Еда · Наличные');
    await shot(page, '61-templates-page', testInfo);
    await noHorizontalScroll(page, 'Шаблоны операций');
    for (const b of await page.getByRole('main').getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0, 'кнопка не ниже 44 px').toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '61-templates-page-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    await page.getByRole('button', { name: 'Переименовать: Обед' }).click();
    const rename = page.getByRole('alertdialog', { name: 'Название шаблона' }).getByRole('textbox', { name: 'Название' });
    await rename.fill('Обед дома');
    await rename.press('Enter');
    await expect(item).toContainText('Обед дома');

    await page.getByRole('button', { name: 'Удалить: Обед дома' }).click();
    await expect(page.getByRole('heading', { name: 'Шаблонов пока нет' })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(item).toContainText('Обед дома');

    // шаблоны переживают перезагрузку страницы
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Шаблоны операций' })).toBeVisible();
    await expect(page.getByTestId('template-row')).toContainText('Обед дома');
  });
});
