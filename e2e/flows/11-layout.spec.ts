import { addTx, createWallet, dismissToasts, expect, fillTx, goSection, isPhone, openApp, shot, test } from '../helpers';
import type { Page } from '@playwright/test';

/** На телефоне страница не должна ехать вбок: горизонтальной прокрутки быть не должно. */
const overflowX = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

for (const width of [320, 375, 430]) {
  test(`телефон ${width}px: на всех экранах нет горизонтальной прокрутки; кнопки ввода в пределах экрана`, async ({ page }, testInfo) => {
    test.skip(!isPhone(page), 'проверка только для узкого экрана');
    await page.setViewportSize({ width, height: width === 320 ? 568 : 740 });
    await openApp(page);
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '1234,5' });
    await addTx(page, { amount: '9999999,99', category: 'Еда', wallet: 'Наличные', note: 'очень длинная заметка про самую длинную покупку в жизни' });
    await dismissToasts(page);

    for (const s of ['Главная', 'Операции', 'Кошельки', 'Настройки'] as const) {
      await goSection(page, s);
      const o = await overflowX(page);
      expect(o.scroll, `${s}: страница шире экрана (${o.scroll} > ${o.client})`).toBeLessThanOrEqual(o.client);
    }
    await shot(page, `11-wallets-${width}`, testInfo);

    // шит ввода: «Сохранить» и клавиатура помещаются на экране
    const dlg = await fillTx(page, { amount: '1234567,89', category: 'Еда' });
    const save = dlg.getByRole('button', { name: 'Сохранить', exact: true });
    const box = await save.boundingBox();
    const vp = page.viewportSize()!;
    expect(box, 'кнопка «Сохранить» видна').not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
    const o = await overflowX(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    await shot(page, `11-add-${width}`, testInfo);
  });
}

test('телефон 320px: название кошелька не пропадает, когда остаток длинный (1 234 567,89 $)', async ({ page }, testInfo) => {
  test.skip(!isPhone(page), 'проверка только для узкого экрана');
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '1234567,89' }, { verifyVisible: false });
  await dismissToasts(page);
  await shot(page, '11-long-balance-320', testInfo);
  const name = page.getByRole('list').getByText('Доллары', { exact: true }).first();
  const box = await name.boundingBox();
  expect(box?.width ?? 0, 'название кошелька «Доллары» схлопнулось до нулевой ширины: человек видит только сумму').toBeGreaterThan(20);
  // название читается целиком (не «Дол…»): ширина текста совпадает с шириной самого слова
  const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped, 'название «Доллары» обрезано многоточием').toBe(false);
  // валюта в подписи («Наличные · USD») не должна прятаться за многоточием: по ней человек отличает кошельки
  const sub = page.getByRole('list').getByText(/Наличные · USD/).first();
  expect(await sub.evaluate((el) => el.scrollWidth > el.clientWidth), 'подпись «Наличные · USD» обрезана: валюты не видно').toBe(false);
  // значок кошелька остаётся рядом с названием, а не уезжает на свою строку
  const icon = page.getByRole('list').locator('li', { hasText: 'Доллары' }).locator('span[aria-hidden="true"]').first();
  const iconBox = await icon.boundingBox();
  expect(iconBox, 'значок кошелька виден').not.toBeNull();
  expect(iconBox!.y, 'значок и название на одной строке').toBeLessThan(box!.y + box!.height);
  expect(iconBox!.x + iconBox!.width, 'значок левее названия').toBeLessThanOrEqual(box!.x + 1);
  // то же на «Главной»
  await goSection(page, 'Главная');
  const homeName = page.getByRole('region', { name: 'Кошельки' }).getByText('Доллары', { exact: true });
  expect((await homeName.boundingBox())?.width ?? 0).toBeGreaterThan(20);
});

test('телефон 320px: название операции не пропадает, когда сумма длинная', async ({ page }, testInfo) => {
  test.skip(!isPhone(page), 'проверка только для узкого экрана');
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await addTx(page, { amount: '9999999,99', category: 'Развлечения', wallet: 'Наличные' });
  await dismissToasts(page);
  await goSection(page, 'Операции');
  await shot(page, '11-long-amount-ops-320', testInfo);
  const title = page.getByRole('main').getByText('Развлечения', { exact: true }).first();
  const box = await title.boundingBox();
  expect(box?.width ?? 0, 'название операции схлопнулось: видна только сумма').toBeGreaterThan(20);
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth), 'название операции обрезано многоточием').toBe(false);
  const o = await overflowX(page);
  expect(o.scroll, 'страница шире экрана').toBeLessThanOrEqual(o.client);
});
