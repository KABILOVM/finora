import {
  createWallet, dismissToasts, expect, fillTx, goSection, homeTotalText, homeWallet, money, moneyExact, monthRow, norm,
  openApp, shot, sheet, test, walletRowText,
} from '../helpers';

test.describe('3. Кошельки и валюты', () => {
  test('кошелёк в долларах, расход в долларах просит курс, «Всего» пересчитан, в «Операциях» «−N $»', async ({ page }, testInfo) => {
    await openApp(page);

    // Кошелёк в долларах с начальным остатком 100 $
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '100' });
    expect(await walletRowText(page, 'Доллары')).toMatch(money('100 $'));

    // Без курса «Всего» честно говорит, что доллары не вошли (а не молча считает 100 $ за 100 с.)
    await goSection(page, 'Главная');
    await expect(homeWallet(page, 'Доллары')).toContainText(money('100 $'));
    const totalNoRate = await homeTotalText(page);
    expect(totalNoRate, 'в «Всего» нет курса — должно быть предупреждение, а не молчаливая подстановка').toMatch(/нет курса/i);

    // Расход 10 $ в «Еда»: приложение просит курс (источники курсов недоступны)
    const dlg = await fillTx(page, { wallet: 'Доллары', amount: '10', category: 'Еда' });
    await expect(dlg.getByTestId('fx-notice')).toContainText('Введите курс сами');
    await shot(page, '03-fx-missing', testInfo);

    // Без курса сохранить нельзя, и человек не теряет введённое
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('alert')).toBeVisible();

    // Курс, набранный здесь же, в операции: 1 $ = 11 с.
    await dlg.getByRole('textbox', { name: /^Курс:/ }).fill('11');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // «Операции»: «−10 $»
    await goSection(page, 'Операции');
    const row = page.getByRole('button', { name: /Еда/ });
    await expect(row).toHaveCount(1);
    expect(norm(await row.innerText())).toMatch(money('−10 $'));
    expect(norm(await row.innerText())).not.toMatch(/−10 с\./);
    await shot(page, '03-transactions-usd', testInfo);

    // Остаток кошелька: 100 − 10 = 90 $
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Доллары')).toMatch(money('90 $'));

    // Расходы месяца в основной валюте — по курсу операции: 10 $ × 11 = 110 с.
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('−110 с.'));

    // Курс, введённый в операции, запомнился отдельным слоем: «Всего» теперь считает по нему — со знаком «≈» и пояснением.
    const day = await page.evaluate(() => {
      const d = new Date();
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const entered = await homeTotalText(page);
    expect(entered, 'после ввода курса в операции «Всего» больше не просит курс').not.toMatch(/нет курса/i);
    expect(entered).toMatch(/≈/);
    expect(entered).toMatch(money('990 с.')); // 0 с. наличные + 90 $ × 11
    expect(entered).toContain(`Остаток в USD пересчитан по введённому вами курсу от ${day}`);
    await shot(page, '03-home-entered-rate', testInfo);
    await goSection(page, 'Кошельки');
    expect(norm(await page.getByTestId('wallets-total').innerText())).toMatch(/≈/);
    expect(norm(await page.getByTestId('wallets-total-entered').innerText())).toContain(`по введённому вами курсу от ${day}`);

    // Настройки → Курсы: введённый курс виден списком с кнопкой «Сбросить»
    await goSection(page, 'Настройки');
    const block = page.getByTestId('entered-rates');
    await expect(block).toBeVisible();
    expect(norm(await block.innerText())).toMatch(money('1 USD = 11 с.'));
    expect(norm(await block.innerText())).toContain(`введён вручную ${day}`);
    await shot(page, '03-settings-entered-rate', testInfo);

    // «Свой курс» (12) сильнее введённого: итог 90 $ × 12 = 1 080 с., пояснения про введённый курс нет
    await page.getByRole('button', { name: 'Свой курс USD' }).click();
    const rate = sheet(page, /Курс USD/);
    await rate.getByRole('textbox').fill('12');
    await rate.getByRole('button', { name: 'Сохранить курс' }).click();
    await expect(rate).toBeHidden();
    await expect(page.getByText(/1 USD = 12 с\./).first()).toBeVisible();
    await expect(block).toContainText('сейчас не используется');
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const manual = await homeTotalText(page);
    expect(manual).toMatch(money('1 080 с.'));
    expect(manual).not.toContain('введённому');

    // Убрали «Свой курс» — снова введённый (990 с.)
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Свой курс USD' }).click();
    await sheet(page, /Курс USD/).getByRole('button', { name: 'Убрать свой курс' }).click();
    await expect(sheet(page, /Курс USD/)).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('990 с.'));

    // «Сбросить»: введённый курс забыт, «Всего» снова честно просит курс
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Сбросить введённый курс USD' }).click();
    await expect(block).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(/нет курса/i);

    // Задаём «Свой курс» в настройках: 1 $ = 11 с.
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Свой курс USD' }).click();
    const rate11 = sheet(page, /Курс USD/);
    await rate11.getByRole('textbox').fill('11');
    await rate11.getByRole('button', { name: 'Сохранить курс' }).click();
    await expect(rate11).toBeHidden();
    await expect(page.getByText(/1 USD = 11 с\./).first()).toBeVisible();

    // «Всего» ≈ 0 с. (наличные) + 90 $ × 11 = 990 с.
    await goSection(page, 'Главная');
    const total = await homeTotalText(page);
    expect(total).toMatch(/≈/);
    expect(total).toMatch(money('990 с.'));
    expect(total).not.toMatch(/нет курса/i);
    // Кошелёк в долларах по-прежнему показан в своей валюте
    await expect(homeWallet(page, 'Доллары')).toContainText(money('90 $'));
    await shot(page, '03-home-total', testInfo);

    // Перезагрузка: всё то же
    await page.reload();
    await expect(page.getByTestId('home-total')).toBeVisible();
    expect(await homeTotalText(page)).toMatch(money('990 с.'));
  });
});
