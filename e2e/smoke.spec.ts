import { expect, test } from '@playwright/test';

// Самый простой «живой» тест: приложение открывается и показывает главный экран.
test('приложение открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page).toHaveTitle(/Finora/);
});
