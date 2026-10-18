import { expect, test, type Page } from '@playwright/test';
import { DIST, startStatic, waitForSw, type StaticServer } from './helpers';

// Новые страницы этапа 2 открываются из precache без сети, без белого экрана и без ошибок в консоли.
let srv: StaticServer;
test.beforeAll(async () => {
  srv = await startStatic(DIST);
});
test.afterAll(async () => {
  await srv.close();
});
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(info.project.name !== 'desktop', 'один раз, на «desktop»');
});

const ready = async (page: Page) => page.getByRole('navigation').first().waitFor();

test('офлайн: /more, /budgets, /recurring, /debts, /import, /settings/categories открываются из precache; прямой заход по адресу тоже', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await ready(page);
  await waitForSw(page);
  await ready(page);
  await ctx.setOffline(true);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const [hash, title] of [
    ['#/more', 'Ещё'],
    ['#/budgets', 'Бюджеты'],
    ['#/recurring', 'Регулярные платежи'],
    ['#/debts', 'Долги'],
    ['#/import', 'Импорт из Дзен-мани'],
    ['#/settings/categories', 'Категории'],
    ['#/settings', 'Настройки'],
  ] as const) {
    await page.goto(`${srv.url}${hash}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const text = (await page.locator('body').innerText()).trim();
    expect(text.length, `белый экран на ${hash}`).toBeGreaterThan(20);
  }
  // и перезагрузка прямо на новой странице без сети
  await page.goto(`${srv.url}#/debts`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Долги' })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
