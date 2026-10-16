import type { Page } from '@playwright/test';
import { addTx, dismissToasts, expect, goSection, homeWallet, money, norm, openApp, sheet, shot, test } from '../helpers';

/** «Сегодня» закреплено: 15 октября 2026 (вторая половина месяца — работает подсказка «пора отложить»). */
const NOW = new Date('2026-10-15T09:00:00Z');

const goalBlock = (page: Page) => page.getByTestId('wallet-goal');
/** Ширина страницы не больше видимой области. На телефоне слишком широкая строка раздувает и innerWidth, поэтому сравниваем с visualViewport. */
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (window.visualViewport?.width ?? window.innerWidth) + 1)).toBe(true);

/** Накопления «Отпуск» с начальным остатком 300, целью 3000 и сроком 15.01.2027. */
async function createGoalWallet(page: Page): Promise<void> {
  await goSection(page, 'Кошельки');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dlg = sheet(page, 'Новый кошелёк');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Название' }).fill('Отпуск');
  await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
  await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('3000');
  await dlg.getByRole('group', { name: 'Накопить к дате' }).getByRole('button', { name: 'Указать срок' }).click();
  await dlg.getByLabel('Накопить к дате: календарь').fill('2027-01-15');
  await dlg.getByRole('textbox', { name: /^Начальный остаток/ }).fill('300');
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

test.describe('37. Цели накопления', () => {
  test('цель и срок у накопления → полоса и подсказки → пополнение → виджет на главной → очистка цели', async ({ page }, testInfo) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await createGoalWallet(page);

    // «Кошельки»: полоса, «накоплено из», «осталось», срок словами, сколько откладывать в месяц и «пора отложить»
    const block = goalBlock(page);
    await expect(block).toHaveCount(1);
    expect(norm(await block.innerText())).toMatch(money('Накоплено 300 с. из 3 000 с.'));
    expect(norm(await block.innerText())).toMatch(money('Осталось 2 700 с.'));
    await expect(block).toContainText('К 15.01.2027 · через 92 дня');
    expect(norm(await block.innerText())).toMatch(money('Откладывайте около 900 с. в месяц'));
    await expect(block.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
    const nudge = page.getByTestId('goal-nudge');
    expect(norm(await nudge.innerText())).toMatch(money('Пора отложить: в этом месяце отложено 0 с. из ~900 с.'));
    await noHorizontalScroll(page);
    await shot(page, '37-wallets-goal', testInfo);

    // «Главная»: подсказка «Пора отложить» — в строке «Требует внимания», кошелёк-цель — в ленте чипов
    await goSection(page, 'Главная');
    const attention = page.getByTestId('attention-row');
    await expect(attention).toContainText('Пора отложить: Отпуск');
    await expect(homeWallet(page, 'Отпуск')).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, '37-home-goals', testInfo);

    // пополнение: доход 900 на «Отпуск» — подсказка исчезает (отложено достаточно), строка уходит
    await addTx(page, { kind: 'income', amount: '900', category: 'Зарплата', wallet: 'Отпуск' });
    await dismissToasts(page);
    await expect(attention).toHaveCount(0);
    await goSection(page, 'Кошельки');
    await expect(page).toHaveURL(/#\/wallets$/);
    expect(norm(await goalBlock(page).innerText())).toMatch(money('Накоплено 1 200 с. из 3 000 с.'));
    await expect(goalBlock(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await expect(page.getByTestId('goal-nudge')).toHaveCount(0);

    // правка: пустая сумма цели убирает цель целиком (и срок), виджет пропадает
    await page.getByText('Отпуск', { exact: true }).first().click();
    const dlg = sheet(page, 'Правка кошелька');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Накопить к дате: календарь')).toHaveValue('2027-01-15');
    await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('');
    await expect(dlg.getByRole('group', { name: 'Накопить к дате' })).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(goalBlock(page)).toHaveCount(0);
    await goSection(page, 'Главная');
    await expect(page.getByTestId('attention-row')).toHaveCount(0);
  });

  test('цель 0 и срок в прошлом не сохраняются: подсказка у поля, окно остаётся открытым', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Копилка');
    await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
    await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('0');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText('Цель должна быть больше нуля')).toBeVisible();

    await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('100');
    await dlg.getByRole('group', { name: 'Накопить к дате' }).getByRole('button', { name: 'Указать срок' }).click();
    await dlg.getByLabel('Накопить к дате: календарь').fill('2026-10-14');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText('Срок не может быть в прошлом')).toBeVisible();
    await expect(dlg).toBeVisible();

    await dlg.getByLabel('Накопить к дате: календарь').fill('2026-10-15');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(goalBlock(page)).toContainText('К 15.10.2026 · срок сегодня');
  });

  test('длинное название и огромные суммы цели не раздвигают страницу ни на «Кошельках», ни на «Главной» (чипы и строка «Требует внимания»)', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Накопления на очень длинную цель'.repeat(2).slice(0, 60));
    await dlg.getByRole('group', { name: 'Вид кошелька' }).getByRole('button', { name: 'Накопления' }).click();
    await dlg.getByRole('textbox', { name: /^Цель накопления/ }).fill('9999999999999');
    await dlg.getByRole('group', { name: 'Накопить к дате' }).getByRole('button', { name: 'Указать срок' }).click();
    await dlg.getByLabel('Накопить к дате: календарь').fill('2099-12-31');
    await noHorizontalScroll(page);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await expect(goalBlock(page)).toHaveCount(1);
    await expect(page.getByTestId('goal-nudge')).toBeVisible();
    await noHorizontalScroll(page);
    await goSection(page, 'Главная');
    await expect(page.getByTestId('attention-row')).toBeVisible();
    await noHorizontalScroll(page);
  });
});
