import type { Page } from '@playwright/test';
import { dismissToasts, expect, goSection, money, openApp, shot, sheet, tapAmount, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (четверг). */
const NOW = new Date('2026-10-15T09:00:00Z');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

/** Долг «на бумаге» (без движения денег); экран «Долги» уже открыт. */
async function addDebt(page: Page, d: { name: string; amount: string; borrowed?: boolean; due?: string }): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  await tapAmount(page, d.amount);
  if (d.due) {
    await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
    await dlg.getByLabel('Срок возврата: календарь').fill(d.due);
  }
  await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('32. Долги: люди', () => {
  test('вкладка «Люди»: один человек — одна строка с общим итогом; страница человека; напоминание; ссылка с карточки долга', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер', amount: '500', due: '2026-10-25' });
    await addDebt(page, { name: 'Зафар', amount: '300' });
    await page.getByRole('radio', { name: 'Я должен' }).click();
    await addDebt(page, { name: 'алишёр', borrowed: true, amount: '200' });

    // «Люди»: Алишер (мне должны 500, я должен 200 — «алишёр» это он же) и Зафар
    await page.getByRole('radio', { name: 'Люди' }).click();
    const people = page.getByRole('list', { name: 'Люди' });
    await expect(people.getByRole('listitem')).toHaveCount(2);
    const ali = people.getByRole('listitem').filter({ hasText: 'Алишер' });
    await expect(ali).toContainText('2 долга');
    await expect(ali).toContainText(`Взаимные долги: итого вам должны`);
    await expect(ali).toContainText(money('300 с.'));
    await expect(people.getByRole('listitem').filter({ hasText: 'Зафар' })).toContainText(money('300 с.'));
    await shot(page, '32-people-list', testInfo);
    await noHorizontalScroll(page, 'Люди');

    // страница человека: обе стороны и итог
    await ali.getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();
    const totals = page.getByTestId('person-total-TJS');
    await expect(totals).toContainText('Вам должны');
    await expect(totals).toContainText(money('500 с.'));
    await expect(totals).toContainText('Вы должны');
    await expect(totals).toContainText(money('200 с.'));
    await expect(totals).toContainText('Итого вам должны');
    await expect(page.getByRole('list', { name: 'Мне должны' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Я должен' })).toBeVisible();
    await shot(page, '32-person-page', testInfo);

    // напоминание: текст с суммой и сроком, ссылки в мессенджеры несут этот текст и открываются в новой вкладке
    await page.getByRole('button', { name: 'Напомнить о долге' }).click();
    const dlg = sheet(page, 'Напомнить: Алишер');
    await expect(dlg).toBeVisible();
    const area = dlg.getByRole('textbox', { name: 'Текст напоминания' });
    await expect(area).toHaveValue(/Алишер, привет! Напоминаю про долг: 500\s*с\. Срок возврата — 25 октября\. Спасибо!/);
    const wa = dlg.getByRole('link', { name: 'WhatsApp' });
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', /noopener/);
    expect(await wa.getAttribute('href')).toContain('https://wa.me/?text=');
    await area.fill('Привет, как насчёт долга?');
    expect(decodeURIComponent((await wa.getAttribute('href')) ?? '')).toBe('https://wa.me/?text=Привет, как насчёт долга?');
    await shot(page, '32-reminder', testInfo);
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();

    // со страницы долга — «Все долги: Алишер» ведёт обратно к человеку
    await page.getByRole('list', { name: 'Мне должны' }).getByRole('link').first().click();
    await expect(page.getByRole('link', { name: 'Все долги: Алишер' })).toBeVisible();
    await page.getByRole('link', { name: 'Все долги: Алишер' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();
    await noHorizontalScroll(page, 'Страница человека');
  });
});
