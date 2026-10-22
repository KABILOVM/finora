import { addTx, dismissToasts, expect, goSection, openApp, shot, sheet, test } from '../helpers';

/** 'ГГГГ-ММ-ДД' за n дней до сегодня по местным часам браузера (так же считает приложение). */
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test.describe('50. Пропущенные дни на «Главной»', () => {
  test('последняя запись 5 дней назад: плашка с двумя кнопками; «Внести траты» — форма на вчера; «Ничего не тратил(а)» убирает и помнит', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'iphone') await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);

    // новый человек без записей: плашки нет
    await expect(page.getByTestId('missed-days')).toHaveCount(0);

    await addTx(page, { amount: '10', category: 'Еда', date: daysAgo(5) });
    await dismissToasts(page);
    await goSection(page, 'Главная');

    const card = page.getByTestId('missed-days');
    await expect(card).toBeVisible();
    await expect(card).toContainText('4 дня без записей — всё в порядке?');
    // вёрстка: плашка целиком на экране, кнопки не меньше 44 px, горизонтальной прокрутки нет
    await expect(card).toBeInViewport({ ratio: 1 });
    for (const name of ['Внести траты', 'Ничего не тратил(а)']) {
      const box = await card.getByText(name, { exact: true }).boundingBox();
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, '50-missed-days', testInfo);

    // «Внести траты» — новая операция сразу на вчерашнем дне
    await card.getByRole('link', { name: 'Внести траты' }).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: /^Дата:/ })).toContainText('Вчера');
    await dlg.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toBeHidden();

    // «Ничего не тратил(а)» — плашка уходит и не возвращается после перезагрузки
    await page.getByTestId('missed-days').getByRole('button', { name: 'Ничего не тратил(а)' }).click();
    await expect(page.getByTestId('missed-days')).toHaveCount(0);
    await dismissToasts(page);
    await page.reload();
    await goSection(page, 'Главная');
    await expect(page.getByTestId('missed-days')).toHaveCount(0);
  });

  test('запись вчера — плашки нет', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '10', category: 'Еда', date: daysAgo(1) });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    await expect(page.getByTestId('missed-days')).toHaveCount(0);
  });
});
