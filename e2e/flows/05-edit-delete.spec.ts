import { addTx, dismissToasts, expect, goSection, homeTotalText, money, norm, openApp, shot, sheet, test, walletRowText } from '../helpers';

test.describe('5. Правка и удаление', () => {
  test('сумма меняется — остаток пересчитан; «Отменить» возвращает; без отмены остаток верный', async ({ page }, testInfo) => {
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000' });
    await addTx(page, { amount: '100', category: 'Еда', note: 'обед' });
    await dismissToasts(page);

    const balance = async () => {
      await goSection(page, 'Кошельки');
      return walletRowText(page, 'Наличные');
    };
    expect(await balance()).toMatch(money('900 с.'));

    // Правка суммы 100 → 60
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Еда/ }).click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit).toBeVisible();
    const amount = edit.getByRole('textbox', { name: /^Сумма/ });
    await expect(amount).toHaveValue('100');
    // заметка спрятана за кнопкой-карандашом (на ней точка: заметка есть)
    await edit.getByRole('button', { name: 'Заметка', exact: true }).click();
    await expect(edit.getByRole('textbox', { name: 'Заметка' })).toHaveValue('обед');
    await shot(page, '05-edit-open', testInfo);
    await amount.fill('60');
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByRole('button', { name: /Еда/ })).toContainText(money('−60 с.'));
    expect(await balance()).toMatch(money('940 с.'));

    // Удаление и «Отменить»
    const openAndDelete = async () => {
      await goSection(page, 'Операции');
      await page.getByRole('button', { name: /Еда/ }).click();
      const e = sheet(page, 'Правка операции');
      await e.getByRole('button', { name: 'Удалить операцию' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Удалить операцию?' });
      await expect(confirm).toBeVisible();
      await shot(page, '05-confirm-delete', testInfo);
      await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(confirm).toBeHidden();
      await expect(e).toBeHidden();
    };

    await openAndDelete();
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(0);
    const toast = page.getByRole('status').filter({ hasText: 'Операция удалена' });
    await expect(toast).toBeVisible();
    await shot(page, '05-deleted-toast', testInfo);
    await toast.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Операция возвращена' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Еда/ })).toContainText(money('−60 с.'));
    expect(await balance()).toMatch(money('940 с.'));

    // Удаление без отмены: остаток 1000, строки нет, после перезагрузки тоже
    await dismissToasts(page);
    await openAndDelete();
    await dismissToasts(page);
    await page.waitForTimeout(500); // тост закрыт, «Отменить» не нажато
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(0);
    expect(await balance()).toMatch(money('1 000 с.'));
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('1 000 с.'));

    await page.reload();
    await expect(page.getByTestId('home-total')).toBeVisible();
    expect(await homeTotalText(page)).toMatch(money('1 000 с.'));
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(0);
    expect(norm(await page.locator('main').innerText())).not.toContain('обед');
  });

  test('текст подтверждения удаления читается без опечаток (нет «с..»)', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '60', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Еда/ }).click();
    await sheet(page, 'Правка операции').getByRole('button', { name: 'Удалить операцию' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Удалить операцию?' });
    await expect(confirm).toContainText('Расход 60');
    // «60 с.» + точка предложения давали «60 с..»
    expect(norm(await confirm.innerText())).not.toContain('..');
  });
});
