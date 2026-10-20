import type { Locator, Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, isPhone, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026, 14:00 в Душанбе. */
const NOW = new Date('2026-10-15T09:00:00Z');

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (window.visualViewport?.width ?? window.innerWidth) + 1)).toBe(true);

async function addDebt(page: Page, name: string, amount: string, date: string, due: string): Promise<void> {
  await goSection(page, 'Долги');
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill(name);
  await tapAmount(page, amount);
  await dlg.getByRole('group', { name: 'Дата долга' }).getByRole('button', { name: 'Другая дата' }).click();
  await dlg.getByLabel('Дата долга: календарь').fill(date);
  await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
  await dlg.getByLabel('Срок возврата: календарь').fill(due);
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

async function addRule(page: Page, amount: string, note: string, start: string): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(amount);
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(note);
  await dlg.getByLabel('Первый платёж').fill(start);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
}

async function addLimit(page: Page, scope: string, amount: string): Promise<void> {
  await goSection(page, 'Бюджеты');
  await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
  const dlg = sheet(page, 'Новый лимит');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: scope });
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Накопления «Отпуск» с целью 3000 и 10% накоплено. */
async function addGoalWallet(page: Page): Promise<void> {
  await goSection(page, 'Кошельки');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dlg = sheet(page, 'Новый кошелёк');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Название' }).fill('Отпуск');
  await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
  await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('3000');
  await dlg.getByRole('textbox', { name: /^Начальный остаток/ }).fill('300');
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

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

const attention = (page: Page): Locator => page.getByTestId('attention-row');

test.describe('39. Главная: компактная, с «Требует внимания»', () => {
  test('богатые данные: просроченный долг и платёж, превышенный лимит → строка внимания; блоки на месте; снимки', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await prepareRates(page);
    await openApp(page);
    await addGoalWallet(page);
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата' });
    await addTx(page, { amount: '1500', category: 'Еда' });
    await dismissToasts(page);
    await addLimit(page, 'Все расходы', '1000'); // потрачено 150% → «Лимит превышен»
    await addDebt(page, 'Рустам', '300', '2026-09-01', '2026-10-10'); // просрочен на 5 дней
    await addRule(page, '80', 'Интернет', '2026-10-12'); // просрочен на 3 дня
    await addRule(page, '45', 'Подписка', '2026-10-16');
    await goSection(page, 'Главная');

    // верхняя карточка: сумма, приход и расход месяца капсулами, без кнопок «Расход/Доход/Перевод»
    const hero = page.getByTestId('home-total');
    await expect(hero).toBeVisible();
    await expect(page.getByTestId('home-flow-income')).toContainText('5 000');
    await expect(page.getByTestId('home-flow-expense')).toContainText('1 500');
    await expect(hero.getByRole('link', { name: 'Расход' })).toHaveCount(0);

    // «Требует внимания»: первый пункт и «+2», по нажатию раскрывается список ссылок
    const row = attention(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Долг просрочен: Рустам');
    await expect(row).toContainText('+2');
    await row.getByRole('button').click();
    await expect(row.getByRole('link', { name: /Платёж просрочен/ })).toBeVisible();
    await expect(row.getByRole('link', { name: /Лимит превышен/ })).toBeVisible();

    // полоса «Курсы и погода»
    await expect(page.getByTestId('home-glance')).toBeVisible();
    await expect(page.getByTestId('rates-widget')).toContainText('USD');

    // кошельки чипами, лимиты и платежи компактно; долгов, целей и итогов месяца на главной больше нет
    const wallets = page.getByRole('region', { name: 'Кошельки' });
    await expect(wallets.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('budgets-widget')).toContainText('Можно тратить в день');
    await expect(page.getByTestId('widget-per-day')).toBeVisible();
    // общий лимит превышен: крупно 0, а не цифра по деньгам на руках, и сказано почему
    await expect.poll(async () => norm(await page.getByTestId('widget-per-day').innerText())).toBe('0 с.');
    await expect(page.getByTestId('budgets-widget')).toContainText('Лимит месяца превышен на');
    await expect(page.getByRole('region', { name: 'Ближайшие платежи' })).toBeVisible();
    await expect(page.getByTestId('debts-widget')).toHaveCount(0);
    await expect(page.getByTestId('goals-widget')).toHaveCount(0);
    await expect(page.locator('[aria-label="Итоги месяца"]')).toHaveCount(0);

    // длина страницы заметно короче прежних ~2800 px; без горизонтальной прокрутки
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    testInfo.annotations.push({ type: 'height', description: String(height) });
    expect(height).toBeLessThan(isPhone(page) ? 1700 : 1500);
    await noHorizontalScroll(page);
    await dismissToasts(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '39-home-top', testInfo);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await shot(page, '39-home-bottom', testInfo);
    // переключателя темы в шапке телефона больше нет: тема — в «Настройки → Оформление»
    await goSection(page, 'Настройки');
    await page.getByRole('radio', { name: 'Тёмная', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await goSection(page, 'Главная');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await shot(page, '39-home-top-dark', testInfo);
  });

  test('«Скрыть суммы» прячет суммы на всей главной, а не только в верхней карточке', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '5000', category: 'Зарплата' });
    await addTx(page, { amount: '400', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const text = async () => norm(await page.getByRole('main').innerText());
    expect(await text()).toMatch(/4 600/);
    await page.getByRole('button', { name: 'Скрыть суммы' }).click();
    const hidden = await text();
    expect(hidden).not.toMatch(/4 600/);
    expect(hidden).not.toMatch(/5 000/);
    expect(hidden).not.toMatch(/400/);
    await expect(page.getByRole('button', { name: 'Показать суммы' })).toBeVisible();
    await page.getByRole('button', { name: 'Показать суммы' }).click();
    expect(await text()).toMatch(/4 600/);
  });

  test('спокойно: ни долгов, ни просрочек — строки «Требует внимания» нет, а блоки не прыгают', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    // деньги на руках есть (доход больше траты): иначе честно появилось бы «Денег не хватит с …»
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
    await addTx(page, { amount: '50', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    await expect(page.getByTestId('home-total')).toBeVisible();
    await expect(attention(page)).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});
