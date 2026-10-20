import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, norm, openApp, shot, sheet, test } from '../helpers';

/** Строки операций в списке (кнопки внутри дней-«регионов»). */
const rows = (page: Page) => page.getByRole('region').getByRole('button');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Поиск по операциям' });

async function seed(page: Page): Promise<void> {
  await openApp(page);
  await createWallet(page, { name: 'Карта' });
  await addTx(page, { amount: '10', category: 'Еда', wallet: 'Наличные', note: 'кофе утром' });
  await addTx(page, { amount: '20', category: 'Транспорт', wallet: 'Карта', note: 'такси домой' });
  await addTx(page, { kind: 'income', amount: '500', category: 'Зарплата', wallet: 'Карта', note: 'аванс' });
  await dismissToasts(page);
  await goSection(page, 'Операции');
}

test.describe('42. Операции: фильтры в адресе, поиск, комиссии', () => {
  test('выбранные период и кошелёк переживают уход со страницы и «Назад»', async ({ page }, testInfo) => {
    await seed(page);
    await page.getByRole('button', { name: 'Всё время' }).click();
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    const dlg = sheet(page, 'Фильтры');
    await dlg.getByRole('combobox', { name: 'Кошелёк' }).selectOption({ label: 'Карта' });
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(dlg).toBeHidden();
    await expect(rows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/#\/transactions\?period=all&wallet=/);

    await goSection(page, 'Главная');
    await expect(page.getByRole('heading', { name: 'Главная', level: 1 })).toBeVisible();
    await page.goBack();

    await expect(page.getByRole('heading', { name: 'Операции', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Всё время' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Фильтры/ })).toHaveAccessibleName('Фильтры, включено: 1');
    await expect(rows(page)).toHaveCount(2);
    await shot(page, '42-filters-after-back', testInfo);

    // вкладка «Операции» снова открывает обычный список
    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Этот месяц' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('чип кошелька на «Главной» ведёт к операциям этого кошелька за всё время', async ({ page }) => {
    await seed(page);
    await goSection(page, 'Главная');
    await page.getByRole('region', { name: 'Кошельки' }).getByRole('link', { name: /Карта/ }).click();
    await expect(page.getByRole('heading', { name: 'Операции', level: 1 })).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Всё время' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('active-filters')).toContainText('Карта');
    await expect(page.getByText('кофе утром')).toHaveCount(0);
  });

  test('поиск находит по заметке, категории, кошельку и сумме', async ({ page }, testInfo) => {
    await seed(page);
    await search(page).fill('Транспорт');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('такси домой')).toBeVisible();

    await search(page).fill('карта');
    await expect(rows(page)).toHaveCount(2); // такси и аванс лежат на «Карте»

    await search(page).fill('500');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('аванс')).toBeVisible();
    // итог периода считает найденное
    await expect(page.getByTestId('period-totals')).toContainText('500');
    await expect(page.getByTestId('period-totals')).not.toContainText('20');
    await shot(page, '42-search-amount', testInfo);

    await search(page).fill('qqqq');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Показать всё' }).click();
    await expect(search(page)).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Всё время' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(3);
  });

  test('комиссия перевода входит в итог периода и видна в строке перевода', async ({ page }, testInfo) => {
    await seed(page);
    // списали 100, получили 98: комиссия 2 с.
    await addTx(page, { kind: 'transfer', amount: '100', wallet: 'Наличные', toWallet: 'Карта', received: '98', note: 'на карту' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    const totals = page.getByTestId('period-totals');
    await expect(totals).toContainText('в расходах комиссии переводов');
    // расход: кофе 10 + такси 20 + комиссия 2 = 32
    await expect.poll(async () => norm(await totals.innerText())).toMatch(/−32 с\./);
    await expect.poll(async () => norm(await totals.innerText())).toMatch(/комиссии переводов: 2 с\./);
    await expect(page.getByRole('button', { name: /на карту/ })).toContainText('комиссия 2 с.');
    await shot(page, '42-fee-in-totals', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(600);
    await shot(page, '42-fee-in-totals-dark', testInfo);
  });
});
