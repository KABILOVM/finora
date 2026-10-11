import type { Page } from '@playwright/test';
import { createWallet, dismissToasts, expect, goSection, isPhone, money, norm, openApp, sheet, shot, test } from '../helpers';

/**
 * Атаки «ломателя» на «Регулярные платежи»: самый узкий телефон (320px), длинные названия и суммы, переход через полночь.
 * Часовой пояс проектов — Asia/Dushanbe (UTC+5): 2026-10-11 23:59:40 по Душанбе = 18:59:40 UTC.
 */
const settleIcons = (page: Page) => page.waitForTimeout(400);
const overflowX = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

/**
 * Элементы внутри main (или окна), правый край которых уходит за правый край экрана. Не считается выходом то, что обрезано
 * родителем с overflow (hidden/clip/auto/scroll), чей край на экране: например, декоративные круги в карточке «Всего»
 * на «Главной» (overflow-hidden) или полоса чипов, которую листают пальцем. Страница при этом не едет вбок — это проверяет overflowX.
 */
const spillingOut = (page: Page, root = 'main') =>
  page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    const top = document.querySelector(sel);
    const clipped = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== top; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible' && p.getBoundingClientRect().right <= vw + 0.5) return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(`${sel} *`))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5 && !clipped(el)) out.push(`${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 40)}] right=${Math.round(r.right)} vw=${vw}`);
    }
    return out;
  }, root);

async function addRule(page: Page, r: { amount: string; note: string; start?: string; auto?: boolean; category?: string }): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(r.amount);
  if (r.category) {
    const group = dlg.getByRole('group', { name: 'Категория' });
    await group.getByRole('button').first().waitFor();
    const chip = group.getByRole('button', { name: r.category, exact: true });
    if ((await chip.count()) === 0) await group.getByRole('button', { name: /^Ещё/ }).click();
    await chip.click();
  }
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(r.note);
  if (r.start) await dlg.getByLabel('Первый платёж').fill(r.start);
  if (r.auto) await dlg.getByRole('switch', { name: 'Проводить само' }).click();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Окно целиком в экране: нет прокрутки вбок ни у окна, ни у его прокручиваемой части, и ни один элемент не торчит за край. */
async function expectSheetFits(page: Page, name: string, label: string): Promise<void> {
  const dlg = sheet(page, name);
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(500); // окно выезжает снизу
  const m = await dlg.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const scrollers = Array.from(el.querySelectorAll('*')).filter((n) => {
      const ox = getComputedStyle(n).overflowX;
      return (ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 0.5;
    });
    const spill = Array.from(el.querySelectorAll('*'))
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
      })
      .map((n) => `${n.tagName.toLowerCase()}[${(n.textContent ?? '').trim().slice(0, 30)}]`);
    return {
      sheetScroll: el.scrollWidth - el.clientWidth,
      scrollers: scrollers.map((n) => `${n.tagName.toLowerCase()}.${n.className.toString().slice(0, 40)} sw=${n.scrollWidth} cw=${n.clientWidth}`),
      spill,
      height: box.height,
      vh: window.innerHeight,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(m.sheetScroll, `${label}: окно прокручивается вбок`).toBeLessThanOrEqual(0);
  expect(m.scrollers, `${label}: есть полосы с прокруткой вбок`).toEqual([]);
  expect(m.spill, `${label}: элементы за краем окна`).toEqual([]);
  expect(m.pageScroll, `${label}: страница шире экрана`).toBeLessThanOrEqual(0);
  expect(m.height, `${label}: окно выше 92% экрана`).toBeLessThanOrEqual(m.vh * 0.92 + 1);
  // шапка и «Сохранить» всегда на виду
  await expect(dlg.getByRole('heading', { name })).toBeInViewport();
  await expect(dlg.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
}

test.describe('17-adv. Регулярные платежи: самый узкий телефон и полночь', () => {
  for (const [w, h] of [[320, 568], [375, 667], [390, 844]] as const) {
    test(`${w}px: окно «Новый регулярный платёж» помещается без прокрутки вбок (расход, перевод, список кошельков, «Ещё», конец, долг)`, async ({ page }, testInfo) => {
      test.skip(!isPhone(page), 'проверка только для телефона');
      await page.setViewportSize({ width: w, height: h });
      await openApp(page);
      await createWallet(page, { name: 'Очень длинное название кошелька для проверки', currency: 'USD', opening: '10' });
      await goSection(page, 'Платежи');
      await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
      const dlg = sheet(page, 'Новый регулярный платёж');
      await expectSheetFits(page, 'Новый регулярный платёж', 'расход');
      await shot(page, `17adv-sheet-${w}-expense`, testInfo);

      // раскрываем всё, что раскрывается
      await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: /^Ещё/ }).click();
      await dlg.getByRole('button', { name: /^Кошелёк:/ }).click();
      await dlg.getByRole('button', { name: /^Периодичность:/ }).click();
      await dlg.getByRole('switch', { name: 'Закончить в определённую дату' }).click();
      await expectSheetFits(page, 'Новый регулярный платёж', 'расход, всё раскрыто');
      await shot(page, `17adv-sheet-${w}-open`, testInfo);

      await dlg.getByRole('radio', { name: 'Перевод' }).click();
      await dlg.getByRole('button', { name: /^Куда:/ }).click();
      await expectSheetFits(page, 'Новый регулярный платёж', 'перевод');
      await shot(page, `17adv-sheet-${w}-transfer`, testInfo);
    });
  }

  test('значки: у каждой строки платежа есть значок категории или вида платежа (список, «Предстоящие», виджет «Главной»)', async ({ page }, testInfo) => {
    await openApp(page);
    await addRule(page, { amount: '500', note: 'аренда', category: 'Жильё' });
    await addRule(page, { amount: '70', note: 'без категории' });
    await goSection(page, 'Платежи');
    await settleIcons(page);
    for (const name of [/^Провести: аренда/, /^Провести: без категории/]) {
      const row = page.getByRole('button', { name }).locator('xpath=ancestor::li[1]');
      await expect(row.locator('svg').first(), 'в «Предстоящих» нет значка').toBeVisible();
      expect(await row.innerText(), 'в строке сырой код значка вместо картинки').not.toMatch(/\bi:[a-z]/);
    }
    for (const name of [/^аренда/, /^без категории/]) {
      const row = page.getByRole('button', { name }).first();
      await expect(row.locator('svg').first(), 'в «Всех правилах» нет значка').toBeVisible();
      expect(await row.innerText()).not.toMatch(/\bi:[a-z]/);
    }
    await shot(page, '17adv-icons-page', testInfo);

    await goSection(page, 'Главная');
    const widget = page.getByRole('region', { name: 'Ближайшие платежи' });
    await widget.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(widget.locator('svg').first(), 'в виджете «Главной» нет значка').toBeVisible();
    expect(await widget.innerText()).not.toMatch(/\bi:[a-z]/);
    await settleIcons(page);
    await shot(page, '17adv-icons-home', testInfo);
  });

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
