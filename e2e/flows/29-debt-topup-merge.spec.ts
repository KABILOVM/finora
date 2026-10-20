import type { Locator, Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, moneyExact, monthRow, openApp, shot, sheet, tapAmount, test, waitReady, walletRowText, debtAction, openActionMenu, closeActionMenu } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026. */
const NOW = new Date('2026-10-15T09:00:00Z');

const debtLinks = (page: Page): Locator => page.getByRole('list', { name: 'Мне должны' }).getByRole('link');
const remaining = (page: Page): Locator => page.getByTestId('debt-remaining');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

/** Новый долг «Кому я дал» без предложения (имя новое): открыть шит, заполнить, сохранить. */
async function lend(page: Page, name: string, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill(name);
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('29. Добавить ещё в долг и объединение долгов', () => {
  test('тому же человеку ещё раз: плашка «Добавить к этому долгу»; отдельный долг; объединение с отменой; «Дал ещё в долг» со страницы долга', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '2000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const expensesBefore = await monthRow(page, 'Расходы');
    expect(expensesBefore).toMatch(moneyExact('0 с.'));

    // 1. первый долг Алишеру
    await goSection(page, 'Долги');
    await lend(page, 'Алишер', '500');
    await expect(debtLinks(page)).toHaveCount(1);

    // 2. тот же человек (другой регистр и пробелы): сверху плашка с остатком; добавляем к существующему долгу
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('  алишер ');
    const banner = dlg.getByTestId('debt-match');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('У вас уже есть долг «Алишер»');
    await expect(banner).toContainText(money('500 с.'));
    await shot(page, '29-debt-match', testInfo);
    await banner.getByRole('button', { name: /^Добавить к долгу «Алишер»/ }).click();
    const joined = sheet(page, 'Ещё в долг'); // после выбора шит называется «Ещё в долг»
    await expect(joined.getByTestId('debt-joined')).toContainText('Сумма добавится к долгу «Алишер»');
    await expect(joined.getByTestId('debt-joined')).not.toContainText('..');
    await tapAmount(page, '300');
    await shot(page, '29-debt-joined', testInfo);
    const vp = page.viewportSize()!;
    const save = joined.getByRole('button', { name: 'Добавить к долгу', exact: true });
    const box = await save.boundingBox();
    expect(box, 'кнопка видна').not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    await save.click();
    await expect(joined).toBeHidden();
    await dismissToasts(page);

    // один долг на 800, а не два; деньги ушли с кошелька, расходы месяца те же
    await expect(debtLinks(page)).toHaveCount(1);
    await expect(debtLinks(page).first()).toContainText(money('800 с.'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('1 200 с.')); // 2 000 − 500 − 300
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toBe(expensesBefore);

    // 3. на странице долга две выдачи
    await goSection(page, 'Долги');
    await debtLinks(page).first().click();
    await expect(remaining(page)).toContainText(money('800 с.'));
    const entries = page.getByRole('list', { name: 'Выдачи и пополнения долга' });
    await expect(entries.getByRole('listitem')).toHaveCount(2);
    await expect(entries).toContainText(money('300 с.'));
    await expect(entries).toContainText(money('500 с.'));
    await shot(page, '29-debt-entries', testInfo);
    await noHorizontalScroll(page, 'страница долга');

    // подходящих для объединения долгов пока нет — кнопки нет
    const menu29 = await openActionMenu(page);
    await expect(menu29.getByRole('button', { name: 'В архив', exact: true })).toBeVisible(); // меню открылось и заполнено
    await page.waitForTimeout(400); // другие долги читаются отдельным запросом: ждём, чтобы «нет» не прошло вхолостую
    await expect(menu29.getByRole('button', { name: 'Объединить…' })).toHaveCount(0);
    await closeActionMenu(page);

    // 4. отдельный долг тому же человеку («Создать отдельный долг»)
    await goSection(page, 'Долги');
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg2 = sheet(page, 'Новый долг');
    await dlg2.getByRole('textbox', { name: 'Кому я дал' }).fill('Алишер');
    await dlg2.getByTestId('debt-match').getByRole('button', { name: 'Создать отдельный долг' }).click();
    await expect(dlg2.getByTestId('debt-match')).toHaveCount(0);
    await tapAmount(page, '200');
    await dlg2.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg2).toBeHidden();
    await dismissToasts(page);
    await expect(debtLinks(page)).toHaveCount(2);

    // 5. объединяем: открываем долг на 800, выбран одноимённый на 200, предпросмотр 1 000
    await debtLinks(page).filter({ hasText: money('800 с.') }).first().click();
    await expect(remaining(page)).toContainText(money('800 с.'));
    await debtAction(page, 'Объединить…');
    const merge = sheet(page, 'Объединить долги');
    await expect(merge).toBeVisible();
    await expect(merge.getByRole('checkbox').first()).toBeChecked();
    await expect(merge.getByTestId('merge-preview')).toContainText(money('1 000 с.'));
    await shot(page, '29-merge-sheet', testInfo);
    await noHorizontalScroll(page, 'шит объединения');
    await merge.getByRole('button', { name: /^Объединить: 2 долга$/ }).click();
    await expect(merge).toBeHidden();
    await expect(remaining(page)).toContainText(money('1 000 с.'));
    await expect(entries.getByRole('listitem')).toHaveCount(3);

    // кошелёк не изменился: 2 000 − 500 − 300 − 200
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('1 000 с.'));

    // в списке один долг
    await goSection(page, 'Долги');
    await expect(debtLinks(page)).toHaveCount(1);
    await expect(debtLinks(page).first()).toContainText(money('1 000 с.'));

    // 6. «Дал ещё в долг» со страницы долга
    await debtLinks(page).first().click();
    await page.getByRole('button', { name: 'Дал ещё в долг', exact: true }).click();
    const top = sheet(page, 'Дал ещё в долг');
    await expect(top).toBeVisible();
    await expect(top).toContainText('сумма долга сейчас');
    await tapAmount(page, '100');
    await expect(top).toContainText('Сумма долга станет');
    await shot(page, '29-topup-sheet', testInfo);
    await top.getByRole('button', { name: 'Добавить к долгу', exact: true }).click();
    await expect(top).toBeHidden();
    await expect(remaining(page)).toContainText(money('1 100 с.'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('900 с.'));

    // после перезагрузки всё на месте
    await page.reload();
    await waitReady(page);
    await goSection(page, 'Долги');
    await expect(debtLinks(page)).toHaveCount(1);
    await expect(debtLinks(page).first()).toContainText(money('1 100 с.'));
  });

  test('«Отменить» после объединения возвращает оба долга', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '2000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await lend(page, 'Бобур', '400');
    // второй долг тому же человеку — отдельный
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Бобур');
    await dlg.getByTestId('debt-match').getByRole('button', { name: 'Создать отдельный долг' }).click();
    await tapAmount(page, '100');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await expect(debtLinks(page)).toHaveCount(2);

    await debtLinks(page).first().click();
    await debtAction(page, 'Объединить…');
    const merge = sheet(page, 'Объединить долги');
    await merge.getByRole('button', { name: /^Объединить: 2 долга$/ }).click();
    await expect(merge).toBeHidden();
    await expect(remaining(page)).toContainText(money('500 с.'));
    await page.getByRole('button', { name: 'Отменить' }).click();
    await goSection(page, 'Долги');
    await expect(debtLinks(page)).toHaveCount(2);
  });
});
