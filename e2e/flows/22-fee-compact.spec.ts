import { expect, fillTx, isPhone, openApp, shot, test } from '../helpers';
import type { Locator, Page } from '@playwright/test';

/** Размеры окна и его прокручиваемой части (тело шита — первый вложенный блок с overflow-y: auto). */
async function metrics(dlg: Locator) {
  const box = await dlg.boundingBox();
  const body = await dlg.evaluate((el) => {
    const b = [...el.querySelectorAll<HTMLElement>('div')].find((d) => getComputedStyle(d).overflowY === 'auto')!;
    return { scrollTop: b.scrollTop, scrollHeight: b.scrollHeight, clientHeight: b.clientHeight };
  });
  return { h: Math.round(box!.height), y: Math.round(box!.y), ...body };
}

const toTop = (dlg: Locator) =>
  dlg.evaluate((el) => {
    const b = [...el.querySelectorAll<HTMLElement>('div')].find((d) => getComputedStyle(d).overflowY === 'auto')!;
    b.scrollTop = 0;
  });

async function checkFeeRow(page: Page, dlg: Locator) {
  const row = dlg.getByRole('group', { name: 'Комиссия' });
  const box = await row.boundingBox();
  expect(box!.height, 'строка комиссии не выше 48 px').toBeLessThanOrEqual(48);
  const vp = page.viewportSize()!;
  for (const b of await row.getByRole('button').all()) {
    const bb = await b.boundingBox();
    expect(bb!.x + bb!.width, 'кнопка в пределах экрана').toBeLessThanOrEqual(vp.width);
    expect(bb!.y, 'кнопка внутри строки').toBeGreaterThanOrEqual(box!.y - 1);
    expect(bb!.y + bb!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
  }
  const x = await dlg.getByRole('button', { name: 'Убрать комиссию' }).boundingBox();
  expect(x!.width).toBeGreaterThanOrEqual(44);
}

const VIEWS = [
  { w: 390, h: 844, fits: true },
  { w: 375, h: 667, fits: true },
  // На 320x568 форма и без комиссии длиннее окна (прокрутка есть всегда): комиссия не должна её удлинять и сдвигать.
  { w: 320, h: 568, fits: false },
];

for (const v of VIEWS) {
  test(`комиссия в одну строку: окно не растёт и не прыгает (${v.w}x${v.h})`, async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'узкий экран');
    await page.setViewportSize({ width: v.w, height: v.h });
    await openApp(page);
    const dlg = await fillTx(page, { amount: '150', category: 'Еда' });
    await toTop(dlg);
    const before = await metrics(dlg);
    await dlg.getByRole('button', { name: 'Комиссия', exact: true }).click();
    await dlg.getByRole('radio', { name: 'Проценты' }).click();
    const pct = dlg.getByRole('textbox', { name: 'Комиссия в процентах' });
    await expect(pct).toBeFocused();
    await pct.fill('0,1');
    await expect(dlg.getByText(/Итого спишется: 150,15/)).toBeVisible();
    const after = await metrics(dlg);
    await shot(page, `22-fee-percent-${v.w}`, testInfo);
    expect(after.h, 'высота окна не изменилась').toBe(before.h);
    expect(after.y, 'окно не сместилось').toBe(before.y);
    expect(after.scrollTop, 'содержимое не прыгнуло').toBe(0);
    if (v.fits) expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight);
    else expect(after.scrollHeight, 'комиссия не удлиняет форму').toBeLessThanOrEqual(before.scrollHeight);
    await checkFeeRow(page, dlg);

    // «Сумма»: та же строка, окно то же
    await dlg.getByRole('radio', { name: 'Сумма' }).click();
    await dlg.getByRole('textbox', { name: /^Комиссия/ }).fill('2');
    const amountMode = await metrics(dlg);
    await shot(page, `22-fee-amount-${v.w}`, testInfo);
    expect(amountMode.h).toBe(before.h);
    expect(amountMode.scrollTop).toBe(0);
    await checkFeeRow(page, dlg);

    // крестик убирает комиссию целиком, окно возвращается к прежнему виду
    await dlg.getByRole('button', { name: 'Убрать комиссию' }).click();
    await expect(dlg.getByRole('group', { name: 'Комиссия' })).toHaveCount(0);
    expect((await metrics(dlg)).h).toBe(before.h);
  });
}

test('комиссия в одну строку: окно на компьютере не меняет размер', async ({ page }, testInfo) => {
  test.skip(isPhone(page), 'только компьютер');
  await openApp(page);
  const dlg = await fillTx(page, { amount: '150', category: 'Еда' });
  const before = await metrics(dlg);
  await dlg.getByRole('button', { name: 'Комиссия', exact: true }).click();
  await dlg.getByRole('radio', { name: 'Проценты' }).click();
  await dlg.getByRole('textbox', { name: 'Комиссия в процентах' }).fill('0,1');
  const after = await metrics(dlg);
  await shot(page, '22-fee-desktop', testInfo);
  expect(after.h).toBe(before.h);
  expect(after.y).toBe(before.y);
  expect(after.scrollTop).toBe(0);
  expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight);
  await checkFeeRow(page, dlg);
  await dlg.getByRole('button', { name: 'Убрать комиссию' }).click();
  expect((await metrics(dlg)).h).toBe(before.h);
});
