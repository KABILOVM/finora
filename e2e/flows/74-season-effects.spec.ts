import type { Page } from '@playwright/test';
import { expect, openApp, test, waitReady } from '../helpers';

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

/** Выбранный город «Погоды» и его сохранённый прогноз с кодом `code`, полученный `ageMs` мс назад (так «Погода» хранит его на устройстве). */
async function setWeather(page: Page, code: number, ageMs = 0): Promise<void> {
  await page.evaluate(
    ([c, age]) => {
      const id = '38.56,68.79'; // Душанбе — город по умолчанию
      const at = new Date(Date.now() - age).toISOString();
      localStorage.setItem('finora:weather:selected:v1', JSON.stringify(id));
      localStorage.setItem(
        `finora:weather:cache:v1:${id}`,
        JSON.stringify({ fetchedAt: at, current: { temp: 4, feels: 1, humidity: 80, code: c, isDay: true, wind: 5, pressure: 700, time: at }, hours: [], days: [], sunrise: null, sunset: null }),
      );
    },
    [code, ageMs] as const,
  );
  await page.reload();
  await waitReady(page);
}

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

    // падающие снежинки рисуются НАД лежащим на блоках: летят перед сугробом, а не прячутся под ним
    const z = await page.evaluate(() => ({
      sky: Number(getComputedStyle(document.querySelector('.season-sky')!).zIndex),
      ground: Number(getComputedStyle(document.querySelector('.season-ground')!).zIndex),
    }));
    expect(z.sky, 'слой падающих частиц над слоем лежащего').toBeGreaterThan(z.ground);

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

  test('«Авто» следует погоде: дождь с брызгами и пеленой, снегопад — метель; ясно и старый прогноз — сезон по дате', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page);
    const layer = page.locator('[data-season-layer]');
    const seasonByDate = /^(winter|spring|summer|autumn)$/;

    await setWeather(page, 63); // дождь
    await expect(layer).toHaveAttribute('data-season-layer', 'rain');
    await expect(page.locator('.season-mist')).toHaveCount(1);
    await expect.poll(() => page.locator('.season-flake').count(), { message: 'капли летят' }).toBeGreaterThan(10);
    await expect.poll(() => page.locator('.season-splash').count(), { timeout: 15_000, message: 'капли разбиваются о блоки брызгами' }).toBeGreaterThan(0);
    await expect(page.locator('.season-pile'), 'дождь ничего не оставляет на блоках').toHaveCount(0);

    await setWeather(page, 75); // сильный снег
    await expect(layer).toHaveAttribute('data-season-layer', 'blizzard');
    await expect(page.locator('.season-gust')).toHaveCount(3);
    await expect.poll(() => page.locator('.season-pile').count(), { message: 'метель наметает сугробы' }).toBeGreaterThan(0);

    await setWeather(page, 0); // ясно
    await expect(layer).toHaveAttribute('data-season-layer', seasonByDate);
    await setWeather(page, 63, 5 * 60 * 60_000); // дождь был пять часов назад — устарел
    await expect(layer).toHaveAttribute('data-season-layer', seasonByDate);
  });

  test('сезон, выбранный вручную, погодой не перебивается', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => localStorage.setItem('finora-season', 'summer'));
    await openApp(page);
    await setWeather(page, 65); // ливень
    await expect(page.locator('[data-season-layer]')).toHaveAttribute('data-season-layer', 'summer');
    await expect(page.locator('.season-heat')).toHaveCount(1);
  });

  test('летящие частицы двигаются вместе со скроллом: вниз — поднимаются, вверх — опускаются', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => localStorage.setItem('finora-season', 'winter'));
    await openApp(page);
    await expect.poll(() => page.locator('.season-flake').count()).toBeGreaterThan(10);
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    test.skip(room < 150, 'страница не прокручивается: нечем двигать частицы');
    const dy = Math.min(300, room);
    const moved = await page.evaluate(async (distance) => {
      const flakes = Array.from(document.querySelectorAll('.season-flake'));
      const tops = () => flakes.map((f) => f.getBoundingClientRect().top);
      const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
      const near = (d: number[]) => d.filter((x) => Math.abs(x) < distance * 1.2); // частицы, которые «перескочили» вниз экрана, не считаем
      const start = tops();
      window.scrollTo(0, distance);
      await frames();
      const down = tops();
      window.scrollTo(0, 0);
      await frames();
      const up = tops();
      return { down: median(near(down.map((v, i) => v - start[i]!))), up: median(near(up.map((v, i) => v - down[i]!))) };
    }, dy);
    // мелкие «дальние» частицы повторяют скролл слабее крупных (0,3…0,9), но в среднем заметно
    expect(moved.down, 'прокрутили вниз — частицы поднялись').toBeLessThan(-0.25 * dy);
    expect(moved.up, 'прокрутили вверх — частицы опустились').toBeGreaterThan(0.25 * dy);
  });
});
