import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASES } from '../../src/features/whatsnew/releases';
import { addTx, dismissToasts, expect, goSection, modalHistorySettled, openApp, shot, sheet, test } from '../helpers';

const NEWS = (page: Page) => sheet(page, 'Что нового');
/** Запись одной версии внутри окна. */
const RELEASE = (page: Page, version: string) => NEWS(page).getByRole('region', { name: `Версия ${version}`, exact: true });

/** Версия приложения: сборка берёт её оттуда же, из package.json (WhatsNew.tsx). */
const VERSION = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;

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
    // Окно показывает запись ТЕКУЩЕЙ версии, а она меняется с каждым выпуском: что ждать в окне, берём из releases.ts
    // (новые записи сверху), а не пишем сюда текстом.
    const [current, previous] = RELEASES;
    if (!current) throw new Error('releases.ts пуст: окну «Что нового» нечего показывать');
    expect(current.version, 'верхняя запись releases.ts — про версию из package.json').toBe(VERSION);

    await openApp(page);
    await expect(NEWS(page)).toHaveCount(0);
    // версия запомнилась молча
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('finora:whatsnew:')).length)).toBe(1);

    await addTx(page, { amount: '25', category: 'Еда' });
    await dismissToasts(page);
    // обновились с предыдущей версии (запись в списке одна — с версии, которой в нём нет): показывается запись текущей, и только она
    await pretendUpdated(page, previous?.version ?? '0.0.0');
    await page.reload();

    const news = NEWS(page);
    await expect(news).toBeVisible({ timeout: 10_000 });
    await expect(news.getByRole('region', { name: /^Версия / })).toHaveCount(1);
    for (const item of current.items) await expect(RELEASE(page, VERSION)).toContainText(item.text);
    await shot(page, '36-whats-new', testInfo);
    const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(o.scroll, 'страница шире экрана').toBeLessThanOrEqual(o.client);
    await news.getByRole('button', { name: 'Понятно' }).click();
    await expect(news).toBeHidden();

    // при следующем запуске окна нет
    await modalHistorySettled(page); // окно ещё снимает свою запись истории: перезагрузка в этот момент прервалась бы
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
