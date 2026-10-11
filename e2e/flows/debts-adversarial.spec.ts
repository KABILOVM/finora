import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, openApp, shot, sheet, tapAmount, test } from '../helpers';

/**
 * Состязательные проверки «Долгов» в настоящем браузере: раскладка на узких телефонах (длинные имена без пробелов,
 * огромные суммы), доступные имена у кнопок и полей, клавиатура и высота шита. Запуск: проект iphone.
 */

/** Имя без пробелов и дефисов (так выглядят прозвища и названия из мессенджеров): в таком слове перенос строки невозможен. */
const NICK = 'Магазин_Салом_Душанбе_Шарк_Рынок_1';

/** Что тянет экран или шит вбок: ширина страницы и тела каждого шита, а также самые широкие элементы. */
async function widthProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${vw}`);
    document.querySelectorAll<HTMLElement>('[role="dialog"] .overflow-y-auto').forEach((body) => {
      if (body.scrollWidth > body.clientWidth + 1) out.push(`тело шита шире окна: ${body.scrollWidth} > ${body.clientWidth}`);
    });
    if (out.length > 0) {
      const wide: string[] = [];
      document.querySelectorAll<HTMLElement>('main *, [role="dialog"] *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1 && el.children.length === 0) wide.push(`${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 24)}] до ${Math.round(r.right)}`);
      });
      out.push(...wide.slice(0, 3));
    }
    return out;
  });
}

async function newDebt(page: Page, d: { name: string; amount: string; currency?: string; date?: string; due?: string; paper?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).first().click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill(d.name);
  if (d.currency) await dlg.getByRole('combobox', { name: 'Валюта' }).selectOption(d.currency);
  await tapAmount(page, d.amount);
  if (d.date) {
    await dlg.getByRole('group', { name: 'Дата долга' }).getByRole('button', { name: 'Другая дата' }).click();
    await dlg.getByLabel('Дата долга: календарь').fill(d.date);
  }
  if (d.due) {
    await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
    await dlg.getByLabel('Срок возврата: календарь').fill(d.due);
  }
  if (d.paper !== false) await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  expect(await widthProblems(page), 'шит «Новый долг»').toEqual([]);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('узкий телефон 360 px: длинное имя без пробелов', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('«Главная»: виджет «Долги» не растягивает страницу вбок', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'узкий телефон проверяем один раз');
    await openApp(page, '/debts');
    await newDebt(page, { name: NICK, amount: '500', date: '2025-12-01', due: '2026-01-01' });
    await openApp(page, '/');
    await expect(page.getByTestId('debts-widget')).toBeVisible();
    await shot(page, 'brk-home-widget-360', testInfo);
    expect(await widthProblems(page), 'Главная с виджетом «Долги»').toEqual([]);
  });

  test('шит правки операции по долгу: пояснение со ссылкой на долг помещается в окно', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'узкий телефон проверяем один раз');
    await openApp(page, '/debts');
    await newDebt(page, { name: NICK, amount: '100', due: '2028-12-01', paper: false });
    await goSection(page, 'Операции');
    await page.getByTestId('tx-tags').first().click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit.getByTestId('tx-link-notice')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, 'brk-edit-notice-360', testInfo);
    expect(await widthProblems(page), 'шит «Правка операции»').toEqual([]);
  });

  test('шит платежа: строка «<имя> вернул вам» помещается в окно', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'узкий телефон проверяем один раз');
    await openApp(page, '/debts');
    await newDebt(page, { name: NICK, amount: '100' });
    await page.getByRole('link', { name: /^Магазин_Салом/ }).click();
    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    await expect(sheet(page, 'Платёж по долгу')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, 'brk-payment-sheet-360', testInfo);
    expect(await widthProblems(page), 'шит «Платёж по долгу»').toEqual([]);
  });
});

test.describe('самый узкий телефон 320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('список и страница долга с длинным именем помещаются в экран', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'узкий телефон проверяем один раз');
    await openApp(page, '/debts');
    await newDebt(page, { name: 'Ш'.repeat(80), amount: '1500', date: '2025-12-01', due: '2026-01-01' });
    await newDebt(page, { name: 'Алишер', amount: '12345,67', date: '2025-12-01', due: '2026-01-02' });
    expect(await widthProblems(page), 'список долгов').toEqual([]);
    await page.getByRole('link', { name: /^Ш{10}/ }).click();
    await expect(page.getByTestId('debt-summary')).toBeVisible();
    expect(await widthProblems(page), 'страница долга').toEqual([]);
    await page.getByRole('button', { name: 'Править', exact: true }).click();
    await expect(sheet(page, 'Правка долга')).toBeVisible();
    expect(await widthProblems(page), 'шит «Правка долга»').toEqual([]);
  });

  test('журнал и уведомление об архиве с длинным именем помещаются в экран', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'узкий телефон проверяем один раз');
    await openApp(page, '/debts');
    await newDebt(page, { name: 'Ш'.repeat(80), amount: '100', due: '2028-12-01', paper: false });
    await goSection(page, 'Операции');
    await expect(page.getByTestId('tx-tags').first()).toBeVisible();
    expect(await widthProblems(page), 'журнал операций').toEqual([]);
    await openApp(page, '/debts');
    await page.getByRole('link', { name: /^Ш{10}/ }).click();
    await page.getByRole('button', { name: 'В архив', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'убран в архив' })).toBeVisible();
    expect(await widthProblems(page), 'уведомление об архиве').toEqual([]);
  });
});

/** Кнопки, ссылки и поля, у которых нет доступного имени (скринридер скажет просто «кнопка»). */
async function unnamed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      const id = el.getAttribute('id');
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent?.trim()) return l.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      const title = el.getAttribute('title')?.trim();
      if (title) return title;
      return (el.textContent ?? '').trim();
    };
    document
      .querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="checkbox"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (!nameOf(el)) out.push(`${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').slice(0, 40)}"`);
      });
    return out;
  });
}

test('доступность: у всех кнопок, ссылок и полей на экранах долгов есть имя', async ({ page }) => {
  await openApp(page, '/debts');
  expect(await unnamed(page), 'пустой экран «Долги»').toEqual([]);

  await page.getByRole('button', { name: 'Новый долг', exact: true }).first().click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  expect(await unnamed(page), 'шит «Новый долг»').toEqual([]);
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Алишер');
  await tapAmount(page, '500');
  await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
  expect(await unnamed(page), 'шит «Новый долг» со сроком').toEqual([]);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
  expect(await unnamed(page), 'список долгов').toEqual([]);

  await page.getByRole('link', { name: /^Алишер/ }).click();
  await expect(page.getByTestId('debt-summary')).toBeVisible();
  expect(await unnamed(page), 'страница долга').toEqual([]);

  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const pay = sheet(page, 'Платёж по долгу');
  await expect(pay).toBeVisible();
  expect(await unnamed(page), 'шит «Платёж по долгу»').toEqual([]);
  await tapAmount(page, '9');
  expect(await unnamed(page), 'шит платежа с переплатой').toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Править', exact: true }).click();
  expect(await unnamed(page), 'шит «Правка долга»').toEqual([]);
  await page.keyboard.press('Escape');

  await goSection(page, 'Операции');
  await page.getByTestId('tx-tags').first().click();
  await expect(sheet(page, 'Правка операции')).toBeVisible();
  expect(await unnamed(page), 'шит «Правка операции» по долгу').toEqual([]);
});

test('клавиатура: фокус не уходит из шита платежа и возвращается на кнопку после закрытия', async ({ page }) => {
  await openApp(page, '/debts');
  await newDebt(page, { name: 'Алишер', amount: '500' });
  await page.getByRole('link', { name: /^Алишер/ }).click();
  const open = page.getByRole('button', { name: 'Добавить платёж', exact: true });
  await open.click();
  const pay = sheet(page, 'Платёж по долгу');
  await expect(pay).toBeVisible();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(inside, `${key} №${i + 1}: фокус вышел из шита`).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await expect(pay).toBeHidden();
  await expect(open).toBeFocused();
});

test('самый маленький экран 320x568: «Сохранить» и «Записать платёж» всегда на виду', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page, '/debts');
  await page.getByRole('button', { name: 'Новый долг', exact: true }).first().click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  const vp = page.viewportSize()!;
  const save = dlg.getByRole('button', { name: 'Сохранить', exact: true });
  await page.waitForTimeout(600); // шит выезжает снизу с анимацией: меряем, когда остановился
  const box = await save.boundingBox();
  expect(box, 'кнопка «Сохранить» отрисована').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
  const dbox = await dlg.boundingBox();
  expect(dbox!.y + dbox!.height, 'шит помещается по высоте').toBeLessThanOrEqual(vp.height + 1);
  await dlg.getByRole('textbox', { name: 'Заметка' }).scrollIntoViewIfNeeded();
  await expect(dlg.getByRole('textbox', { name: 'Заметка' })).toBeInViewport();
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Алишер');
  await tapAmount(page, '500');
  await save.click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);

  await page.getByRole('link', { name: /^Алишер/ }).click();
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const pay = sheet(page, 'Платёж по долгу');
  await expect(pay).toBeVisible();
  await page.waitForTimeout(600);
  const pbox = await pay.getByRole('button', { name: 'Записать платёж' }).boundingBox();
  expect(pbox!.y + pbox!.height).toBeLessThanOrEqual(vp.height);
  expect(pbox!.y).toBeGreaterThanOrEqual(0);
});
