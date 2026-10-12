import type { Page } from '@playwright/test';
import { expect, goSection, openApp, shot, test } from '../helpers';

/** Значение CSS-переменной страницы: «R G B». */
const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** «3 13 4» → «#030d04» (так записан цвет строки состояния браузера). */
const hex = (triple: string): string => `#${triple.split(' ').map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;

const statusBar = (page: Page): Promise<(string | null)[]> =>
  page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')));

const appearance = (page: Page) => page.getByRole('region', { name: 'Оформление' });
const colors = (page: Page) => appearance(page).getByRole('radiogroup', { name: 'Цвет акцента' });

test.describe('28. Цвет акцента', () => {
  test('«Настройки» → «Оформление»: выбор перекрашивает приложение, переживает перезагрузку, фиолетовый возвращает прежнее', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');

    await expect(colors(page).getByRole('radio')).toHaveCount(6);
    await expect(colors(page).getByRole('radio', { name: 'Фиолетовый' })).toBeChecked();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /.+/);
    const violetBrand = await token(page, '--brand');
    const violetBg = await token(page, '--bg');

    await colors(page).getByRole('radio', { name: 'Зелёный' }).click();
    await expect(colors(page).getByRole('radio', { name: 'Зелёный' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    const greenBrand = await token(page, '--brand');
    expect(greenBrand).not.toBe(violetBrand);
    expect(await token(page, '--bg')).not.toBe(violetBg); // фон страницы тоже подкрашен, не только кнопки
    await shot(page, '28-accent-green', testInfo);

    // выбор хранится на устройстве: после перезагрузки тот же
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    expect(await token(page, '--brand')).toBe(greenBrand);
    await expect(colors(page).getByRole('radio', { name: 'Зелёный' })).toBeChecked();

    // «Фиолетовый» — прежняя палитра, атрибута нет
    await colors(page).getByRole('radio', { name: 'Фиолетовый' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /.+/);
    expect(await token(page, '--brand')).toBe(violetBrand);
    expect(await token(page, '--bg')).toBe(violetBg);
  });

  test('в тёмной теме акцент тоже работает, а цвет строки состояния браузера совпадает с фоном страницы', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await appearance(page).getByRole('radio', { name: 'Тёмная', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const violetBrand = await token(page, '--brand');

    for (const label of ['Бирюзовый', 'Оранжевый', 'Розовый']) {
      await colors(page).getByRole('radio', { name: label }).click();
      await expect(colors(page).getByRole('radio', { name: label })).toBeChecked();
      expect(await token(page, '--brand'), label).not.toBe(violetBrand);
      const bar = hex(await token(page, '--bg'));
      expect(await statusBar(page), label).toEqual([bar, bar]);
    }
    await shot(page, '28-accent-dark', testInfo);
  });

  test('цвет акцента не трогает данные и тему: выбранная тёмная тема остаётся, после перезагрузки обе настройки на месте', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await appearance(page).getByRole('radio', { name: 'Тёмная', exact: true }).click();
    await colors(page).getByRole('radio', { name: 'Синий' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
    await expect(appearance(page).getByRole('radio', { name: 'Тёмная', exact: true })).toBeChecked();
    await expect(colors(page).getByRole('radio', { name: 'Синий' })).toBeChecked();
  });
});
