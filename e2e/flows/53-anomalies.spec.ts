import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('53. Аналитика → «Что бросается в глаза»', () => {
  test('крупная трата, новая статья и возможный дубль; «Скрыть» помнится после обновления; на 320 px без прокрутки вбок', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.install({ time: NOW });
    await openApp(page);
    // «Еда»: по 100 с мая по сентябрь — обычная трата 100; транспорт в двух месяцах — у человека есть история
    for (const date of ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']) await addTx(page, { amount: '100', category: 'Еда', date });
    await addTx(page, { amount: '50', category: 'Транспорт', date: '2026-08-12' });
    await addTx(page, { amount: '50', category: 'Транспорт', date: '2026-09-12' });
    // октябрь: банкет на 400 (рекорд), два одинаковых кофе в один день и «Продукты» на 3 000 (раньше их не было)
    await addTx(page, { amount: '400', category: 'Еда', note: 'банкет', date: '2026-10-12' });
    await addTx(page, { amount: '15', category: 'Еда', note: 'кофе', date: '2026-10-14' });
    await addTx(page, { amount: '15', category: 'Еда', note: 'кофе', date: '2026-10-14' });
    await addTx(page, { amount: '3000', category: 'Продукты', note: 'закупка', date: '2026-10-05' });
    await dismissToasts(page);

    await goSection(page, 'Аналитика');
    const card = page.getByTestId('anomalies-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('anomaly-big')).toContainText('Необычно крупная трата: банкет');
    await expect(page.getByTestId('anomaly-big')).toContainText(money('400 с.'));
    await expect(page.getByTestId('anomaly-new')).toContainText('Новая статья расходов: Продукты');
    await expect(page.getByTestId('anomaly-dup')).toContainText('Возможный дубль: кофе');
    await card.scrollIntoViewIfNeeded();
    await shot(page, '53-anomalies', testInfo);
    await noHorizontalScroll(page, 'Аналитика: что бросается в глаза');
    // кнопки в карточке не меньше 44 px
    for (const b of await card.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // тёмная тема
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(page, '53-anomalies-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // «Скрыть» убирает находку, обновление страницы её не возвращает
    await page.getByRole('button', { name: 'Скрыть: кофе' }).click();
    await expect(page.getByTestId('anomaly-dup')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('anomaly-big')).toBeVisible();
    await expect(page.getByTestId('anomaly-dup')).toHaveCount(0);

    // «Открыть трату» — правка этой траты поверх экрана
    await page.getByTestId('anomaly-big').getByRole('link', { name: 'Открыть трату' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Правка операции');
    await expect(page.getByRole('dialog')).toContainText('12 окт');
  });
});
