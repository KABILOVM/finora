import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, money, norm, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). Календарь — 30 дней, по 13 ноября. */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

/** Долг «на бумаге» (без движения денег) со сроком; экран «Долги» уже открыт. */
async function addDebt(page: Page, d: { name: string; amount: string; borrowed?: boolean; due: string }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  await tapAmount(page, d.amount);
  await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
  await dlg.getByLabel('Срок возврата: календарь').fill(d.due);
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Регулярный платёж-расход «раз в месяц» с первой датой start; создаётся через окно на экране «Платежи». */
async function addRule(page: Page, r: { amount: string; note: string; start: string }): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(r.amount);
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(r.note);
  await dlg.getByLabel('Первый платёж').fill(r.start);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
}

test.describe('31. Денежный календарь', () => {
  test('платёж, долг «я должен» и ожидание «мне вернут»: итог, вывод «денег не хватит», тумблеры, события по дням', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата' });
    await dismissToasts(page);
    await addRule(page, { amount: '3500', note: 'Аренда', start: '2026-10-20' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Сосед', amount: '500', borrowed: true, due: '2026-10-25' });
    await page.getByRole('radio', { name: 'Мне должны' }).click();
    await addDebt(page, { name: 'Алишер', amount: '200', due: '2026-10-30' });

    await goSection(page, 'Аналитика');
    await page.getByRole('radio', { name: 'Календарь' }).click();
    const usual = page.getByRole('checkbox', { name: /Тратить как обычно/ });
    await expect(page.getByTestId('calendar-summary')).toBeVisible();
    // расходов в истории нет — средний расход неизвестен, тумблер выключен и недоступен
    await expect(usual).toBeDisabled();
    await expect(page.getByText('Пока нет истории расходов, считать нечем')).toBeVisible();

    // на руках 3 000; 20-го аренда 3 500, 25-го возврат соседу 500; возврат Алишера по умолчанию не ждём
    await expect(page.getByTestId('calendar-start')).toContainText(money('3 000 с.'));
    await expect(page.getByTestId('calendar-end')).toContainText(money('−1 000 с.'));
    const verdict = page.getByTestId('calendar-verdict');
    await expect(verdict).toContainText('Денег не хватит с 20 октября');
    await expect(verdict).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('zero-line')).toHaveCount(1);
    await shot(page, '31-cash-calendar', testInfo);

    const rent = page.getByTestId('cal-day-2026-10-20');
    await expect(rent).toContainText('Аренда');
    await expect(rent).toContainText(money('−3 500 с.'));
    await expect(rent).toContainText(money('−500 с.')); // остаток после дня
    const neighbour = page.getByTestId('cal-day-2026-10-25');
    await expect(neighbour).toContainText('Сосед');
    await expect(neighbour).toContainText('вернуть долг');
    await expect(page.getByTestId('cal-day-2026-10-30')).toHaveCount(0);

    // «Мне вернут долги в срок»: +200 в день срока; конец периода −800
    await page.getByRole('checkbox', { name: /Мне вернут долги в срок/ }).check();
    await expect(page.getByTestId('cal-day-2026-10-30')).toContainText('Алишер');
    await expect(page.getByTestId('cal-day-2026-10-30')).toContainText('вернут долг');
    await expect(page.getByTestId('calendar-end')).toContainText(money('−800 с.'));
    await shot(page, '31-cash-calendar-receivables', testInfo);
    await noHorizontalScroll(page, 'Календарь');

    await page.getByRole('checkbox', { name: /Мне вернут долги в срок/ }).uncheck();
    await expect(page.getByTestId('cal-day-2026-10-30')).toHaveCount(0);
    await expect(page.getByTestId('calendar-end')).toContainText(money('−1 000 с.'));

    // обратно на «Обзор»: месяц снова выбирается
    await page.getByRole('radio', { name: 'Обзор' }).click();
    await expect(page.getByTestId('analytics-summary')).toBeVisible();
    await expect(page.getByTestId('calendar-summary')).toHaveCount(0);
  });

  test('деньги хватает: после обычных трат календарь считает по среднему, вывод спокойный', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '3000', category: 'Зарплата', date: '2026-10-10' });
    await addTx(page, { amount: '150', category: 'Еда', date: '2026-10-10' });
    await dismissToasts(page);

    await goSection(page, 'Аналитика');
    await page.getByRole('radio', { name: 'Календарь' }).click();
    const usual = page.getByRole('checkbox', { name: /Тратить как обычно/ });
    await expect(page.getByTestId('calendar-summary')).toBeVisible();
    // с 10 по 14 октября (5 дней) ушло 150 → 30 с. в день; сегодня трат не было, потому вычитаются все 30 дней: 2 850 − 30 × 30
    await expect(usual).toBeEnabled();
    await expect(usual).toBeChecked();
    await expect(page.getByTestId('calendar-start')).toContainText(money('2 850 с.'));
    await expect(page.getByTestId('calendar-end')).toContainText(money('1 950 с.'));
    await expect(page.getByTestId('calendar-verdict')).toContainText('Денег хватает на все 30 дней');
    await expect(page.getByTestId('zero-line')).toHaveCount(0);
    await shot(page, '31-cash-calendar-ok', testInfo);

    await usual.uncheck();
    await expect(page.getByTestId('calendar-end')).toContainText(money('2 850 с.'));
    expect(norm(await page.getByTestId('calendar-verdict').innerText())).toContain('Меньше всего будет');
    await noHorizontalScroll(page, 'Календарь');
  });
});
