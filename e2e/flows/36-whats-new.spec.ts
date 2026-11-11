import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RELEASES } from '../../src/features/whatsnew/releases';
import { addTx, dismissToasts, expect, goSection, openApp, shot, sheet, test } from '../helpers';

// Окно показывает запись текущей версии (package.json). Её текст берём из самого списка выпусков: сценарий не привязан к одному выпуску
// и не устаревает с каждым новым. Версия без записи окно не показывает — тогда сценарию нечего проверять, и это ошибка выпуска.
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const CURRENT = RELEASES.find((r) => r.version === VERSION);

const NEWS = (page: Page) => sheet(page, 'Что нового');

/** Притворяемся, что приложение обновилось: для этого человека «последняя просмотренная версия» — старая. */
async function pretendUpdated(page: Page, from: string): Promise<void> {
  await page.evaluate((v) => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('finora:whatsnew:'));
    if (keys.length === 0) throw new Error('нет отметки «Что нового»');
    for (const k of keys) localStorage.setItem(k, v);
  }, from);
}

test.describe('36. «Что нового» после обновления', () => {
  test('новому человеку окна нет; после «обновления» оно показывается один раз; в «Настройках» его можно открыть снова', async ({ page }, testInfo) => {
    await openApp(page);
    await expect(NEWS(page)).toHaveCount(0);
    // версия запомнилась молча
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('finora:whatsnew:')).length)).toBe(1);

    await addTx(page, { amount: '25', category: 'Еда' });
    await dismissToasts(page);
    expect(CURRENT, `в «Что нового» нет записи для версии ${VERSION} из package.json`).toBeDefined();
    await pretendUpdated(page, '0.5.0'); // предыдущая версия: показывается запись текущей
    await page.reload();

    const news = NEWS(page);
    await expect(news).toBeVisible({ timeout: 10_000 });
    await expect(news).toContainText(`Версия ${VERSION}`);
    for (const item of CURRENT!.items) await expect(news).toContainText(item.text);
    await shot(page, '36-whats-new', testInfo);
    const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(o.scroll, 'страница шире экрана').toBeLessThanOrEqual(o.client);
    await news.getByRole('button', { name: 'Понятно' }).click();
    await expect(news).toBeHidden();

    // при следующем запуске окна нет
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(NEWS(page)).toHaveCount(0);

    // «Настройки» → «Что нового»
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Что нового' }).click();
    await expect(NEWS(page)).toBeVisible();
    await NEWS(page).getByRole('button', { name: 'Понятно' }).click();
    await expect(NEWS(page)).toBeHidden();
  });
});
