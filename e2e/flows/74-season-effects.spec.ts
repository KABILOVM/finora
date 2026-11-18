import type { Page } from '@playwright/test';
import { expect, openApp, test } from '../helpers';

/**
 * Сколько непрозрачных точек в холсте с лежащим снегом у блока `selector` (−1 — холста у блока нет). Холст блока — тот, что стоит
 * над его верхним краем: на 8 px левее и на 18 px выше (поля холста в src/season/engine.ts).
 */
const snowOn = (page: Page, selector: string): Promise<number> =>
  page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return -1;
    const q = card.getBoundingClientRect();
    const pile = Array.from(document.querySelectorAll<HTMLCanvasElement>('.season-pile')).find((p) => {
      const r = p.getBoundingClientRect();
      return Math.abs(r.left - (q.left - 8)) < 2 && Math.abs(r.top - (q.top - 18)) < 2;
    });
    const data = pile?.getContext('2d')?.getImageData(0, 0, pile.width, pile.height).data;
    if (!data) return -1;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 40) n++;
    return n;
  }, selector);

test.describe('74. Сезонные эффекты', () => {
  test('зимой идёт снег и лежит на блоках, нажатие на блок стряхивает; «Выкл» в настройках убирает эффект', async ({ page }) => {
    // остальные сценарии идут с «уменьшить движение», при нём эффектов нет; здесь движение разрешено
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      if (localStorage.getItem('finora-season') === null) localStorage.setItem('finora-season', 'winter');
    });
    await openApp(page);

    await expect(page.locator('[data-season-layer="winter"]')).toHaveCount(1);
    await expect.poll(() => page.locator('.season-flake').count(), { message: 'снежинки летят' }).toBeGreaterThan(10);
    const flakes = await page.locator('.season-flake').count();

    // на первом блоке под карточкой «Всего» лежит снег
    const card = '#main .card';
    await page.locator(card).first().scrollIntoViewIfNeeded();
    await expect.poll(() => snowOn(page, card), { message: 'на блоке лежит снег' }).toBeGreaterThan(200);
    const before = await snowOn(page, card);

    // слой эффектов не мешает странице: вбок она не прокручивается, а нажатия проходят сквозь него
    const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(o.scroll, 'страница шире экрана').toBeLessThanOrEqual(o.client);

    // нажатие на поле блока (не на кнопку) стряхивает снег: он осыпается отдельными снежинками, сугроб пропадает
    const box = (await page.locator(card).first().boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + 30);
    await expect.poll(() => page.locator('.season-flake').count(), { message: 'стряхнутый снег осыпается' }).toBeGreaterThan(flakes + 10);
    expect(await snowOn(page, card), 'сугроб стряхнут').toBeLessThan(before / 2);
    // осыпавшееся исчезает само
    await expect.poll(() => page.locator('.season-flake').count(), { timeout: 8000 }).toBeLessThanOrEqual(flakes);

    // «Выкл» в «Настройки → Оформление» убирает слой целиком
    await page.goto('/#/settings');
    const group = page.getByRole('group', { name: 'Сезонные эффекты' });
    await expect(group.getByRole('button', { name: /Зима/ })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: /Выкл/ }).click();
    await expect(page.locator('[data-season-layer]')).toHaveCount(0);
    await expect(page.locator('.season-flake')).toHaveCount(0);
    await expect(page.locator('.season-pile')).toHaveCount(0);

    // выбор помнится после перезагрузки
    await page.reload();
    await expect(page.getByRole('group', { name: 'Сезонные эффекты' }).getByRole('button', { name: /Выкл/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-season-layer]')).toHaveCount(0);
  });
});
