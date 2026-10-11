import { addTx, createWallet, dismissToasts, expect, goSection, isoMonthsAgo, openApp, shot, sheet, test } from '../helpers';
import type { Page } from '@playwright/test';

/** Строки операций в списке (кнопки внутри дней-«регионов»). */
const rows = (page: Page) => page.getByRole('region').getByRole('button');
const filtersButton = (page: Page) => page.getByRole('button', { name: /^Фильтры/ });

async function seed(page: Page) {
  await openApp(page);
  await createWallet(page, { name: 'Карта' });
  const prev = await isoMonthsAgo(page, 1);
  const old = await isoMonthsAgo(page, 2);
  await addTx(page, { amount: '10', category: 'Еда', wallet: 'Наличные', note: 'кофе утром' });
  await addTx(page, { amount: '20', category: 'Транспорт', wallet: 'Карта', note: 'такси домой' });
  await addTx(page, { kind: 'income', amount: '500', category: 'Зарплата', wallet: 'Карта', note: 'аванс' });
  await addTx(page, { amount: '30', category: 'Продукты', wallet: 'Наличные', note: 'рынок', date: prev });
  await addTx(page, { amount: '40', category: 'Связь', wallet: 'Наличные', note: 'интернет', date: old });
  await dismissToasts(page);
  await goSection(page, 'Операции');
}

test.describe('7. Фильтры «Операций»', () => {
  test('период: этот месяц, прошлый, всё время, другой месяц', async ({ page }, testInfo) => {
    await seed(page);
    await expect(page.getByRole('button', { name: 'Этот месяц' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByText('кофе утром')).toBeVisible();
    await expect(page.getByText('рынок')).toHaveCount(0);

    await page.getByRole('button', { name: 'Прошлый' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('рынок')).toBeVisible();

    await page.getByRole('button', { name: 'Всё время' }).click();
    await expect(rows(page)).toHaveCount(5);
    await shot(page, '07-all-time', testInfo);

    await page.getByRole('button', { name: 'Другой месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('интернет')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeEnabled();
  });

  test('шит «Фильтры»: кошелёк, вид, категория, «Применить» и «Сбросить»; закрытие без «Применить» ничего не меняет', async ({ page }, testInfo) => {
    await seed(page);
    await page.getByRole('button', { name: 'Всё время' }).click();
    await expect(rows(page)).toHaveCount(5);

    // Закрыли без «Применить» — список прежний
    await filtersButton(page).click();
    let dlg = sheet(page, 'Фильтры');
    await dlg.getByRole('combobox', { name: 'Кошелёк' }).selectOption({ label: 'Карта' });
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    await expect(rows(page)).toHaveCount(5);
    await expect(filtersButton(page)).toHaveAccessibleName('Фильтры');

    // Кошелёк «Карта»: такси и аванс
    await filtersButton(page).click();
    dlg = sheet(page, 'Фильтры');
    await dlg.getByRole('combobox', { name: 'Кошелёк' }).selectOption({ label: 'Карта' });
    await shot(page, '07-filters-sheet', testInfo);
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(dlg).toBeHidden();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('такси домой')).toBeVisible();
    await expect(page.getByText('аванс')).toBeVisible();
    await expect(filtersButton(page)).toHaveAccessibleName('Фильтры, включено: 1');
    await expect(page.getByTestId('active-filters')).toContainText('Карта');

    // + вид «Расходы»: только такси
    await filtersButton(page).click();
    dlg = sheet(page, 'Фильтры');
    await expect(dlg.getByRole('combobox', { name: 'Кошелёк' })).toHaveValue(/.+/); // выбор помнится
    await dlg.getByRole('button', { name: 'Расходы', exact: true }).click();
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('такси домой')).toBeVisible();
    await expect(filtersButton(page)).toHaveAccessibleName('Фильтры, включено: 2');

    // «Сбросить» в шите очищает выбор, список обновится после «Применить»
    await filtersButton(page).click();
    dlg = sheet(page, 'Фильтры');
    await dlg.getByRole('button', { name: 'Сбросить' }).click();
    await expect(rows(page)).toHaveCount(1); // пока не применили — список прежний
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(filtersButton(page)).toHaveAccessibleName('Фильтры');

    // Категория «Еда»
    await filtersButton(page).click();
    dlg = sheet(page, 'Фильтры');
    await dlg.getByRole('combobox', { name: 'Категория' }).selectOption({ label: 'Еда' });
    await dlg.getByRole('button', { name: 'Применить' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('кофе утром')).toBeVisible();

    // «Сбросить» на панели под поиском
    await page.getByTestId('active-filters').getByRole('button', { name: 'Сбросить' }).click();
    await expect(rows(page)).toHaveCount(5);
  });

  test('поиск по заметке: находит, не зависит от регистра, «ничего не найдено» и «Показать всё»', async ({ page }, testInfo) => {
    await seed(page);
    const search = page.getByRole('searchbox', { name: 'Поиск по заметке' });

    await search.fill('такси');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('такси домой')).toBeVisible();

    await search.fill('КОФЕ');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('кофе утром')).toBeVisible();

    // Поиск работает вместе с периодом: «рынок» в прошлом месяце, в «Этом месяце» его нет
    await search.fill('рынок');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await shot(page, '07-search-empty', testInfo);
    await page.getByRole('button', { name: 'Показать всё' }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(search).toHaveValue('');

    await search.fill('аванс');
    await expect(rows(page)).toHaveCount(1);
    await search.fill('');
    await expect(rows(page)).toHaveCount(5); // «Показать всё» включило период «Всё время»
  });
});
