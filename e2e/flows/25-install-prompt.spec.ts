import { expect, isPhone, shot, test, waitReady } from '../helpers';

/* ---------------------------------------------------------------------------------------------
 * 25. Окно «Установить Finora на экран телефона».
 * iphone: через ~1,5 с после входа поверх «Главной» окно с шагами iOS; «Не сейчас» закрывает на 7 дней.
 * desktop: окно не показываем никогда. В эмуляции Chromium событие beforeinstallprompt не приходит,
 * поэтому Android-кнопка «Установить» проверена компонентным тестом, а здесь — вариант Safari на iPhone.
 * ------------------------------------------------------------------------------------------- */

const TITLE = 'Установить Finora на экран телефона';

test('телефон: окно с шагами iOS появляется само, «Не сейчас» закрывает, после перезагрузки не возвращается', async ({ page }, testInfo) => {
  test.skip(!isPhone(page), 'сценарий для телефона');
  await page.goto('/#/');
  await waitReady(page);
  const dlg = page.getByRole('dialog', { name: TITLE });
  await expect(dlg).toBeVisible({ timeout: 6000 });

  const steps = dlg.getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Поделиться');
  await expect(steps.nth(1)).toContainText('На экран Домой');
  await expect(steps.nth(2)).toContainText('Добавить');
  await expect(dlg).toContainText('уведомления');
  await expect(dlg).toContainText('Face ID');
  await shot(page, 'install-prompt', testInfo);

  // кнопки не меньше 44px, окно в пределах экрана
  const btn = dlg.getByRole('button', { name: 'Не сейчас' });
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);

  // маленькая подсказка на «Главной» в это время не дублирует окно
  await expect(page.getByRole('note').filter({ hasText: 'Установка:' })).toHaveCount(0);

  await btn.click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('note').filter({ hasText: 'Установка:' })).toHaveCount(1); // запасная подсказка вернулась

  await page.reload();
  await waitReady(page);
  await page.waitForTimeout(2500);
  await expect(page.getByRole('dialog', { name: TITLE })).toHaveCount(0);
});

test('телефон: Esc закрывает окно', async ({ page }) => {
  test.skip(!isPhone(page), 'сценарий для телефона');
  await page.goto('/#/');
  await waitReady(page);
  const dlg = page.getByRole('dialog', { name: TITLE });
  await expect(dlg).toBeVisible({ timeout: 6000 });
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('ПК: окно не показывается', async ({ page }) => {
  test.skip(isPhone(page), 'сценарий для ПК');
  await page.goto('/#/');
  await waitReady(page);
  await page.waitForTimeout(3000);
  await expect(page.getByRole('dialog', { name: TITLE })).toHaveCount(0);
});
