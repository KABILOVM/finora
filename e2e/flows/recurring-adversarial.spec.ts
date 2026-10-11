import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, isPhone, money, norm, openApp, sheet, shot, test } from '../helpers';

/**
 * Атаки «ломателя» на «Регулярные платежи»: самый узкий телефон (320px), длинные названия и суммы, переход через полночь.
 * Часовой пояс проектов — Asia/Dushanbe (UTC+5): 2026-10-11 23:59:40 по Душанбе = 18:59:40 UTC.
 */
const overflowX = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

/** Элементы внутри main (или окна), правый край которых уходит за правый край экрана. */
const spillingOut = (page: Page, root = 'main') =>
  page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(`${sel} *`))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) out.push(`${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 40)}] right=${Math.round(r.right)} vw=${vw}`);
    }
    return out;
  }, root);

async function addRule(page: Page, r: { amount: string; note: string; start?: string; auto?: boolean }): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(r.amount);
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(r.note);
  if (r.start) await dlg.getByLabel('Первый платёж').fill(r.start);
  if (r.auto) await dlg.getByRole('switch', { name: 'Проводить само' }).click();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('17-adv. Регулярные платежи: самый узкий телефон и полночь', () => {
  test('320px: обычный платёж (аренда, 500 с.) — кнопки «Провести» и «Пропустить» помещаются в карточку, страница не едет вбок', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addRule(page, { amount: '500', note: 'аренда' });
    await goSection(page, 'Платежи');
    await expect(page.getByRole('button', { name: /^Пропустить: аренда/ })).toBeVisible();
    await shot(page, '17adv-320-plain', testInfo);

    const skip = await page.getByRole('button', { name: /^Пропустить: аренда/ }).boundingBox();
    const post = await page.getByRole('button', { name: /^Провести: аренда/ }).boundingBox();
    const card = await page.getByRole('region', { name: 'Сегодня' }).boundingBox();
    expect(skip && post && card, 'кнопки и карточка видны').toBeTruthy();
    expect(skip!.x + skip!.width, 'кнопка «Пропустить» заходит за край экрана (320px)').toBeLessThanOrEqual(320);
    expect(skip!.x + skip!.width, 'кнопка «Пропустить» выходит за правый край карточки «Сегодня»').toBeLessThanOrEqual(card!.x + card!.width);
    expect(post!.x + post!.width, 'кнопка «Провести» заходит на «Пропустить»').toBeLessThanOrEqual(skip!.x + 0.5);
    const o = await overflowX(page);
    expect(o.scroll, `«Платежи»: страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);
    expect(await spillingOut(page), 'на «Платежах» есть элементы за правым краем').toEqual([]);
  });

  test('320px: виджет «Ближайшие платежи» на «Главной» не вылезает за экран', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addRule(page, { amount: '500', note: 'аренда' });
    await goSection(page, 'Главная');
    await page.getByRole('region', { name: 'Ближайшие платежи' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '17adv-320-home', testInfo);
    const o = await overflowX(page);
    expect(o.scroll, `«Главная»: страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);
    expect(await spillingOut(page), 'на «Главной» есть элементы за правым краем').toEqual([]);
    const btn = await page.getByRole('region', { name: 'Ближайшие платежи' }).getByRole('button', { name: /^Провести: аренда/ }).boundingBox();
    expect(btn!.height, 'кнопка «Провести» в виджете ниже 44px').toBeGreaterThanOrEqual(43.5);
  });

  test('полночь: приложение открыто в 23:59:40, платёж «Проводить само» на завтра проводится сам после перехода через 00:00', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-11T18:59:40.000Z') });
    await openApp(page);
    await addRule(page, { amount: '75', note: 'полуночный', start: '2026-10-12', auto: true });
    await goSection(page, 'Платежи');
    await expect(page.getByRole('heading', { level: 2, name: 'Скоро' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Сегодня' })).toHaveCount(0);

    // переходим через полночь без перезагрузки
    await page.clock.runFor(75_000);
    await page.clock.resume();
    await goSection(page, 'Операции');
    const allTime = page.getByRole('button', { name: 'Всё время' });
    if (await allTime.isVisible()) await allTime.click();
    const rows = page.getByRole('region').getByRole('button');
    await expect(rows).toHaveCount(1);
    expect(norm(await rows.first().innerText())).toMatch(money('−75 с.'));
    // «Сегодня» по часам приложения уже 12 октября: операция записана на этот день
    expect(norm(await page.getByRole('main').innerText())).toMatch(/Сегодня/);
  });
});
