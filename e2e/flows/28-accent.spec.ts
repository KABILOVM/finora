import type { Page } from '@playwright/test';
import { expect, goSection, openApp, shot, test } from '../helpers';

/** Значение CSS-переменной страницы: «R G B». */
const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** «3 13 4» → «#030d04» (так записан цвет строки состояния браузера). */
const hex = (triple: string): string => `#${triple.split(' ').map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;

const statusBar = (page: Page): Promise<(string | null)[]> =>
  page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')));

/** Начало градиента знака «$»: вычисленный браузером stop-color и переменная акцента, из которой он берётся. */
const logoFrom = (page: Page): Promise<{ stop: string | null; variable: string }> =>
  page.evaluate(() => {
    const stop = document.querySelector('svg stop.logo-from');
    return { stop: stop ? getComputedStyle(stop).stopColor : null, variable: getComputedStyle(document.documentElement).getPropertyValue('--ac-logo-from').trim() };
  });
/** «106 108 255» → «rgb(106, 108, 255)» (так браузер записывает вычисленный цвет). */
const asRgb = (triple: string): string => `rgb(${triple.split(' ').join(', ')})`;
/**
 * Цвет знака «$» после того, как он дорисовался: Chromium обновляет stop-color внутри <defs> на следующем кадре,
 * поэтому мгновенное чтение после смены акцента отстаёт, а ожидание — нет. Возвращает цвет в виде «rgb(r, g, b)».
 */
async function settledLogo(page: Page): Promise<string> {
  const want = asRgb((await logoFrom(page)).variable);
  await expect.poll(async () => (await logoFrom(page)).stop, { message: 'знак «$» не перекрасился вслед за акцентом' }).toBe(want);
  return want;
}

const appearance = (page: Page) => page.getByRole('region', { name: 'Оформление' });
const colors = (page: Page) => appearance(page).getByRole('radiogroup', { name: 'Цвет акцента' });

test.describe('28. Цвет акцента', () => {
  test('«Настройки» → «Оформление»: выбор перекрашивает приложение, переживает перезагрузку, фиолетовый возвращает прежнее', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');

    // 26 готовых цветов и «Свой цвет»
    await expect(colors(page).getByRole('radio')).toHaveCount(27);
    await expect(colors(page).getByRole('radio', { name: 'Фиолетовый' })).toBeChecked();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /.+/);
    const violetBrand = await token(page, '--brand');
    const violetBg = await token(page, '--bg');
    const violetLogo = await settledLogo(page);
    expect(violetLogo, 'знак по умолчанию — прежний фиолетовый').toBe('rgb(106, 108, 255)');

    await colors(page).getByRole('radio', { name: 'Зелёный' }).click();
    await expect(colors(page).getByRole('radio', { name: 'Зелёный' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    const greenBrand = await token(page, '--brand');
    expect(greenBrand).not.toBe(violetBrand);
    expect(await token(page, '--bg')).not.toBe(violetBg); // фон страницы тоже подкрашен, не только кнопки
    const greenLogo = await settledLogo(page); // и взял цвет из палитры акцента, а не остался прежним
    expect(greenLogo, 'знак перекрасился вместе с акцентом').not.toBe(violetLogo);
    await shot(page, '28-accent-green', testInfo);

    // выбор хранится на устройстве: после перезагрузки тот же
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    expect(await token(page, '--brand')).toBe(greenBrand);
    expect(await settledLogo(page)).toBe(greenLogo); // знак после перезагрузки тоже зелёный
    await expect(colors(page).getByRole('radio', { name: 'Зелёный' })).toBeChecked();

    // «Фиолетовый» — прежняя палитра, атрибута нет
    await colors(page).getByRole('radio', { name: 'Фиолетовый' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /.+/);
    expect(await token(page, '--brand')).toBe(violetBrand);
    expect(await token(page, '--bg')).toBe(violetBg);
    expect(await settledLogo(page)).toBe(violetLogo);
  });

  test('в тёмной теме акцент тоже работает, а цвет строки состояния браузера совпадает с фоном страницы', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await appearance(page).getByRole('radio', { name: 'Тёмная', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const violetBrand = await token(page, '--brand');

    for (const label of ['Бирюзовый', 'Оранжевый', 'Красный', 'Розовый']) {
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

  test('«Свой цвет»: код цвета перекрашивает приложение, переживает перезагрузку, готовый цвет возвращает обычную палитру', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    const violetBrand = await token(page, '--brand');

    await colors(page).getByRole('radio', { name: 'Свой цвет' }).click();
    await expect(colors(page).getByRole('radio', { name: 'Свой цвет' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'custom');
    const code = appearance(page).getByRole('textbox', { name: 'Код цвета' });
    await code.fill('#0a8f4a');
    await expect.poll(() => token(page, '--ac-brand-l')).not.toBe('');
    const customBrand = await token(page, '--brand');
    expect(customBrand).not.toBe(violetBrand);
    const bar = hex(await token(page, '--bg'));
    expect(await statusBar(page)).toEqual([bar, bar]);
    await shot(page, '28-accent-custom', testInfo);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'custom');
    expect(await token(page, '--brand')).toBe(customBrand);
    await expect(colors(page).getByRole('radio', { name: 'Свой цвет' })).toBeChecked();

    await colors(page).getByRole('radio', { name: 'Изумрудный' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'emerald');
    expect(await token(page, '--ac-brand-l')).not.toBe(''); // палитру теперь даёт блок index.css, а не <html>
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ac-brand-l'))).toBe('');
  });
});
