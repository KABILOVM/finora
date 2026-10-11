import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createWallet, dismissInstallPrompt, expect, goSection, openApp, shot, test, waitReady } from '../helpers';

/** Сценарии пошаговой настройки (мастера) нового человека. Локальный режим: облака нет. */

const KEY = 'finora:onboarding:v1:10ca1de0-0000-4000-8000-000000000001';
const wizard = (page: Page) => page.getByRole('dialog', { name: 'Настройка Finora' });
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);
/** Содержимое шага влезает без внутренней прокрутки вниз. */
const fitsWithoutScroll = (page: Page) =>
  page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Настройка Finora"]');
    const body = dlg?.querySelector('.overflow-y-auto');
    return body ? body.scrollHeight <= body.clientHeight + 1 : true;
  });
const next = (page: Page) => wizard(page).getByRole('button', { name: 'Дальше', exact: true }).click();
const stepLabel = (page: Page, n: number) => expect(wizard(page).getByText(`Шаг ${n} из 5`)).toBeVisible();

test.use({ showOnboarding: true });

test.describe('26. Пошаговая настройка после регистрации', () => {
  test('с нуля: валюта, кошельки, категории, включения, «Готово!» — и больше не показывается', async ({ page }, testInfo) => {
    await openApp(page, '/', { onboarding: true });
    await shot(page, '26-start', testInfo);
    await expect(wizard(page).getByRole('heading', { name: 'Как начнём?' })).toBeVisible();
    await expect(wizard(page).getByRole('button', { name: /Перенести из другого приложения/ })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await wizard(page).getByRole('button', { name: /Создать с нуля/ }).click();

    // 1. Валюта
    await stepLabel(page, 1);
    await expect(wizard(page).getByRole('heading', { name: 'Основная валюта' })).toBeVisible();
    const currency = wizard(page).getByRole('combobox', { name: 'Валюта' });
    await expect(currency).toHaveValue('TJS');
    await currency.selectOption('USD');
    await shot(page, '26-currency', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    await next(page);

    // 2. Кошельки: стартовый «Наличные» уже есть и показан, в долларах (как основная)
    await stepLabel(page, 2);
    const list = wizard(page).getByRole('list', { name: 'Заведённые кошельки' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Наличные');
    await expect(wizard(page).getByRole('button', { name: 'Далее' })).toHaveCount(0);
    await wizard(page).getByRole('group', { name: 'Быстрый выбор' }).getByRole('button', { name: 'Карта', exact: true }).click();
    await expect(wizard(page).getByRole('textbox', { name: 'Название' })).toHaveValue('Карта');
    await wizard(page).getByRole('textbox', { name: /^Начальный остаток/ }).fill('150');
    await shot(page, '26-wallets', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    await wizard(page).getByRole('button', { name: 'Добавить кошелёк' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Карта');
    // подсказка «Карта» исчезла: такой кошелёк уже есть
    await expect(wizard(page).getByRole('group', { name: 'Быстрый выбор' }).getByRole('button', { name: 'Карта', exact: true })).toHaveCount(0);
    // лишний можно убрать
    await wizard(page).getByRole('button', { name: 'Убрать «Карта»' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await wizard(page).getByRole('group', { name: 'Быстрый выбор' }).getByRole('button', { name: 'Карта', exact: true }).click();
    await wizard(page).getByRole('textbox', { name: /^Начальный остаток/ }).fill('150');
    await wizard(page).getByRole('button', { name: 'Добавить кошелёк' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await next(page);

    // 3. Категории
    await stepLabel(page, 3);
    const cats = wizard(page).getByRole('list', { name: 'Категории расходов' });
    const fun = cats.getByRole('button', { name: 'Развлечения' });
    await expect(fun).toHaveAttribute('aria-pressed', 'true');
    await fun.click();
    await expect(fun).toHaveAttribute('aria-pressed', 'false');
    await shot(page, '26-categories', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    await wizard(page).getByRole('button', { name: 'Добавить свою' }).click();
    const sheet = page.getByRole('dialog', { name: 'Новая категория расходов' });
    await sheet.getByRole('textbox', { name: 'Название' }).fill('Спорт');
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(cats.getByRole('button', { name: 'Спорт', exact: true })).toBeVisible();
    await next(page);

    // 4. Включения
    await stepLabel(page, 4);
    await wizard(page).getByRole('switch', { name: 'Замок Face ID' }).click();
    await expect(wizard(page).getByRole('switch', { name: 'Замок Face ID' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, '26-extras', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    await next(page);

    // 5. Готово
    await stepLabel(page, 5);
    await expect(wizard(page).getByRole('heading', { name: 'Готово!' })).toBeVisible();
    await expect(wizard(page).getByText('USD')).toBeVisible();
    await expect(wizard(page).getByTestId('onb-wallet-count')).toHaveText('2 кошелька');
    await expect(wizard(page).getByTestId('onb-category-count')).toHaveText('17 категорий'); // 17 стартовых − «Развлечения» + «Спорт»
    await expect(wizard(page).getByText('замок Face ID')).toBeVisible();
    await shot(page, '26-finish', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    await wizard(page).getByRole('button', { name: 'На главную' }).click();
    await expect(wizard(page)).toHaveCount(0);
    await dismissInstallPrompt(page);
    await waitReady(page);
    await expect(page.getByRole('region', { name: 'Кошельки' })).toContainText('Карта');

    // Больше не показывается
    await page.reload();
    await waitReady(page);
    await expect(wizard(page)).toHaveCount(0);
  });

  test('«Готово!» → «Внести первую операцию» открывает окно новой операции', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: /Создать с нуля/ }).click();
    for (let i = 0; i < 4; i++) await next(page);
    await stepLabel(page, 5);
    await wizard(page).getByRole('button', { name: 'Внести первую операцию' }).click();
    await expect(page.getByRole('dialog', { name: 'Новая операция' })).toBeVisible();
    await expect(wizard(page)).toHaveCount(0);
  });

  test('перенос из Zenmoney ведёт на /import; после импорта мастер завершён', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: /Перенести из другого приложения/ }).click();
    await expect(wizard(page).getByRole('button', { name: /Из своей копии Finora \(JSON\)/ })).toBeVisible();
    await wizard(page).getByRole('button', { name: /Из Zenmoney \(файл CSV\)/ }).click();
    await expect(page).toHaveURL(/#\/import$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Импорт из Zenmoney' })).toBeVisible();
    await expect(wizard(page)).toHaveCount(0);

    // Загружаем файл и подтверждаем
    const csv = readFileSync(join(process.cwd(), 'src', 'import', '__fixtures__', 'basic.csv'));
    await page.getByLabel('Файл Zenmoney').setInputFiles({ name: 'basic.csv', mimeType: 'text/csv', buffer: csv });
    await expect(page.getByRole('region', { name: 'Итоги разбора файла' })).toBeVisible();
    await page.getByRole('textbox', { name: /^Курс для пересчёта в TJS \(USD\)/ }).fill('10,9');
    await page.getByRole('button', { name: /^Импортировать \d+ операци/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Импортировать', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible();

    // На «Главную» — мастера нет и не будет
    await page.goto('/#/');
    await waitReady(page);
    await expect(wizard(page)).toHaveCount(0);
    await page.reload();
    await waitReady(page);
    await expect(wizard(page)).toHaveCount(0);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.done, KEY)).toBe(true);
  });

  test('перенос не состоялся: вернулись на «Главную» — мастер на месте', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: /Перенести из другого приложения/ }).click();
    await wizard(page).getByRole('button', { name: /Из своей копии Finora \(JSON\)/ }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await page.goto('/#/');
    await expect(wizard(page).getByRole('heading', { name: 'Как начнём?' })).toBeVisible();
  });

  test('«Пропустить, настрою сам» закрывает мастер насовсем', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: 'Пропустить, настрою сам' }).click();
    await expect(wizard(page)).toHaveCount(0);
    await dismissInstallPrompt(page);
    await waitReady(page);
    await page.reload();
    await waitReady(page);
    await expect(wizard(page)).toHaveCount(0);
  });

  test('перезагрузка посреди мастера продолжает с того же шага, кошельки не дублируются', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: /Создать с нуля/ }).click();
    await next(page);
    await stepLabel(page, 2);
    await wizard(page).getByRole('textbox', { name: 'Название' }).fill('Сейф');
    await wizard(page).getByRole('button', { name: 'Добавить кошелёк' }).click();
    const list = wizard(page).getByRole('list', { name: 'Заведённые кошельки' });
    await expect(list.getByRole('listitem')).toHaveCount(2);

    await page.reload();
    await expect(wizard(page)).toBeVisible();
    await stepLabel(page, 2);
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Сейф');

    // Название вписано, но «Добавить» не нажали: «Дальше» добавит сам; повтор шага дубля не даст
    await wizard(page).getByRole('textbox', { name: 'Название' }).fill('Сейф');
    await next(page);
    await stepLabel(page, 3);
    await wizard(page).getByRole('button', { name: 'Назад' }).click();
    await stepLabel(page, 2);
    await expect(list.getByRole('listitem')).toHaveCount(2);
  });

  test('«Назад» ведёт к прошлому шагу и ничего не теряет', async ({ page }) => {
    await openApp(page, '/', { onboarding: true });
    await wizard(page).getByRole('button', { name: /Создать с нуля/ }).click();
    await wizard(page).getByRole('combobox', { name: 'Валюта' }).selectOption('EUR');
    await next(page);
    await wizard(page).getByRole('button', { name: 'Назад' }).click();
    await stepLabel(page, 1);
    await expect(wizard(page).getByRole('combobox', { name: 'Валюта' })).toHaveValue('EUR');
  });

  test('старый аккаунт с кошельком: мастера нет', async ({ page }) => {
    await openApp(page); // мастер заранее отмечен пройденным
    await createWallet(page, { name: 'Копилка', opening: '100' });
    // как будто отметки на устройстве нет (чистый браузер, но данные есть)
    await page.evaluate((k) => {
      localStorage.setItem('e2e.keepOnboarding', '1');
      localStorage.removeItem(k);
    }, KEY);
    await page.reload();
    await waitReady(page);
    await goSection(page, 'Главная');
    await expect(wizard(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.done, KEY)).toBe(true);
  });

  test('экран 320×568: все шаги без прокрутки вбок', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page, '/', { onboarding: true });
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await fitsWithoutScroll(page), 'стартовый экран влезает').toBe(true);
    await shot(page, '26-320-start', testInfo);
    await wizard(page).getByRole('button', { name: /Создать с нуля/ }).click();
    for (const [i, name] of ['currency', 'wallets', 'categories', 'extras', 'finish'].entries()) {
      await stepLabel(page, i + 1);
      expect(await noHorizontalScroll(page), `${name}: прокрутка вбок`).toBe(true);
      if (name !== 'wallets' && name !== 'categories') expect(await fitsWithoutScroll(page), `${name}: прокрутка вниз`).toBe(true);
      await shot(page, `26-320-${name}`, testInfo);
      if (name !== 'finish') await next(page);
    }
  });
});
