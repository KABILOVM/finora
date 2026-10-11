import { expect, openApp, openFromMore, test } from '../helpers';

/**
 * Узкий экран 320 px (iPhone SE, маленькие Android). Строка перевода в предпросмотре показывает обе суммы без переноса
 * (shrink-0 + whitespace-nowrap), и при крупных суммах (сумы, тенге, рубли — миллионы) название строки сжимается до ширины
 * в пару пикселей и ломается по букве в столбик.
 */
test.use({ viewport: { width: 320, height: 640 } });

const HEAD = 'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const CSV =
  [
    HEAD,
    '2026-09-01,Зарплата,Работодатель,Сентябрь,,0,,Карта Алиф,15000000.00,UZS',
    '2026-09-02,,,Обмен сум на сомони,Карта Алиф,15000000.00,UZS,Наличные,12750.00,TJS',
  ].join('\n') + '\n';

test('320 px: название перевода в предпросмотре не ломается по букве в столбик', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'узкий экран задан в самом тесте; одного проекта достаточно');
  await openApp(page);
  await openFromMore(page, 'Импорт из Zenmoney');
  await page.getByLabel('Файл Zenmoney').setInputFiles({ name: 'z.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
  await expect(page.getByRole('region', { name: 'Итоги разбора файла' })).toBeVisible();

  const title = page.getByText(/^Перевод: /);
  await expect(title).toBeVisible();
  const box = await title.boundingBox();
  expect(box, 'название перевода должно быть на экране').not.toBeNull();
  // нормальное название «Перевод: Карта Алиф → Наличные» занимает 2–3 строки; в столбик по букве — десятки строк и ширина в несколько пикселей
  expect(box!.width, 'ширина названия строки перевода, px').toBeGreaterThanOrEqual(100);
  expect(box!.height, 'высота названия строки перевода, px').toBeLessThanOrEqual(120);
});
