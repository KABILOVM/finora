import type { Page } from '@playwright/test';
import { addLink, dismissToasts, expect, goSection, openApp, saveNewTx, shot, sheet, tapAmount, test, CATEGORY_NUDGE } from '../helpers';

const rows = (page: Page) => page.getByRole('region').getByRole('button');

async function openNew(page: Page) {
  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  return dlg;
}

test.describe('43. Новая операция: сетка категорий, напоминание, дата, Enter', () => {
  test('категории — сеткой с названиями под значками; выбор одним касанием закрывает список', async ({ page }, testInfo) => {
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '25');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    const grid = dlg.getByRole('group', { name: 'Категория' });
    await expect(grid).toBeVisible();
    // 3 в ряд на узком телефоне, 4 — на широком: у ячеек первого ряда одна и та же верхняя граница, у следующей — уже другая
    const tops = await grid.getByRole('button').evaluateAll((els) => els.slice(0, 5).map((e) => Math.round(e.getBoundingClientRect().top)));
    const perRow = tops.filter((t) => t === tops[0]).length;
    expect([3, 4]).toContain(perRow);
    // слова не рвутся посреди: ни у одной подписи нет переноса внутри слова
    const broken = await grid.getByRole('button').evaluateAll((els) =>
      els.filter((e) => {
        const label = e.querySelector('span:not([aria-hidden])');
        return label ? label.scrollWidth > label.clientWidth + 1 : false;
      }).length,
    );
    expect(broken, 'подписи категорий помещаются по ширине ячейки').toBe(0);
    await expect(dlg.getByRole('button', { name: 'Без категории', exact: true })).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Новая категория' })).toBeVisible();
    await shot(page, '43-category-grid', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(500);
    await shot(page, '43-category-grid-dark', testInfo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    await grid.getByRole('button', { name: 'Еда', exact: true }).click();
    await expect(grid).toBeHidden();
    await expect(dlg.getByRole('button', { name: 'Категория: Еда' })).toBeVisible();
    await saveNewTx(dlg);
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Еда');
  });

  test('без категории: первое «Сохранить» напоминает и открывает сетку, «Без категории» — осознанный выбор', async ({ page }, testInfo) => {
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '40');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText(CATEGORY_NUDGE)).toBeVisible();
    await expect(dlg.getByRole('group', { name: 'Категория' })).toBeVisible();
    await expect(dlg).toBeVisible(); // ничего не сохранено, окно на месте
    await shot(page, '43-category-nudge', testInfo);
    await dlg.getByRole('button', { name: 'Без категории', exact: true }).click();
    await expect(dlg.getByRole('button', { name: 'Категория: без категории' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click(); // напоминания больше нет
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(rows(page).first()).toContainText('Без категории');
  });

  test('второе «Сохранить» после напоминания сохраняет без категории', async ({ page }) => {
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '9');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText(CATEGORY_NUDGE)).toBeVisible();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click(); // сразу же: двойной тап не считается
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(450);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
  });

  test('узкий низкий экран 320×568: сетка и «Без категории» на виду, без горизонтальной прокрутки', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'размер окна задаётся только для телефона');
    await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '5');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg.getByText(CATEGORY_NUDGE)).toBeVisible();
    const skip = dlg.getByRole('button', { name: 'Без категории', exact: true });
    await expect(skip).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const box = await skip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, '43-nudge-320', testInfo);
  });

  test('цифры идут 1-2-3 сверху, подвал — в одну строку («Ещё одну» и «Сохранить»)', async ({ page }) => {
    await openApp(page);
    const dlg = await openNew(page);
    const pad = dlg.getByRole('group', { name: 'Цифровая клавиатура' });
    const first = await pad.getByRole('button').evaluateAll((els) => els.slice(5, 14).map((e) => (e.textContent ?? '').trim()));
    expect(first).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    const more = dlg.getByRole('button', { name: 'Сохранить и добавить ещё одну' });
    const save = dlg.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(more).toContainText('Ещё одну');
    const [hm, hs] = await Promise.all([more.boundingBox(), save.boundingBox()]);
    expect(hm?.height ?? 99).toBeLessThanOrEqual(56);
    expect(hs?.height ?? 99).toBeLessThanOrEqual(56);
    expect(Math.abs((hm?.y ?? 0) - (hs?.y ?? 1)), 'обе кнопки в одной строке').toBeLessThan(2);
  });

  test('дата в будущем: вопрос «Сохранить?»; «Изменить дату» возвращает к форме, прошлое и сегодня — без вопроса', async ({ page }) => {
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '15');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда', exact: true }).click();
    await dlg.getByRole('button', { name: /^Дата:/ }).click();
    await dlg.getByRole('group', { name: 'Дата' }).getByRole('button', { name: 'Другая дата' }).click();
    await dlg.getByLabel('Дата операции').fill('2090-05-17');
    await dlg.getByRole('button', { name: 'Готово', exact: true }).click();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Дата в будущем' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('17.05.2090');
    await ask.getByRole('button', { name: 'Изменить дату' }).click();
    await expect(ask).toBeHidden();
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await ask.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
  });

  test('Enter в поле суммы сохраняет, Ctrl+Enter — сохраняет и открывает следующую', async ({ page }) => {
    await openApp(page);
    const dlg = await openNew(page);
    await tapAmount(page, '15');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда', exact: true }).click();
    const field = dlg.getByRole('textbox', { name: /^Сумма/ });
    await field.focus();
    await page.keyboard.press('Control+Enter');
    await expect(field).toHaveValue(''); // сохранилось, форма очищена, окно открыто
    await expect(dlg).toBeVisible();
    await tapAmount(page, '7');
    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    await dlg.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Транспорт', exact: true }).click();
    await field.focus();
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(2);
  });
});
