import type { Page } from '@playwright/test';
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
  test('скрыть погоду и курсы, вынести долги, поднять операции — главная меняется и помнит раскладку', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата' });
    await addTx(page, { amount: '120', category: 'Еда' });
    await dismissToasts(page);
    await addDebt(page, 'Рустам', '300');
    await goSection(page, 'Главная');

    // стандартная главная: курсы и погода парой, операции в самом низу, долгов нет
    await expect(page.getByTestId('home-total')).toBeVisible();
    expect(await homeBlocks(page)).toEqual(['hero', 'rates', 'weather', 'wallets', 'budgets', 'recent']);
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

    // «Последние операции» — сразу под итог: перетаскиванием на место «Шаблонов» (вторая строка)
    await dragTo(page, 'Последние операции', 'Шаблоны');
    await expect.poll(() => shownRows(page).then((r) => r.slice(0, 2))).toEqual(['hero', 'recent']);
    // и стрелками: кошельки поднимаем на одну строку
    const before = await shownRows(page);
    await handle(page, 'Кошельки').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => shownRows(page).then((r) => r.indexOf('wallets'))).toBe(before.indexOf('wallets') - 1);
    await expect(handle(page, 'Кошельки')).toBeFocused();
    await shot(page, '48-editor-changed', testInfo);

    await closeEditor(page);
    // блок долгов подгружается отдельным файлом — ждём, пока он появится
    await expect.poll(() => homeBlocks(page)).toEqual(['hero', 'recent', 'wallets', 'budgets', 'debts']);
    await expect(page.getByTestId('home-rates')).toHaveCount(0);
    await expect(page.getByTestId('home-weather')).toHaveCount(0);
    expect(norm(await page.getByTestId('home-debts-lent').innerText())).toBe('Мне должны 300 с.');
    await noHorizontalScroll(page);
    await shot(page, '48-home-custom', testInfo);

    // раскладка лежит в настройках: после перезагрузки главная та же
    await page.reload();
    await expect(page.getByTestId('home-total')).toBeVisible();
    await expect.poll(() => homeBlocks(page)).toEqual(['hero', 'recent', 'wallets', 'budgets', 'debts']);

    // блок долгов ведёт в «Долги» на свою вкладку
    await page.getByTestId('home-debts-lent').click();
    await expect(page).toHaveURL(/#\/debts\?dir=lent$/);
  });

  test('готовые наборы и сброс: «Минимум» оставляет итог, кошельки и операции; «Отменить» и «Сбросить» возвращают как было', async ({ page }, testInfo) => {
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
    expect(await shownRows(page)).toEqual(['hero', 'attention', 'wallets', 'recent']);
    await shot(page, '48-editor-minimal', testInfo);

    // «Отменить» в тосте возвращает прежнюю раскладку
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(presets.getByRole('button', { name: /^Стандартная/ })).toHaveAttribute('aria-pressed', 'true');

    // «Всё»: на главной появляются и новые блоки
    await presets.getByRole('button', { name: /^Всё/ }).click();
    await dismissToasts(page);
    await expect(page.getByTestId('home-edit-hidden')).toHaveCount(0);
    await closeEditor(page);
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
});
