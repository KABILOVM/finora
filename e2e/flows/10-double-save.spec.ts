import { addTx, dismissToasts, expect, fillTx, goSection, money, openApp, sheet, test, walletRowText } from '../helpers';
import type { Page } from '@playwright/test';

const rows = (page: Page) => page.getByRole('region').getByRole('button');

async function opsAndBalance(page: Page) {
  await goSection(page, 'Операции');
  await page.getByRole('button', { name: 'Всё время' }).click();
  const count = await rows(page).count();
  await goSection(page, 'Кошельки');
  return { count, balance: await walletRowText(page, 'Наличные') };
}

test.describe('10. Двойное нажатие «Сохранить»', () => {
  test('быстрый двойной клик — одна операция и один раз списано', async ({ page }) => {
    await openApp(page);
    const dlg = await fillTx(page, { amount: '12,5', category: 'Еда' });
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).dblclick();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const r = await opsAndBalance(page);
    expect(r.count).toBe(1);
    expect(r.balance).toMatch(money('−12,50 с.'));
  });

  test('два нажатия в одном кадре (программно, без паузы) — одна операция', async ({ page }) => {
    await openApp(page);
    const dlg = await fillTx(page, { amount: '40', category: 'Транспорт' });
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).evaluate((el: HTMLElement) => {
      el.click();
      el.click();
      el.click();
    });
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const r = await opsAndBalance(page);
    expect(r.count).toBe(1);
    expect(r.balance).toMatch(money('−40 с.'));
  });

  test('«Сохранить и добавить ещё», двойной клик — одна операция, форма очищена', async ({ page }) => {
    await openApp(page);
    const dlg = await fillTx(page, { amount: '15', category: 'Еда' });
    await dlg.getByRole('button', { name: 'Сохранить и добавить ещё' }).dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'Сохранено' }).first()).toBeVisible();
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const r = await opsAndBalance(page);
    expect(r.count, 'операций после двойного «Сохранить и добавить ещё»').toBe(1);
    expect(r.balance).toMatch(money('−15 с.'));
  });

  test('медленное двойное касание (через 150 мс): вторая операция не появляется', async ({ page }) => {
    await openApp(page);
    const dlg = await fillTx(page, { amount: '22', category: 'Еда' });
    const save = dlg.getByRole('button', { name: 'Сохранить', exact: true });
    const [x, y] = await centerOf(save); // координаты запоминаем до закрытия шита
    await save.click();
    await page.waitForTimeout(150);
    // второе касание в ту же точку: шит уже закрыт, под пальцем — страница
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    // что бы ни открылось под пальцем, закрываем и считаем деньги
    if ((await page.getByRole('dialog').count()) > 0) await page.keyboard.press('Escape');
    await dismissToasts(page);
    const r = await opsAndBalance(page);
    expect(r.count).toBe(1);
    expect(r.balance).toMatch(money('−22 с.'));
  });

  test('кошелёк: двойной клик «Сохранить» — один кошелёк', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Копилка');
    await dlg.getByRole('textbox', { name: /^Начальный остаток/ }).fill('100');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).dblclick();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('list').getByText('Копилка', { exact: true })).toHaveCount(1);
    await page.reload();
    await goSection(page, 'Кошельки');
    await expect(page.getByRole('list').getByText('Копилка', { exact: true })).toHaveCount(1);
    expect(await walletRowText(page, 'Копилка')).toMatch(money('100 с.'));
  });

  test('правка: двойной клик «Сохранить» — сумма изменена один раз, остаток верный', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '100', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Еда/ }).click();
    const dlg = sheet(page, 'Правка операции');
    await dlg.getByRole('textbox', { name: /^Сумма/ }).fill('70');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).dblclick();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const r = await opsAndBalance(page);
    expect(r.count).toBe(1);
    expect(r.balance).toMatch(money('−70 с.'));
  });
});

async function centerOf(l: import('@playwright/test').Locator): Promise<[number, number]> {
  const b = await l.boundingBox();
  if (!b) throw new Error('нет рамки у кнопки');
  return [b.x + b.width / 2, b.y + b.height / 2];
}
