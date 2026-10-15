import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

/** Долг «на бумаге» (без движения денег); экран «Долги» уже открыт. */
async function addDebt(page: Page, d: { name: string; amount: string; borrowed?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  await tapAmount(page, d.amount);
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('33. Долги: взаимозачёт и «платить частями»', () => {
  test('взаимозачёт: предпросмотр, запись двумя платежами, итоги человека, отмена; затем «Получать частями»', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер', amount: '500' });
    await page.getByRole('radio', { name: 'Я должен' }).click();
    await addDebt(page, { name: 'Алишер', borrowed: true, amount: '200' });
    await page.getByRole('radio', { name: 'Люди' }).click();
    await page.getByRole('list', { name: 'Люди' }).getByRole('link', { name: /Алишер/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();

    // предпросмотр: из 500 останется 300, мой долг 200 погасится
    await page.getByRole('button', { name: /^Взаимозачёт: / }).click();
    const dlg = sheet(page, 'Взаимозачёт');
    await expect(dlg).toBeVisible();
    const preview = page.getByTestId('netting-preview');
    await expect(preview).toContainText(money('500 с.'));
    await expect(preview).toContainText(money('300 с.'));
    await expect(preview).toContainText(money('200 с.'));
    await expect(preview).toContainText(money('0 с.'));
    await shot(page, '33-netting-sheet', testInfo);
    await dlg.getByRole('button', { name: /^Зачесть / }).click();
    await expect(dlg).toBeHidden();

    // у человека осталось «Вам должны 300», долга «я должен» больше нет, кнопки зачёта нет
    const totals = page.getByTestId('person-total-TJS');
    await expect(totals).toContainText(money('300 с.'));
    await expect(totals).not.toContainText('Вы должны');
    await expect(page.getByRole('button', { name: /^Взаимозачёт: / })).toHaveCount(0);
    await shot(page, '33-netting-done', testInfo);

    // «Отменить» в тосте возвращает оба долга
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(totals).toContainText('Вы должны');
    await expect(totals).toContainText(money('500 с.'));
    await expect(page.getByRole('button', { name: /^Взаимозачёт: / })).toBeVisible();
    await dismissToasts(page);

    // в журнале операций зачёт появился двумя платежами только пока не отменён: теперь их нет
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Взаимозачёт/ })).toHaveCount(0);

    // «Получать частями» по долгу «мне должны»: 500 по 150 → 4 платежа, последний 15 января
    await goSection(page, 'Долги');
    await page.getByRole('list', { name: 'Мне должны' }).getByRole('link', { name: /^Алишер/ }).click();
    await page.getByRole('button', { name: 'Получать частями' }).click();
    const parts = sheet(page, 'Получать частями');
    await expect(parts).toBeVisible();
    await tapAmount(page, '150');
    await expect(page.getByTestId('payoff-preview')).toContainText('Долг закроется 15 января: 4 платежа');
    await expect(page.getByTestId('payoff-preview')).toContainText('Последний платёж меньше');
    await shot(page, '33-pay-in-parts', testInfo);
    await noHorizontalScroll(page, 'Платить частями');
    await parts.getByRole('button', { name: 'Создать платежи' }).click();
    await expect(parts).toBeHidden();
    await dismissToasts(page);

    // правило видно среди регулярных платежей
    await goSection(page, 'Платежи');
    await expect(page.getByText('Долг: Алишер').first()).toBeVisible();
  });
});
