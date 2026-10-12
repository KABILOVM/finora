import { openCategoryList, addLink, addTx, createWallet, dismissToasts, expect, goSection, openApp, sheet, test } from '../helpers';

/** Названия чипов группы по порядку слева направо (кроме «Новая» и «Ещё N»). */
async function chipNames(group: ReturnType<ReturnType<typeof sheet>['getByRole']>): Promise<string[]> {
  const texts = await group.getByRole('button').allInnerTexts();
  return texts.map((t) => t.trim()).filter((t) => t !== '' && t !== 'Новая' && !/^Ещё \d+$/.test(t));
}

test.describe('23. Сортировка по популярности', () => {
  test('категории и кошельки в форме и в фильтрах идут от самых частых к редким; предвыбор кошелька прежний', async ({ page }) => {
    await openApp(page);
    await createWallet(page, { name: 'Карта' });

    // Расходы: «Прочее» (в обычном порядке 12-я, под «Ещё») — 2 раза, «Образование» (10-я) — 1 раз; доходы: «Бонус» — 2 раза
    await addTx(page, { amount: '10', category: 'Прочее', wallet: 'Карта' });
    await addTx(page, { amount: '11', category: 'Прочее', wallet: 'Карта' });
    await addTx(page, { amount: '12', category: 'Образование', wallet: 'Карта' });
    await addTx(page, { kind: 'income', amount: '30', category: 'Бонус', wallet: 'Карта' });
    await addTx(page, { kind: 'income', amount: '31', category: 'Бонус', wallet: 'Карта' });
    // Последним внесён расход на «Наличные»: предвыбор кошелька будет «Наличные», хотя чаще используется «Карта»
    await addTx(page, { amount: '5', category: 'Еда', wallet: 'Наличные' });
    await dismissToasts(page);

    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    const cats = await openCategoryList(dlg);

    // Расход: в списке сразу все; самые частые первыми, равные по счёту (Еда 1 — как Образование) идут по прежнему порядку
    await expect.poll(() => chipNames(cats)).toEqual([
      'Прочее', 'Еда', 'Образование', 'Продукты', 'Транспорт', 'Жильё', 'Связь', 'Здоровье', 'Покупки', 'Развлечения', 'Подписки', 'Долги',
    ]);

    // Предвыбор кошелька не менялся, а в списке самый используемый — первым
    await expect(dlg.getByRole('button', { name: /^Кошелёк: Наличные/ })).toBeVisible();
    await dlg.getByRole('button', { name: /^Кошелёк:/ }).click();
    await expect.poll(() => chipNames(dlg.getByRole('group', { name: 'Кошелёк' }))).toEqual(['Карта', 'Наличные']);

    // Доход
    await dlg.getByRole('radio', { name: 'Доход' }).click();
    const incomeCats = await openCategoryList(dlg);
    await expect.poll(() => chipNames(incomeCats)).toEqual(['Бонус', 'Зарплата', 'Подработка', 'Подарки', 'Прочее']);
    await page.keyboard.press('Escape'); // закрывает открытый список категорий
    await page.keyboard.press('Escape'); // и затем само окно
    await expect(dlg).toBeHidden();

    // Фильтры: тот же порядок в списке кошельков и категорий
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    const filters = sheet(page, 'Фильтры');
    await expect(filters).toBeVisible();
    const walletOpts = await filters.locator('#filter-wallet option').allInnerTexts();
    expect(walletOpts.slice(1)).toEqual(['Карта', 'Наличные']);
    const catOpts = await filters.locator('#filter-category optgroup[label="Расходы"] option').allInnerTexts();
    expect(catOpts.slice(0, 3)).toEqual(['Прочее', 'Еда', 'Образование']);
    await page.keyboard.press('Escape');

    // Страница «Кошельки» остаётся в прежнем порядке
    await goSection(page, 'Кошельки');
    const names = await page.getByRole('main').getByRole('listitem').allInnerTexts();
    const pos = (n: string) => names.findIndex((t) => t.includes(n));
    expect(pos('Наличные')).toBeGreaterThanOrEqual(0);
    expect(pos('Наличные')).toBeLessThan(pos('Карта'));
  });
});
