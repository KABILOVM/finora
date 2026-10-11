import { addTx, dismissToasts, expect, goSection, homeTotalText, money, openApp, test } from '../helpers';

test.describe('13. Сбои и плохие данные', () => {
  test('хранилище браузера недоступно (как в приватной вкладке): честный экран ошибки, а не пустое приложение', async ({ page, errors }) => {
    errors.allow(/Не удалось открыть данные/); // приложение само пишет причину в консоль — это и есть проверяемое поведение
    await page.addInitScript(() => {
      // имитируем запрет хранения данных сайта
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    });
    await page.goto('/');
    const screen = page.getByRole('alert').filter({ hasText: 'Не удалось открыть хранилище данных' });
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
    // не делает вид, что всё в порядке
    await expect(page.getByText('Синхронизировано')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Добавить операцию' })).toHaveCount(0);
  });

  test('плохие файлы копии: понятная ошибка, данные не тронуты', async ({ page }) => {
    await openApp(page);
    await addTx(page, { amount: '33', category: 'Еда' });
    await dismissToasts(page);
    await goSection(page, 'Настройки');
    const input = page.getByLabel('Файл копии');
    const bad: { name: string; mimeType: string; content: string }[] = [
      { name: 'мусор.json', mimeType: 'application/json', content: 'это не json' },
      { name: 'пусто.json', mimeType: 'application/json', content: '' },
      { name: 'чужой.json', mimeType: 'application/json', content: JSON.stringify({ format: 'other-app', version: 1 }) },
      { name: 'массив.json', mimeType: 'application/json', content: '[1,2,3]' },
    ];
    for (const f of bad) {
      await input.setInputFiles({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.content, 'utf8') });
      // либо сразу ошибка чтения, либо подтверждение → ошибка проверки при загрузке
      const confirm = page.getByRole('alertdialog');
      const alert = page.getByRole('region', { name: 'Резервная копия' }).getByRole('alert');
      await expect(confirm.or(alert).first(), `файл ${f.name}`).toBeVisible();
      if (await confirm.isVisible()) await confirm.getByRole('button', { name: /^Загрузить/ }).click();
      await expect(alert, `файл ${f.name}: ошибка должна быть показана человеку`).toBeVisible();
      await expect(page.getByText('Копия загружена')).toHaveCount(0);
    }
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('−33 с.'));
  });
});
