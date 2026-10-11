import {
  addTx, createWallet, dismissToasts, expect, fillTx, goSection, money, moneyExact, monthRow, norm, openApp, shot, test, walletRowText,
} from '../helpers';

test.describe('4. Перевод между кошельками', () => {
  test('одна валюта, с комиссией и между валютами: остатки верны, только комиссия перевода попадает в «Расходы» месяца', async ({ page }, testInfo) => {
    await openApp(page);
    await createWallet(page, { name: 'Карта', opening: '500' });
    await createWallet(page, { name: 'Доллары', currency: 'USD' });

    // Доход 200 и расход 5 на «Наличные»: единственные настоящие доход и расход месяца
    await addTx(page, { kind: 'income', amount: '200', wallet: 'Наличные' });
    await addTx(page, { amount: '5', category: 'Еда', wallet: 'Наличные' });
    await dismissToasts(page);

    const bal = async (name: string) => walletRowText(page, name);
    await goSection(page, 'Кошельки');
    expect(await bal('Наличные')).toMatch(money('195 с.'));
    expect(await bal('Карта')).toMatch(money('500 с.'));

    // а) та же валюта, без комиссии: 100 с. Наличные → Карта
    await addTx(page, { kind: 'transfer', amount: '100', wallet: 'Наличные', toWallet: 'Карта' });
    await dismissToasts(page);
    await goSection(page, 'Кошельки');
    expect(await bal('Наличные')).toMatch(money('95 с.'));
    expect(await bal('Карта')).toMatch(money('600 с.'));

    // б) с комиссией: из «Карта» уходит 50, на «Наличные» приходит 48 (комиссия 2 с.)
    const fee = await fillTx(page, { kind: 'transfer', amount: '50', wallet: 'Карта', toWallet: 'Наличные', received: '48' });
    await expect(fee.getByText(money('Получит: 48 с.'))).toBeVisible();
    await shot(page, '04-transfer-fee', testInfo);
    await fee.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(fee).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Кошельки');
    expect(await bal('Карта')).toMatch(money('550 с.'));
    expect(await bal('Наличные')).toMatch(money('143 с.'));

    // в) между валютами: из «Наличные» уходит 110 с., на «Доллары» приходит 10 $ (курса нет — «Получено» вводим сами)
    const cross = await fillTx(page, { kind: 'transfer', amount: '110', wallet: 'Наличные', toWallet: 'Доллары', received: '10' });
    await shot(page, '04-transfer-cross', testInfo);
    await cross.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(cross).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Кошельки');
    expect(await bal('Наличные')).toMatch(money('33 с.'));
    expect(await bal('Доллары')).toMatch(money('10 $'));
    expect(await bal('Карта')).toMatch(money('550 с.'));

    // Сами переводы не попали в «Расходы» и «Доходы» месяца: доход 200, расход 5. Комиссия перевода (2 с.) — расход месяца: 5 + 2 = 7
    await goSection(page, 'Главная');
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('−7 с.'));
    expect(await monthRow(page, 'Доходы')).toMatch(/^\+?200 с\.$/);
    expect(await monthRow(page, 'Разница')).toMatch(/^\+?193 с\.$/);

    // В списке переводы видны как «откуда → куда», а не как расход
    await goSection(page, 'Операции');
    await expect(page.getByRole('button', { name: /Наличные → Карта/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Карта → Наличные/ })).toHaveCount(1);
    const crossRow = page.getByRole('button', { name: /Наличные → Доллары/ });
    await expect(crossRow).toHaveCount(1);
    expect(norm(await crossRow.innerText())).toMatch(money('→ 10 $'));
    await shot(page, '04-transactions', testInfo);
  });
});
