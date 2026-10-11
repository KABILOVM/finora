import type { Page } from '@playwright/test';
import { expect, goSection, isPhone, mainNav, openApp, openFromMore, shot, test } from '../helpers';

/** Разделы за пунктом «Ещё»: (название в списке, заголовок страницы, адрес). */
const MORE: ReadonlyArray<readonly [string, string, string]> = [
  ['Бюджеты', 'Бюджеты', '#/budgets'],
  ['Регулярные платежи', 'Регулярные платежи', '#/recurring'],
  ['Долги и кредиты', 'Долги и кредиты', '#/debts'],
  ['Настройки', 'Настройки', '#/settings'],
];

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const hashOf = (page: Page) => new URL(page.url()).hash;

/** Подсвеченные пункты основной навигации (видимой на этом экране). */
const lit = async (page: Page): Promise<string[]> => {
  const links = mainNav(page).locator('a[aria-current="page"]');
  return (await links.allInnerTexts()).map((t) => t.trim());
};

test.describe('15. Меню «Ещё»', () => {
  test('«Ещё» (телефон) открывает страницу «Ещё» со всеми разделами', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'на ПК пункта «Ещё» нет: всё в боковой панели');
    await openApp(page);
    await goSection(page, 'Ещё');
    expect(hashOf(page)).toBe('#/more');
    const main = page.getByRole('main');
    await expect(main.getByRole('link')).toHaveCount(MORE.length);
    for (const [name] of MORE) await expect(main.getByRole('link', { name, exact: true })).toBeVisible();
    await shot(page, '15-more', testInfo);
  });

  for (const [name, title, hash] of MORE) {
    test(`из «Ещё» → «${name}»: страница открывается, «Ещё» остаётся подсвеченным`, async ({ page }) => {
      await openApp(page, '/more');
      await page.getByRole('main').getByRole('link', { name, exact: true }).click();
      await expect(h1(page, title)).toBeVisible();
      expect(hashOf(page)).toBe(hash);
      if (isPhone(page)) expect(await lit(page)).toEqual(['Ещё']);
      else expect(await lit(page)).toHaveLength(1);
      await expect(page.getByText('Загрузка…')).toHaveCount(0);
    });
  }

  test('заглушки новых разделов: «Скоро», каркас на месте, без ошибок', async ({ page }, testInfo) => {
    for (const [hash, title] of [
      ['/budgets', 'Бюджеты'],
      ['/recurring', 'Регулярные платежи'],
      ['/debts', 'Долги и кредиты'],
      ['/import', 'Импорт из Zenmoney'],
    ] as const) {
      await openApp(page, hash);
      await expect(h1(page, title)).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Скоро' })).toBeVisible();
      await expect(mainNav(page)).toBeVisible();
      if (hash === '/budgets') await shot(page, '15-budgets-stub', testInfo);
    }
  });

  test('телефон: на всех разделах из «Ещё» подсвечен «Ещё»; на «Главной» нет', async ({ page }) => {
    test.skip(!isPhone(page), 'нижняя панель только на телефоне');
    for (const hash of ['/more', '/budgets', '/recurring', '/debts', '/import', '/settings', '/settings/categories']) {
      await openApp(page, hash);
      expect(await lit(page), hash).toEqual(['Ещё']);
    }
    await openApp(page, '/');
    expect(await lit(page)).toEqual(['Главная']);
  });

  test('ПК: основные пункты в боковой панели ведут на свои разделы, подсвечен один пункт', async ({ page }, testInfo) => {
    test.skip(isPhone(page), 'боковая панель только на ПК');
    await openApp(page);
    for (const [name, title, hash] of [
      ['Бюджеты', 'Бюджеты', '#/budgets'],
      ['Платежи', 'Регулярные платежи', '#/recurring'],
      ['Долги', 'Долги и кредиты', '#/debts'],
      ['Настройки', 'Настройки', '#/settings'],
    ] as const) {
      await mainNav(page).getByRole('link', { name, exact: true }).click();
      await expect(h1(page, title)).toBeVisible();
      expect(hashOf(page)).toBe(hash);
      expect(await lit(page)).toEqual([name]);
    }
    await shot(page, '15-side-nav', testInfo);
  });

  test('кривые адреса: не белый экран, каркас остаётся (или уводит на «Главную»)', async ({ page }) => {
    for (const hash of ['/more/x', '/budgets/%', '/debts/%E0%A4%A', '/import//', '/more%0a', '/recurring/..%2F..%2Fsettings', '/нет-такой']) {
      await page.goto(`/#${hash}`);
      await expect(mainNav(page).first()).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const text = (await page.locator('body').innerText()).trim();
      expect(text.length, `белый экран на #${hash}`).toBeGreaterThan(10);
    }
  });

  test('ПК: пункта «Ещё» в боковой панели нет, категории и импорт — внутри «Настроек»', async ({ page }) => {
    test.skip(isPhone(page), 'боковая панель только на ПК');
    await openApp(page);
    await expect(mainNav(page).getByRole('link', { name: 'Ещё' })).toHaveCount(0);
    await goSection(page, 'Настройки');
    await page.getByRole('main').getByRole('link', { name: 'Категории', exact: true }).click();
    await expect(h1(page, 'Категории')).toBeVisible();
    expect(await lit(page)).toEqual(['Настройки']);
    await goSection(page, 'Настройки');
    await page.getByRole('main').getByRole('link', { name: 'Импорт из Zenmoney', exact: true }).click();
    await expect(h1(page, 'Импорт из Zenmoney')).toBeVisible();
    expect(await lit(page)).toEqual(['Настройки']);
  });

  test('кнопка «Назад» из раздела возвращает на «Ещё»', async ({ page }) => {
    test.skip(!isPhone(page), '«Ещё» только на телефоне');
    await openApp(page);
    await openFromMore(page, 'Бюджеты');
    await expect(h1(page, 'Бюджеты')).toBeVisible();
    await page.goBack();
    await expect(h1(page, 'Ещё')).toBeVisible();
  });
});
