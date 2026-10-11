import { readFileSync } from 'node:fs';
import {
  addTx, createWallet, dismissToasts, expect, freshContext, goSection, homeWallet, money, norm, openApp, sheet, test, walletRowText,
} from '../helpers';
import type { Page } from '@playwright/test';

/** Что видит человек: названия кошельков с остатками (экран «Кошельки») и число строк в «Операциях» за всё время. */
async function snapshotOf(page: Page) {
  await goSection(page, 'Кошельки');
  const wallets = (await page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Сверка:/ }) }).allInnerTexts()).map((t) =>
    norm(t).replace(/\s*Сверка\s*$/, ''),
  );
  await goSection(page, 'Операции');
  await page.getByRole('button', { name: 'Всё время' }).click();
  const rows = await page.getByRole('region').getByRole('button').allInnerTexts();
  return { wallets: wallets.sort(), rows: rows.map(norm).sort() };
}

async function saveDownload(page: Page, button: string, path: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  await dl.saveAs(path);
  return dl.suggestedFilename();
}

test.describe('6. Резервная копия', () => {
  test('JSON: скачать и загрузить в чистом контексте — кошельки, операции и остатки те же; CSV — непустой UTF-8 с BOM', async ({
    page,
    browser,
    errors,
  }, testInfo) => {
    await openApp(page);
    await createWallet(page, { name: 'Карта', opening: '500' });
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '20' });
    await addTx(page, { kind: 'income', amount: '300', wallet: 'Наличные' });
    await addTx(page, { amount: '40,5', category: 'Еда', wallet: 'Наличные', note: 'хлеб' });
    await addTx(page, { amount: '5', category: 'Транспорт', wallet: 'Карта' });
    await addTx(page, { kind: 'transfer', amount: '100', wallet: 'Наличные', toWallet: 'Карта' });
    // Удалённая операция: в копию уходит как «удалена», но в списке после загрузки появиться не должна
    await addTx(page, { amount: '7', category: 'Связь', wallet: 'Наличные', note: 'удалённое' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /удалённое/ }).click();
    await sheet(page, 'Правка операции').getByRole('button', { name: 'Удалить операцию' }).click();
    await page.getByRole('alertdialog', { name: 'Удалить операцию?' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByRole('button', { name: /удалённое/ })).toHaveCount(0);
    await dismissToasts(page);

    const before = await snapshotOf(page);
    expect(before.wallets).toHaveLength(3);
    expect(before.rows).toHaveLength(4);
    expect(before.wallets.join('|')).toMatch(money('159,50 с.'));
    expect(before.wallets.join('|')).toMatch(money('595 с.'));
    expect(before.wallets.join('|')).toMatch(money('20 $'));

    // Скачать JSON
    await goSection(page, 'Настройки');
    const jsonPath = testInfo.outputPath('backup.json');
    const jsonName = await saveDownload(page, 'Скачать копию (JSON)', jsonPath);
    expect(jsonName).toMatch(/^finora-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(backup.format).toBe('finora-backup');
    expect(backup.wallets).toHaveLength(3);
    expect(backup.transactions.filter((t: { deletedAt: unknown }) => t.deletedAt === null)).toHaveLength(4);
    expect(backup.transactions).toHaveLength(5); // удалённая едет в копии тоже, помеченная удалённой

    // Скачать CSV
    const csvPath = testInfo.outputPath('ops.csv');
    const csvName = await saveDownload(page, 'Скачать операции (CSV)', csvPath);
    expect(csvName).toMatch(/^finora-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    const csvBytes = readFileSync(csvPath);
    expect(csvBytes.length).toBeGreaterThan(50);
    expect([...csvBytes.subarray(0, 3)], 'файл CSV должен начинаться с BOM (EF BB BF) — иначе Excel покажет кракозябры').toEqual([0xef, 0xbb, 0xbf]);
    const csv = csvBytes.toString('utf8').replace(/^﻿/, '');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Дата;Вид;Кошелёк');
    expect(lines).toHaveLength(1 + 4); // заголовок + 4 живые операции (удалённая не попала)
    expect(csv).toContain('40,50');
    expect(csv).not.toContain('удалённое');

    // Чистый контекст («новый телефон»): загрузить файл
    // Файл отдаём буфером: так не зависим от того, как называется папка с результатами теста
    const file = { name: jsonName, mimeType: 'application/json', buffer: readFileSync(jsonPath) };
    const ctx2 = await freshContext(browser, testInfo);
    try {
      const page2 = await ctx2.newPage();
      errors.watch(page2); // ошибки новой страницы тоже проверяются
      await openApp(page2);
      await expect(homeWallet(page2, 'Наличные')).toBeVisible(); // первый запуск закончен: стартовые данные созданы
      await goSection(page2, 'Настройки');
      await page2.getByLabel('Файл копии').setInputFiles(file);
      const confirm = page2.getByRole('alertdialog', { name: 'Загрузить копию?' });
      await expect(confirm, 'диалог загрузки копии').toBeVisible();
      await confirm.getByRole('button', { name: 'Загрузить', exact: true }).click();
      await expect(page2.getByText('Копия загружена')).toBeVisible();

      const after = await snapshotOf(page2);
      expect(after.wallets, 'кошельки и остатки после загрузки').toEqual(before.wallets);
      expect(after.rows, 'операции после загрузки').toEqual(before.rows);
      await page2.reload();
      await goSection(page2, 'Операции');
      await page2.getByRole('button', { name: 'Всё время' }).click();
      expect(await page2.getByRole('region').getByRole('button').count()).toBe(4);
      await goSection(page2, 'Кошельки');
      expect(await walletRowText(page2, 'Карта')).toMatch(money('595 с.'));

      // Повторная загрузка того же файла ничего не задваивает
      await goSection(page2, 'Настройки');
      await page2.getByLabel('Файл копии').setInputFiles(file);
      await page2.getByRole('alertdialog', { name: 'Загрузить копию?' }).getByRole('button', { name: 'Загрузить', exact: true }).click();
      await expect(page2.getByText('Копия загружена')).toBeVisible();
      const again = await snapshotOf(page2);
      expect(again).toEqual(after);
    } finally {
      await ctx2.close();
    }
  });
});
