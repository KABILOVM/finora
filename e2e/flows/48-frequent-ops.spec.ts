import type { Locator, Page } from '@playwright/test';
import { addLink, dismissToasts, expect, goSection, openApp, saveNewTx, shot, sheet, tapAmount, test } from '../helpers';

const rows = (page: Page) => page.getByRole('region').getByRole('button');

async function openNew(page: Page): Promise<Locator> {
  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Расход 15 в категории «Еда». */
async function addCoffee(page: Page) {
  const dlg = await openNew(page);
  await tapAmount(page, '15');
  await dlg.getByRole('button', { name: /^Категория:/ }).click();
  await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда', exact: true }).click();
  await saveNewTx(dlg);
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('48. Частые операции и «Повторить»', () => {
  test('после двух одинаковых расходов в панели категорий появляются «Частые»; нажатие подставляет всё; на 320 px вёрстка не страдает', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);

    // пока ничего не повторялось, полосы нет
    let dlg = await openNew(page);
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await expect(dlg.getByRole('group', { name: 'Категория' })).toBeVisible();
    await expect(dlg.getByRole('group', { name: 'Частые операции' })).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();

    await addCoffee(page);
    await addCoffee(page);

    dlg = await openNew(page);
    // верхняя строка формы не тронута: подписи видов помещаются, горизонтальной прокрутки нет
    const clipped = await dlg.getByRole('radio').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 10).length);
    expect(clipped, 'подписи «Расход / Доход / Перевод» помещаются').toBe(0);
    await expect(dlg.getByRole('button', { name: 'Частые операции' })).toHaveCount(0);

    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    const strip = dlg.getByRole('group', { name: 'Частые операции' });
    await expect(strip).toBeVisible();
    await expect(strip).toBeInViewport({ ratio: 1 });
    await expect(strip.getByRole('button')).toHaveCount(1);
    await expect(strip.getByRole('button').first()).toContainText('Еда');
    await expect(strip.getByRole('button').first()).toHaveAttribute('title', /2 раза/);
    const chip = await strip.getByRole('button').first().boundingBox();
    expect(chip?.height ?? 0).toBeGreaterThanOrEqual(44);
    // «Без категории» и сетка по-прежнему на виду, горизонтальной прокрутки нет
    await expect(dlg.getByRole('button', { name: 'Без категории', exact: true })).toBeInViewport();
    await expect(dlg.getByRole('group', { name: 'Категория' }).getByRole('button').first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, '48-frequent-strip', testInfo);

    await strip.getByRole('button').first().click();
    await expect(strip).toBeHidden();
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(3);
  });

  test('«Повторить» в правке открывает новую операцию с теми же полями', async ({ page }, testInfo) => {
    await openApp(page);
    await addCoffee(page);
    await goSection(page, 'Операции');
    await rows(page).first().click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit).toBeVisible();
    await shot(page, '48-edit-footer', testInfo);
    await edit.getByRole('button', { name: 'Повторить операцию' }).click();

    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    // «Назад» из новой операции приводит на список, а не обратно в правку
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
  });
});
