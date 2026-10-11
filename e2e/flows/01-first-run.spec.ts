import { expect, homeTotalText, homeWallet, goSection, money, moneyExact, monthRow, norm, openApp, shot, test, tapAmount, addLink, sheet } from '../helpers';

test.describe('1. Первый запуск', () => {
  test('бейдж «Только на устройстве», расход 12,5 в «Еда» за минимум касаний, суммы верны, после перезагрузки данные на месте', async ({ page }, testInfo) => {
    // Считаем касания по кнопкам и ссылкам: что именно нажал человек.
    await page.addInitScript(() => {
      const taps: string[] = [];
      (window as unknown as { __taps: string[] }).__taps = taps;
      document.addEventListener(
        'click',
        (e) => {
          const el = (e.target as Element | null)?.closest('button,a,[role=radio]');
          if (el) taps.push(el.getAttribute('aria-label') || (el.textContent ?? '').trim());
        },
        true,
      );
    });

    await openApp(page);
    await expect(page).toHaveTitle(/Finora/);

    // Честный индикатор вместо «Синхронизировано»
    const badge = page.getByRole('status', { name: /Облако не подключено/ });
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Только на устройстве');
    await expect(page.getByText('Синхронизировано')).toHaveCount(0);
    await shot(page, '01-home-empty', testInfo);

    // Расход «12,5» в «Еда»: «+» → сумма → категория → «Сохранить»
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await tapAmount(page, '12,5');
    await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда', exact: true }).click();
    await shot(page, '01-add-filled', testInfo);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();

    const taps = await page.evaluate(() => (window as unknown as { __taps: string[] }).__taps);
    const digitTaps = taps.filter((t) => /^[0-9]$|^Запятая$/.test(t));
    const otherTaps = taps.filter((t) => !/^[0-9]$|^Запятая$/.test(t));
    testInfo.annotations.push({ type: 'taps', description: `все: ${taps.join(' | ')}` });
    // «+», «Еда», «Сохранить»: кошелёк и дата подставились сами, лишних нажатий нет
    expect(otherTaps, `касания кроме цифр: ${otherTaps.join(' | ')}`).toHaveLength(3);
    expect(digitTaps).toHaveLength(4); // 1, 2, «,», 5
    expect(taps.length).toBeLessThanOrEqual(7);

    // «Главная»: Всего, кошелёк, месяц
    await goSection(page, 'Главная');
    await expect(homeWallet(page, 'Наличные')).toContainText(money('−12,50 с.'));
    expect(await homeTotalText(page)).toMatch(money('−12,50 с.'));
    expect(await monthRow(page, 'Расходы')).toMatch(moneyExact('−12,50 с.'));
    expect(await monthRow(page, 'Доходы')).toMatch(moneyExact('0 с.'));
    await shot(page, '01-home-after', testInfo);

    // «Операции»
    await goSection(page, 'Операции');
    const row = page.getByRole('button', { name: /Еда/ });
    await expect(row).toHaveCount(1);
    expect(norm(await row.innerText())).toContain('−12,50 с.');
    await shot(page, '01-transactions', testInfo);

    // Перезагрузка: данные на месте
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Операции' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Еда/ })).toHaveCount(1);
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('−12,50 с.'));
    await expect(page.getByRole('status', { name: /Облако не подключено/ })).toBeVisible();
  });
});
