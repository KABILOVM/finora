import type { Page } from '@playwright/test';
import { expect, goSection, norm, openApp, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026, 14:00 по Душанбе. */
const NOW = new Date('2026-10-15T09:00:00Z');

/** Курсы на устройстве: 1 USD = 10,95 с., 1 RUB = 0,121 с.; обновлены час назад, поэтому приложение само их не трогает. */
const RATES = {
  v: 1,
  tables: [{ asOf: '2026-10-15', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.95, EUR: 12, RUB: 0.121 }, source: 'nbt', fetchedAt: '2026-10-15T08:00:00.000Z' }],
  manual: {},
  lastRefreshAt: '2026-10-15T08:00:00.000Z',
  lastAttemptAt: '2026-10-15T08:00:00.000Z',
  lastError: null,
};

const FORECAST = {
  current: { time: '2026-10-15T14:00', temperature_2m: 23.4, apparent_temperature: 22, relative_humidity_2m: 30, weather_code: 0, is_day: 1, wind_speed_10m: 2.1, surface_pressure: 920 },
  hourly: {
    time: ['2026-10-15T14:00', '2026-10-15T15:00', '2026-10-15T16:00'],
    temperature_2m: [23, 24, 22],
    weather_code: [0, 1, 2],
    is_day: [1, 1, 1],
    precipitation_probability: [0, 0, 10],
  },
  daily: {
    time: ['2026-10-15', '2026-10-16', '2026-10-17'],
    weather_code: [0, 61, 3],
    temperature_2m_max: [27.6, 18, 20],
    temperature_2m_min: [9.4, 8, 7],
    precipitation_probability_max: [0, 80, 20],
    sunrise: ['2026-10-15T06:20'],
    sunset: ['2026-10-15T17:30'],
  },
};

const glance = (page: Page) => page.getByTestId('home-glance');
const ratesWidget = (page: Page) => page.getByTestId('rates-widget');
const weatherWidget = (page: Page) => page.getByTestId('weather-widget');

/** Курсы кладём на устройство заранее; всё внешнее, кроме подменённого прогноза, закрыто (как без интернета). */
async function prepare(page: Page, opts: { forecast?: 'ok' | 'down' } = {}): Promise<{ forecastCalls: () => number }> {
  await page.addInitScript((rates) => {
    try {
      if (localStorage.getItem('finora:rates:v1') === null) localStorage.setItem('finora:rates:v1', JSON.stringify(rates));
    } catch {
      /* без хранилища курсов не будет — тест сам об этом скажет */
    }
  }, RATES);
  let calls = 0;
  await page.context().route(
    (u) => /open-meteo\.com$/.test(u.hostname),
    async (route) => {
      calls += 1;
      if (opts.forecast === 'down') return route.abort('internetdisconnected');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(FORECAST),
      });
    },
  );
  return { forecastCalls: () => calls };
}

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (window.visualViewport?.width ?? window.innerWidth) + 1)).toBe(true);

test.describe('38. Курсы и погода на «Главной»', () => {
  test('курсы: доллар и рубль к сомони на главной → нажатие открывает «Курсы валют»', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepare(page);
    await openApp(page);
    await goSection(page, 'Главная');

    const widget = ratesWidget(page);
    await expect(widget).toBeVisible();
    await expect(widget).toContainText('Курсы');
    const rows = widget.getByTestId('rates-widget-row');
    await expect(rows).toHaveCount(2);
    expect(norm(await rows.nth(0).innerText())).toBe('1 USD 10,95 с.');
    expect(norm(await rows.nth(1).innerText())).toBe('100 RUB 12,10 с.');
    await expect(widget).toContainText('на 15.10');
    await expect(widget).not.toContainText('устарел');
    await expect(widget).toHaveAttribute('aria-label', /Курсы к Сомони: 1 USD = 10,95 с\.; 100 RUB = 12,10 с\./);
    await noHorizontalScroll(page);
    await widget.scrollIntoViewIfNeeded();
    await shot(page, '38-home-glance', testInfo);

    await widget.click();
    await expect(page).toHaveURL(/#\/rates$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Курсы валют' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Сумма' })).toBeVisible();
  });

  test('погода: выбран город → температура и «днём/ночью» на главной → нажатие открывает «Погоду» с часами и днями', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    const net = await prepare(page);
    await openApp(page);

    // город не выбран → карточка зовёт выбрать, в сеть погоды не ходим
    await goSection(page, 'Главная');
    await expect(weatherWidget(page)).toContainText('Покажем погоду там, где вы');
    expect(net.forecastCalls()).toBe(0);

    // выбираем город в разделе «Погода»
    await weatherWidget(page).click();
    await expect(page).toHaveURL(/#\/weather$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Погода' })).toBeVisible();
    await page.getByRole('tab', { name: 'Худжанд' }).click();
    await expect(page.getByRole('region', { name: /Погода сейчас: Ясно/ })).toBeVisible();

    // обратно на «Главную»: карточка с погодой выбранного города
    await goSection(page, 'Главная');
    const widget = weatherWidget(page);
    await expect(widget).toContainText('+23°');
    await expect(widget).toContainText('Ясно');
    await expect(widget).toContainText('Худжанд');
    await expect(widget).toContainText('днём +28°, ночью +9°');
    await expect(widget).toHaveAttribute('aria-label', 'Погода, Худжанд: +23°, Ясно, днём +28°, ночью +9°. Открыть погоду');
    await noHorizontalScroll(page);
    await widget.scrollIntoViewIfNeeded();
    await shot(page, '38-home-weather', testInfo);

    await widget.click();
    await expect(page).toHaveURL(/#\/weather$/);
    await expect(page.getByRole('heading', { name: 'По часам' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'На неделю' })).toBeVisible();
  });

  test('нет связи с сервисом погоды: на главной «Погода недоступна», страница и курсы работают', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await prepare(page, { forecast: 'down' });
    // человек уже выбирал Худжанд на этом устройстве
    await page.addInitScript(() => {
      try {
        localStorage.setItem('finora:weather:selected:v1', JSON.stringify('40.28,69.62'));
      } catch {
        /* без хранилища выбора не будет — тест сам об этом скажет */
      }
    });
    await openApp(page);
    await expect(weatherWidget(page)).toContainText('Погода недоступна');
    await expect(weatherWidget(page)).toContainText('Худжанд');
    await expect(ratesWidget(page)).toContainText('1 USD');
    await expect(glance(page)).toBeVisible();
  });
});
