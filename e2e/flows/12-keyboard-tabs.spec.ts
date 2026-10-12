import { openCategoryList, addTx, dismissToasts, expect, goSection, homeTotalText, money, openApp, test, waitReady } from '../helpers';

test.describe('12. Ввод с клавиатуры и две вкладки', () => {
  test('системная клавиатура: точка превращается в запятую, буквы игнорируются, ноль не сохраняется', async ({ page }) => {
    await openApp(page);
    await page.locator('a[href="#/add"]:visible').last().click();
    const dlg = page.getByRole('dialog', { name: 'Новая операция' });
    const amount = dlg.getByRole('textbox', { name: /^Сумма/ });
    await amount.focus();
    await page.keyboard.type('abc12.5x');
    await expect(amount).toHaveValue('12,5');
    await page.keyboard.type('678'); // третий знак после запятой не принимается
    await expect(amount).toHaveValue('12,56');

    await amount.fill('0');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByRole('alert')).toContainText('больше нуля');
    await expect(dlg).toBeVisible();

    await amount.fill('12,56');
    await (await openCategoryList(dlg)).getByRole('button', { name: 'Еда', exact: true }).click();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('−12,56 с.'));
  });

  test('две вкладки: операция из одной сразу видна в другой; правка в одной, а в другой операция уже удалена — понятное сообщение', async ({
    page,
    context,
    errors,
  }) => {
    await openApp(page);
    await addTx(page, { amount: '50', category: 'Еда' });
    await dismissToasts(page);

    const tab2 = await context.newPage();
    errors.watch(tab2);
    await tab2.goto('/#/transactions');
    await waitReady(tab2);
    await expect(tab2.getByRole('button', { name: /Еда/ })).toHaveCount(1);

    // вкладка 1: ещё одна операция → вкладка 2 обновляется сама, без перезагрузки
    await addTx(page, { amount: '25', category: 'Транспорт' });
    await expect(tab2.getByRole('button', { name: /Транспорт/ })).toHaveCount(1, { timeout: 10_000 });

    // вкладка 2 открывает правку «Еда»; вкладка 1 в это время удаляет «Еда»
    await tab2.getByRole('button', { name: /Еда/ }).click();
    await expect(tab2.getByRole('dialog', { name: 'Правка операции' })).toBeVisible();
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Еда/ }).click();
    await page.getByRole('dialog', { name: 'Правка операции' }).getByRole('button', { name: 'Удалить операцию' }).click();
    await page.getByRole('alertdialog', { name: 'Удалить операцию?' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(0);

    await expect(tab2.getByText('Операция не найдена')).toBeVisible({ timeout: 10_000 });
    await expect(tab2.getByRole('dialog', { name: 'Правка операции' })).toHaveCount(0);
    await goSection(tab2, 'Главная');
    expect(await homeTotalText(tab2)).toMatch(money('−25 с.'));
    await tab2.close();
  });
});
