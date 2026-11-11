import type { Locator, Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026, 14:00 в Душанбе. */
const NOW = new Date('2026-10-15T09:00:00Z');

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (window.visualViewport?.width ?? window.innerWidth) + 1)).toBe(true);

/** Курсы на устройстве заранее и закрытая сеть (как без интернета). */
async function prepareRates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'finora:rates:v1',
        JSON.stringify({
          v: 1,
          tables: [{ asOf: '2026-10-15', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.95, EUR: 12, RUB: 0.121 }, source: 'nbt', fetchedAt: '2026-10-15T08:00:00.000Z' }],
          manual: {},
          lastRefreshAt: '2026-10-15T08:00:00.000Z',
          lastAttemptAt: '2026-10-15T08:00:00.000Z',
          lastError: null,
        }),
      );
    } catch {
      /* без хранилища курсов не будет */
    }
  });
}

async function addDebt(page: Page, name: string, amount: string): Promise<void> {
  await goSection(page, 'Долги');
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill(name);
  await tapAmount(page, amount);
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Блоки главной по порядку — только те, в которых сейчас что-то есть (пустой блок места не занимает). */
const homeBlocks = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-grid] > [data-home-block]'))
      .filter((el) => el.childElementCount > 0 && el.dataset['homeBlock'] !== 'first')
      .map((el) => el.dataset['homeBlock'] ?? ''),
  );

/** Блоки в списке «На главной» настройки, по порядку. */
const shownRows = (page: Page): Promise<string[]> =>
  page.getByTestId('home-edit-shown').locator('> li').evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('home-edit-row-', '')));

const handle = (page: Page, title: string) => page.getByRole('button', { name: `Переместить: ${title}`, exact: true });
const toggle = (page: Page, title: string) => page.getByRole('switch', { name: `Показывать на главной: ${title}`, exact: true });

async function openEditor(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Настроить главную' }).click();
  await expect(page).toHaveURL(/#\/\?edit=1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Настройка главной' })).toBeVisible();
}

async function closeEditor(page: Page): Promise<void> {
  await page.getByTestId('home-edit-done').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Настройка главной' })).toHaveCount(0);
  await expect(page.getByTestId('home-total')).toBeVisible();
}

/** Долгое нажатие пальцем: палец лёг на элемент, полсекунды держится и отпускается (события указателя, как у настоящего касания). */
async function longPress(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('блок не найден');
  const point = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: box.x + 24, clientY: box.y + 24 };
  await target.dispatchEvent('pointerdown', point);
  await page.waitForTimeout(650);
  await target.dispatchEvent('pointerup', point);
}

/**
 * Перетаскивает блок за ручку на место другого блока (мышью, как пальцем: те же события указателя). Если цель за краем экрана,
 * блок держат у края — список едет сам, — и отпускают, когда цель показалась.
 */
async function dragTo(page: Page, title: string, target: string): Promise<void> {
  const from = handle(page, title);
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  const b = await handle(page, target).boundingBox();
  if (!a || !b) throw new Error('ручка не найдена');
  const x = a.x + a.width / 2;
  const height = page.viewportSize()?.height ?? 800;
  // место цели в странице: сама строка цели во время перетаскивания расступается, поэтому её положение запоминаем заранее
  const targetAt = b.y + b.height / 2 + (await page.evaluate(() => window.scrollY));
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 200; i++) {
    const y = targetAt - (await page.evaluate(() => window.scrollY));
    if (y > 130 && y < height - 150) {
      await page.mouse.move(x, y, { steps: 8 });
      break;
    }
    await page.mouse.move(x, y <= 130 ? 70 : height - 80, { steps: 2 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
}

test.describe('48. Настройка главной', () => {
  test('скрыть погоду и курсы, вынести долги, переставить блоки — главная меняется и помнит раскладку', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата' });
    await addTx(page, { amount: '120', category: 'Еда' });
    await dismissToasts(page);
    await addDebt(page, 'Рустам', '300');
    await goSection(page, 'Главная');

    // стандартная главная: последние операции сразу под итогом, курсы и погода парой, долгов нет
    await expect(page.getByTestId('home-total')).toBeVisible();
    expect(await homeBlocks(page)).toEqual(['hero', 'recent', 'wallets', 'rates', 'weather', 'budgets']);
    await expect(page.getByTestId('debts-card')).toHaveCount(0);
    const rates = await page.getByTestId('home-rates').boundingBox();
    const weather = await page.getByTestId('home-weather').boundingBox();
    expect(Math.abs((rates?.y ?? 0) - (weather?.y ?? 1e9)), 'курсы и погода стоят в одном ряду').toBeLessThan(2);
    await noHorizontalScroll(page);
    await shot(page, '48-home-standard', testInfo);

    await openEditor(page);
    await noHorizontalScroll(page);
    await shot(page, '48-editor', testInfo);

    // погода и курсы уходят вниз, в «Можно добавить»
    await toggle(page, 'Погода').click();
    await toggle(page, 'Курсы валют').click();
    await expect(page.getByTestId('home-edit-hidden').getByTestId('home-edit-row-weather')).toBeVisible();
    await expect(page.getByTestId('home-edit-hidden').getByTestId('home-edit-row-rates')).toBeVisible();

    // долги выносим на главную
    await toggle(page, 'Долги').click();
    await expect(page.getByTestId('home-edit-shown').getByTestId('home-edit-row-debts')).toBeVisible();

    // «Долги» — сразу под итог: перетаскиванием снизу на место «Шаблонов» (вторая строка; список по дороге едет сам)
    await dragTo(page, 'Долги', 'Шаблоны');
    await expect.poll(() => shownRows(page).then((r) => r.slice(0, 2))).toEqual(['hero', 'debts']);
    // и стрелками: кошельки поднимаем на одну строку — над последними операциями
    const before = await shownRows(page);
    await handle(page, 'Кошельки').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => shownRows(page).then((r) => r.indexOf('wallets'))).toBe(before.indexOf('wallets') - 1);
    await expect(handle(page, 'Кошельки')).toBeFocused();
    await shot(page, '48-editor-changed', testInfo);

    await closeEditor(page);
    // блок долгов подгружается отдельным файлом — ждём, пока он появится
    await expect.poll(() => homeBlocks(page)).toEqual(['hero', 'debts', 'wallets', 'recent', 'budgets']);
    await expect(page.getByTestId('home-rates')).toHaveCount(0);
    await expect(page.getByTestId('home-weather')).toHaveCount(0);
    expect(norm(await page.getByTestId('home-debts-lent').innerText())).toBe('Мне должны 300 с.');
    await noHorizontalScroll(page);
    await shot(page, '48-home-custom', testInfo);

    // раскладка лежит в настройках: после перезагрузки главная та же
    await page.reload();
    await expect(page.getByTestId('home-total')).toBeVisible();
    await expect.poll(() => homeBlocks(page)).toEqual(['hero', 'debts', 'wallets', 'recent', 'budgets']);

    // блок долгов ведёт в «Долги» на свою вкладку
    await page.getByTestId('home-debts-lent').click();
    await expect(page).toHaveURL(/#\/debts\?dir=lent$/);
  });

  test('готовые наборы и сброс: «Минимум» оставляет итог, операции и кошельки; «Отменить» и «Сбросить» возвращают как было', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addTx(page, { amount: '120', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const standard = await homeBlocks(page);

    await openEditor(page);
    const presets = page.getByRole('group', { name: 'Готовые наборы' });
    await expect(presets.getByRole('button', { name: /^Стандартная/ })).toHaveAttribute('aria-pressed', 'true');
    await presets.getByRole('button', { name: /^Минимум/ }).click();
    await expect(presets.getByRole('button', { name: /^Минимум/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await shownRows(page)).toEqual(['hero', 'attention', 'recent', 'wallets']);
    await shot(page, '48-editor-minimal', testInfo);

    // «Отменить» в тосте возвращает прежнюю раскладку
    await page.getByRole('status').filter({ hasText: 'набор «Минимум»' }).getByRole('button', { name: 'Отменить' }).click();
    await expect(presets.getByRole('button', { name: /^Стандартная/ })).toHaveAttribute('aria-pressed', 'true');

    // «Операции внизу» — главная, какой она была раньше: последние операции в самом конце
    await presets.getByRole('button', { name: /^Операции внизу/ }).click();
    await dismissToasts(page);
    await expect.poll(() => shownRows(page).then((r) => r.at(-1))).toBe('recent');

    // «Всё»: на главной появляются и новые блоки
    await presets.getByRole('button', { name: /^Всё/ }).click();
    await dismissToasts(page);
    await expect(page.getByTestId('home-edit-hidden')).toHaveCount(0);
    await closeEditor(page);
    await expect(page.getByTestId('today-card')).toContainText('1 операция');
    await expect(page.getByTestId('spending-card')).toBeVisible();
    await expect(page.getByTestId('debts-card')).toContainText('Открытых долгов нет');
    await expect(page.getByTestId('goals-card')).toContainText('Целей пока нет');
    await expect(page.getByTestId('shopping-card')).toContainText('Список пуст');
    await expect(page.getByTestId('home-shortcuts')).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByTestId('spending-card').scrollIntoViewIfNeeded();
    await shot(page, '48-home-all', testInfo);

    // «Сбросить» возвращает стандартную главную
    await openEditor(page);
    await page.getByRole('button', { name: 'Сбросить' }).click();
    await dismissToasts(page);
    await expect(page.getByRole('button', { name: 'Сбросить' })).toHaveCount(0);
    await closeEditor(page);
    await expect.poll(() => homeBlocks(page)).toEqual(standard);
  });

  test('вход из «Настроек»: строка «Главный экран» открывает настройку, «Готово» возвращает в «Настройки»', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await page.getByTestId('settings-home-edit').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройка главной' })).toBeVisible();
    await page.getByTestId('home-edit-done').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
  });

  test('долгое нажатие на блок: «Скрыть с главной» убирает его без захода в настройку, «Отменить» возвращает', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addTx(page, { amount: '120', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const weather = page.getByTestId('home-weather');
    await expect(weather).toBeVisible();

    // палец лёг на блок и держится полсекунды
    await longPress(page, weather);
    const menu = sheet(page, 'Погода');
    await expect(menu).toBeVisible();
    await shot(page, '48-block-menu', testInfo);
    await menu.getByRole('button', { name: 'Скрыть с главной' }).click();
    await expect(weather).toHaveCount(0);
    await expect(page.getByText('Блок «Погода» скрыт с главной')).toBeVisible();
    // одинокая половина растянулась: курсы теперь во всю ширину
    const rates = await page.getByTestId('home-rates').boundingBox();
    const total = await page.getByTestId('home-total').boundingBox();
    expect(Math.abs((rates?.width ?? 0) - (total?.width ?? 1e9))).toBeLessThan(2);

    await page.getByRole('status').filter({ hasText: 'скрыт с главной' }).getByRole('button', { name: 'Отменить' }).click();
    await expect(weather).toBeVisible();
  });

  test('валюты блока курсов: выбор из меню блока сразу виден на главной и переживает перезагрузку', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addTx(page, { amount: '120', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const rows = page.getByTestId('rates-widget').getByTestId('rates-widget-row');
    await expect(rows).toHaveCount(2);

    await longPress(page, page.getByTestId('home-rates'));
    await sheet(page, 'Курсы валют').getByRole('button', { name: 'Выбрать валюты' }).click();
    const picker = sheet(page, 'Валюты блока курсов');
    await expect(picker).toBeVisible();
    await picker.getByRole('checkbox', { name: 'EUR, Евро' }).click();
    await expect(picker.getByRole('checkbox', { name: 'EUR, Евро' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, '48-currencies', testInfo);
    await picker.getByRole('button', { name: 'Готово' }).click();
    await expect(picker).toBeHidden();

    await expect(rows).toHaveCount(3);
    expect(norm(await rows.nth(1).innerText())).toBe('1 EUR 12,00 с.');
    await noHorizontalScroll(page);
    await page.reload();
    await expect(page.getByTestId('rates-widget').getByTestId('rates-widget-row')).toHaveCount(3);
  });

  test('новая операция: строка подсвечена в «Последних операциях», «Открыть» в сообщении показывает её', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Главная');
    await addTx(page, { amount: '45', category: 'Транспорт' });
    // строка новой операции на главной подсвечена
    const fresh = page.locator('section[aria-labelledby="home-recent"] [data-fresh="true"]');
    await expect(fresh).toHaveCount(1);
    await expect(fresh).toContainText('Транспорт');
    await shot(page, '48-fresh-row', testInfo);
    // в сообщении «Сохранено» — «Открыть» и «Отменить»
    const toast = page.getByRole('status').filter({ hasText: 'Сохранено' });
    await expect(toast.getByRole('button', { name: 'Отменить' })).toBeVisible();
    await toast.getByRole('button', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/#\/edit\/[0-9a-f-]+$/);
    await expect(sheet(page, 'Правка операции')).toBeVisible();
    await noHorizontalScroll(page);
  });
});
