import type { Locator, Page } from '@playwright/test';
import {
  addTx, createWallet, dismissToasts, expect, goSection, isPhone, money, norm, openApp, shot, sheet, tapAmount, test,
} from '../helpers';

/**
 * «Сегодня» на странице закреплено: 15 октября 2026 (14:00 в Душанбе). До конца месяца 17 дней (15…31).
 * Это даёт точные ожидаемые цифры: 2 600 с. ÷ 17 = 152,94 с. (вниз).
 */
const NOW = new Date('2026-10-15T09:00:00Z');

async function pinClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
}

const limitRow = (page: Page, name: string): Locator => page.getByRole('button', { name: new RegExp(`^Лимит «${name}»`) });
const perDay = (page: Page): Locator => page.getByTestId('forecast-per-day');

/** Добавить лимит через шит: «на что» (чип) и сумма на экранной клавиатуре. */
async function addLimit(page: Page, scope: 'Все расходы' | string, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
  const dlg = sheet(page, 'Новый лимит');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: scope });
  await tapAmount(page, amount);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('16. Бюджеты и «сколько можно тратить в день»', () => {
  test('пустой экран зовёт поставить лимит; прогноз считается по остаткам; лимит на всё и на категорию', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await addTx(page, { amount: '400', category: 'Еда' });
    await dismissToasts(page);

    await goSection(page, 'Бюджеты');
    await expect(page.getByRole('heading', { level: 2, name: 'Лимитов пока нет' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Поставить первый лимит' })).toBeVisible();
    // 3 000 − 400 = 2 600 на 17 дней: 152,94 (вниз), приблизительности нет
    await expect(perDay(page)).toContainText(money('152,94 с.'));
    await expect(perDay(page)).not.toContainText('≈');
    const card = page.getByTestId('forecast-card');
    await expect(card).toContainText('Осталось на день');
    await expect(card).toContainText('Считаем до 31 октября: 17 дней включая сегодня');
    await expect(card).toContainText('Деньги на руках');

    // «Как это считается» раскрывается простыми словами
    const how = page.getByRole('button', { name: 'Как это считается' });
    await expect(how).toHaveAttribute('aria-expanded', 'false');
    await how.click();
    await expect(how).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toContainText('округляем вниз');
    await how.click();

    await addLimit(page, 'Все расходы', '2000');
    await expect(limitRow(page, 'Все расходы')).toContainText('Потрачено 20%');
    await addLimit(page, 'Еда', '500');
    const food = limitRow(page, 'Еда');
    await expect(food).toContainText('Потрачено 80%');
    await expect(food).toContainText('Внимание: больше 70%');
    await expect(food).toContainText(money('Осталось 100 с.'));
    await expect(page.getByRole('progressbar', { name: 'Еда: Потрачено 80%' })).toHaveAttribute('aria-valuenow', '80');
    await shot(page, '16-budgets-warn', testInfo);

    // 90% → «Почти исчерпан»; ровно 100% → «Лимит исчерпан»; дальше — «Превышен на …»
    await addTx(page, { amount: '50', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await expect(food).toContainText('Потрачено 90%');
    await expect(food).toContainText('Почти исчерпан');
    await addTx(page, { amount: '50', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await expect(food).toContainText('Потрачено 100%');
    await expect(food).toContainText('Лимит исчерпан');
    await addTx(page, { amount: '25', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await expect(food).toContainText('Потрачено 105%');
    await expect(food).toContainText('Лимит превышен');
    await expect(food).toContainText(money('Превышен на 25 с.'));
    await shot(page, '16-budgets-over', testInfo);

    // «Без лимита» нет: все расходы — это Еда, и она под лимитом
    await expect(page.getByRole('listitem').filter({ hasText: 'Без лимита' })).toHaveCount(0);

    // «Главная»: виджет с тем же числом и самыми горячими лимитами
    await goSection(page, 'Главная');
    const widget = page.getByTestId('budgets-widget');
    await expect(widget).toBeVisible();
    await expect(widget).toContainText('Можно тратить в день');
    // 3 000 − 525 = 2 475 на 17 дней = 145,58 (вниз)
    await expect(page.getByTestId('widget-per-day')).toContainText(money('145,58 с.'));
    const rows = widget.getByRole('list', { name: 'Лимиты на месяц' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Все расходы');
    await expect(rows.nth(1)).toContainText('Еда');
    await expect(rows.nth(1)).toContainText('Потрачено 105%');
    await shot(page, '16-home-widget', testInfo);
    await widget.getByRole('link', { name: 'Все бюджеты' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Бюджеты' })).toBeVisible();
  });

  test('повторный лимит на ту же категорию меняет сумму; правка; архив и возврат; месяцы листаются', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
    await addTx(page, { amount: '300', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await addLimit(page, 'Еда', '500');
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 60%');

    // повторное добавление: человеку сказано, что лимит уже есть и сумма будет изменена
    await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
    const dlg = sheet(page, 'Новый лимит');
    await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: 'Еда' });
    await expect(dlg.getByText('Лимит на эту категорию уже есть — изменим сумму.')).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Сумма лимита/ })).toHaveValue('500');
    await shot(page, '16-sheet-existing', testInfo);
    for (let i = 0; i < 3; i++) await dlg.getByRole('button', { name: 'Стереть' }).click();
    await tapAmount(page, '400');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByRole('button', { name: /^Лимит «Еда»/ })).toHaveCount(1); // не два лимита на одну категорию
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 75%');

    // правка суммы через строку
    await limitRow(page, 'Еда').click();
    const edit = sheet(page, 'Лимит: Еда');
    await expect(edit).toBeVisible();
    for (let i = 0; i < 3; i++) await edit.getByRole('button', { name: 'Стереть' }).click();
    await tapAmount(page, '1200');
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 25%');

    // архив: строка уходит, лимит ждёт в «Архиве», возврат кнопкой
    await limitRow(page, 'Еда').click();
    await sheet(page, 'Лимит: Еда').getByRole('button', { name: 'Убрать в архив' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Лимитов пока нет' })).toBeVisible();
    await dismissToasts(page);
    await page.getByRole('button', { name: /^Архив · 1 лимит/ }).click();
    await page.getByRole('button', { name: 'Вернуть: Еда' }).click();
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 25%');
    await dismissToasts(page);

    // месяцы: в сентябре трат не было — настоящий ноль; вперёд дальше текущего не пускает
    await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByText('Сентябрь 2026')).toBeVisible();
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 0%');
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 25%');

    // после перезагрузки всё на месте
    await page.reload();
    await expect(limitRow(page, 'Еда')).toContainText('Потрачено 25%');
  });

  test('валюта без курса честно не входит в прогноз; комиссия перевода — «Комиссии» на «Главной» и в «Без лимита»', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '100' });
    await createWallet(page, { name: 'Карта' });
    await dismissToasts(page);

    await goSection(page, 'Бюджеты');
    // доллары без курса в расчёт не входят, это сказано, а число помечено «≈»
    await expect(perDay(page)).toContainText(money('≈ 176,47 с.')); // 3 000 ÷ 17
    const card = page.getByTestId('forecast-card');
    await expect(card).toContainText('Не вошло в расчёт — нет курса');
    await expect(card).toContainText(money('100 $'));
    await shot(page, '16-forecast-no-rate', testInfo);
    await addLimit(page, 'Еда', '500');

    // перевод с комиссией: 100 списано, 98 получено — 2 с. комиссии
    await addTx(page, { kind: 'transfer', amount: '100', wallet: 'Наличные', toWallet: 'Карта', received: '98' });
    await dismissToasts(page);

    await goSection(page, 'Главная');
    const fee = page.getByRole('listitem').filter({ hasText: 'Комиссии' });
    await expect(fee).toHaveCount(1);
    await expect(fee).toContainText(money('2 с.'));
    await expect(fee).not.toContainText('Без категории');

    await goSection(page, 'Бюджеты');
    const unlimited = page.getByRole('listitem').filter({ hasText: 'Без лимита' });
    await expect(unlimited).toContainText(money('2 с.'));
    await expect(unlimited).toContainText('комиссии');
    // комиссия — тоже расход: деньги на руках 3 000 − 2 = 2 998 → 176,35 в день
    await expect(perDay(page)).toContainText(money('176,35 с.'));
  });

  test('экран и виджет не ломают раскладку: нет горизонтальной прокрутки, «Добавить лимит» на экране, шит помещается', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '9999999,99', category: 'Зарплата' });
    await addTx(page, { amount: '1234567,89', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Бюджеты');
    await addLimit(page, 'Все расходы', '9999999');
    await addLimit(page, 'Еда', '1000000');

    const vp = page.viewportSize()!;
    const overflow = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    for (const where of ['Бюджеты', 'Главная'] as const) {
      await goSection(page, where);
      const o = await overflow();
      expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
    }
    await goSection(page, 'Бюджеты');
    await shot(page, '16-budgets-long-amounts', testInfo);
    const add = await page.getByRole('button', { name: 'Добавить лимит', exact: true }).boundingBox();
    expect(add, 'кнопка «Добавить лимит» видна').not.toBeNull();
    expect(add!.x + add!.width).toBeLessThanOrEqual(vp.width);

    // шит: «Сохранить» и клавиатура помещаются в экран
    await page.getByRole('button', { name: 'Добавить лимит', exact: true }).click();
    const dlg = sheet(page, 'Новый лимит');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('combobox', { name: 'На что лимит' }).selectOption({ label: 'Транспорт' });
    await tapAmount(page, '123');
    const save = await dlg.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox();
    expect(save, 'кнопка «Сохранить» видна').not.toBeNull();
    expect(save!.y + save!.height).toBeLessThanOrEqual(vp.height);
    await shot(page, isPhone(page) ? '16-sheet-phone' : '16-sheet-desktop', testInfo);
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    expect(norm(await page.getByTestId('forecast-per-day').innerText())).toMatch(/\d/);
  });
});
