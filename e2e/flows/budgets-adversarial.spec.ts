import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, isPhone, money, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

/**
 * Атаки «ломателя» на экран «Бюджеты»: самый узкий телефон (320px), длинные суммы и длинные названия.
 * «Сегодня» закреплено на 15 октября 2026, как в 16-budgets.spec.ts.
 */
const NOW = new Date('2026-10-15T09:00:00Z');
const pinClock = (page: Page) => page.clock.install({ time: NOW });

const overflowX = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

async function addLimit(page: Page, scope: string, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
  const dlg = sheet(page, 'Новый лимит');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: scope });
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Элементы внутри main, правый край которых уходит за правый край экрана. */
const spillingOut = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('main *'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) out.push(`${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 40)}] right=${Math.round(r.right)} vw=${vw}`);
    }
    return out;
  });

test.describe('16-adv. Бюджеты на самом узком телефоне', () => {
  test('320px: крупное «Осталось на день» и строки лимитов с длинными суммами не вылезают за экран', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width: 320, height: 568 });
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '9999999,99', category: 'Зарплата' });
    await addTx(page, { amount: '1234567,89', category: 'Еда' });
    await dismissToasts(page);

    await goSection(page, 'Бюджеты');
    await addLimit(page, 'Все расходы', '9999999,99');
    await addLimit(page, 'Еда', '1234567,89');
    await shot(page, '16adv-320-budgets', testInfo);

    const perDay = page.getByTestId('forecast-per-day');
    // 9 999 999,99 − 1 234 567,89 = 8 765 432,10 ÷ 17 = 515 613,65 (вниз)
    await expect(perDay).toContainText(money('515 613,65 с.'));
    const o = await overflowX(page);
    expect(o.scroll, `«Бюджеты»: страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);
    expect(await spillingOut(page), 'на экране «Бюджеты» есть элементы за правым краем').toEqual([]);

    await goSection(page, 'Главная');
    await shot(page, '16adv-320-home', testInfo);
    const o2 = await overflowX(page);
    expect(o2.scroll, `«Главная»: страница шире экрана (${o2.scroll} > ${o2.client})`).toBeLessThanOrEqual(o2.client);
    expect(await spillingOut(page), 'на «Главной» есть элементы за правым краем').toEqual([]);
  });

  test('320px: очень длинное название категории не ломает строку лимита и шит (помещается, «Сохранить» на экране)', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width: 320, height: 568 });
    await pinClock(page);
    await openApp(page);

    const longName = 'Ж'.repeat(40) + 'ааааааааааааааааааааааааааааааааааа';
    await goSection(page, 'Ещё');
    await page.getByRole('main').getByRole('link', { name: 'Категории', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const cat = sheet(page, 'Новая категория расходов');
    await cat.getByRole('textbox', { name: 'Название' }).fill(longName);
    await cat.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const shown = (await cat.isVisible()) ? norm(await cat.innerText()) : '';
    test.skip(shown !== '', `категорию с длинным названием нельзя создать: ${shown.slice(0, 120)}`);
    await dismissToasts(page);
    const stored = await page.getByRole('main').getByRole('list').first().innerText();
    const name = norm(stored).match(/Ж{5,}а*/)?.[0] ?? longName;

    await goSection(page, 'Бюджеты');
    await addLimit(page, name, '100');
    await shot(page, '16adv-320-longname', testInfo);
    const o = await overflowX(page);
    expect(o.scroll, `«Бюджеты»: страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);

    await page.getByRole('button', { name: /^Лимит «Ж/ }).click();
    const edit = sheet(page, /^Лимит: Ж/);
    await expect(edit).toBeVisible();
    await shot(page, '16adv-320-longname-sheet', testInfo);
    const o2 = await overflowX(page);
    expect(o2.scroll, `шит: страница шире экрана (${o2.scroll} > ${o2.client})`).toBeLessThanOrEqual(o2.client);
    const box = await edit.boundingBox();
    expect(box!.x + box!.width, 'шит шире экрана').toBeLessThanOrEqual(320 + 0.5);
    const save = await edit.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox();
    expect(save!.y + save!.height, 'кнопка «Сохранить» ушла за низ экрана').toBeLessThanOrEqual(568);
  });
});

test.describe('16-adv. Заголовок и карточка прогноза на 320px', () => {
  test('320px: заголовок «Бюджеты» читается целиком, а не «Бюд…»', async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width: 320, height: 568 });
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Бюджеты');
    await shot(page, '16adv-320-title', testInfo);
    const h1 = page.getByRole('heading', { level: 1, name: 'Бюджеты' });
    const clipped = await h1.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped, 'заголовок экрана «Бюджеты» обрезан многоточием: кнопка «Добавить лимит» съела место').toBe(false);
  });

  for (const width of [320, 360]) test(`${width}px, основная валюта сум (UZS): строка «Сегодня потрачено … из …» не выходит за карточку прогноза`, async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width, height: 640 });
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Настройки');
    await page.getByRole('combobox', { name: /Основная валюта/ }).selectOption('UZS');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Сменить', exact: true }).click();
    await dismissToasts(page);
    await createWallet(page, { name: 'Сумы', currency: 'UZS', opening: '20000000' });
    await addTx(page, { amount: '1234567,89', wallet: 'Сумы', category: 'Еда' });
    await dismissToasts(page);

    await goSection(page, 'Бюджеты');
    await shot(page, `16adv-${width}-uzs`, testInfo);
    const card = page.getByTestId('forecast-card');
    await expect(card).toContainText('Сегодня потрачено');
    const spill = await card.evaluate((root) => {
      const box = root.getBoundingClientRect();
      const out: string[] = [];
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > box.right - 1) out.push(`${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 50)}] right=${Math.round(r.right)} card=${Math.round(box.right)}`);
      }
      return out;
    });
    expect(spill, 'суммы в карточке прогноза выходят за её правую границу').toEqual([]);
    const o = await overflowX(page);
    expect(o.scroll, `страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);
  });
});
