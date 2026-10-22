import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, openApp, shot, test } from '../helpers';

const BUTTON = 'Выгрузить список в CSV';

/** Нажимает «Выгрузить список в CSV», сохраняет файл и возвращает его имя и строки данных (без заголовка). */
async function exportList(page: Page, path: string): Promise<{ name: string; bytes: Buffer; lines: string[] }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: BUTTON }).click()]);
  await dl.saveAs(path);
  const bytes = readFileSync(path);
  const lines = bytes.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  return { name: dl.suggestedFilename(), bytes, lines };
}

test.describe('51. Выгрузка списка операций в CSV', () => {
  test('в файл идёт то, что в списке: весь месяц, затем только найденное поиском; BOM на месте; на 320 px кнопка в шапке', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);

    // пока операций нет, кнопки нет
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: BUTTON })).toHaveCount(0);

    await addTx(page, { amount: '10', category: 'Еда', note: 'обед' });
    await dismissToasts(page);
    await addTx(page, { amount: '5', category: 'Транспорт', note: 'такси' });
    await dismissToasts(page);
    await addTx(page, { kind: 'income', amount: '100', category: 'Зарплата', note: 'аванс' });
    await dismissToasts(page);
    await goSection(page, 'Операции');

    const button = page.getByRole('button', { name: BUTTON });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(button).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, '51-export-list', testInfo);

    const all = await exportList(page, testInfo.outputPath('all.csv'));
    expect(all.name).toMatch(/^sumoima-operations-\d{4}-\d{2}-\d{2}\.csv$/);
    expect([...all.bytes.subarray(0, 3)], 'файл CSV должен начинаться с BOM (EF BB BF)').toEqual([0xef, 0xbb, 0xbf]);
    expect(all.lines).toHaveLength(3);
    await expect(page.getByRole('status').filter({ hasText: 'Выгружено 3 операции' })).toBeVisible();
    await dismissToasts(page);

    // поиск: выгружается только найденное
    await page.getByRole('searchbox', { name: 'Поиск по операциям' }).fill('такси');
    await expect(page.getByRole('region').getByRole('button')).toHaveCount(1);
    const found = await exportList(page, testInfo.outputPath('found.csv'));
    expect(found.lines).toHaveLength(1);
    expect(found.lines[0]).toContain('такси');
    expect(found.lines[0]).toContain('5,00');
  });
});
