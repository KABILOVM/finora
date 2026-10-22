import type { Locator, Page } from '@playwright/test';
import { addLink, addTx, dismissToasts, expect, goSection, openApp, saveNewTx, shot, sheet, tapAmount, test } from '../helpers';

const rows = (page: Page) => page.getByRole('region').getByRole('button');

async function openNew(page: Page): Promise<Locator> {
  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  return dlg;
}

test.describe('49. Подсказки по заметке', () => {
  test('набираем начало заметки — под полем похожие записи; нажатие подставляет категорию и сумму; на 320 px всё на виду', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addTx(page, { amount: '20', category: 'Еда', note: 'Кофе с собой' });
    await dismissToasts(page);
    await addTx(page, { amount: '20', category: 'Еда', note: 'Кофе с собой' });
    await dismissToasts(page);

    const dlg = await openNew(page);
    await dlg.getByRole('button', { name: 'Заметка', exact: true }).click();
    const note = dlg.getByRole('textbox', { name: 'Заметка' });
    // пока ничего не набрано, подсказок нет
    await expect(dlg.getByRole('group', { name: 'Похожие записи' })).toHaveCount(0);
    await note.fill('ко');

    const group = dlg.getByRole('group', { name: 'Похожие записи' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button')).toHaveCount(1);
    await expect(group.getByRole('button').first()).toContainText('Кофе с собой');
    await expect(group.getByRole('button').first()).toHaveAttribute('aria-label', /Еда/);
    // панель не выросла: поле заметки и подсказка целиком на экране, горизонтальной прокрутки нет
    await expect(group).toBeInViewport({ ratio: 1 });
    await expect(note).toBeInViewport({ ratio: 1 });
    await expect(dlg.getByRole('button', { name: 'Готово', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const box = await group.getByRole('button').first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, '49-note-suggest', testInfo);

    await group.getByRole('button').first().click();
    await expect(group).toBeHidden();
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(3);
  });

  test('сумма, набранная до заметки, остаётся', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '20', category: 'Еда', note: 'Кофе с собой' });
    await dismissToasts(page);
    const dlg = await openNew(page);
    await tapAmount(page, '45');
    await dlg.getByRole('button', { name: 'Заметка', exact: true }).click();
    await dlg.getByRole('textbox', { name: 'Заметка' }).fill('ко');
    await dlg.getByRole('group', { name: 'Похожие записи' }).getByRole('button').first().click();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/^45/);
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
  });
  test('ввод одной строкой: «кофе 15 вчера» читается как сумма и дата; на 320 px чип на виду', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await addTx(page, { amount: '10', category: 'Еда', note: 'кофе' });
    await dismissToasts(page);

    const dlg = await openNew(page);
    await dlg.getByRole('button', { name: 'Заметка', exact: true }).click();
    const note = dlg.getByRole('textbox', { name: 'Заметка' });
    await note.fill('кофе 15 вчера');
    const chip = dlg.getByRole('group', { name: 'Похожие записи' }).getByRole('button', { name: /^Применить: / });
    await expect(chip).toBeVisible();
    await expect(chip).toBeInViewport({ ratio: 1 });
    await expect(note).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const box = await chip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, '49-quick-line', testInfo);

    await chip.click();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/^15/);
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: /^Дата/ })).toContainText('Вчера');
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(2);
  });
});
