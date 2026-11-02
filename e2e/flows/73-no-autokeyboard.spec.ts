import type { Page } from '@playwright/test';
import { addLink, expect, goSection, isPhone, openApp, sheet, test } from '../helpers';

/** Что сейчас под курсором: тег и признак «текстовое поле, открывающее экранную клавиатуру». */
const focusInfo = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    const typing = !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.getAttribute('inputmode') !== 'none' && !el.readOnly && ['text', 'search', 'email', 'tel', 'number', 'password', ''].includes(el.type)));
    return { tag: el?.tagName ?? '', typing };
  });

test.describe('73. Экранная клавиатура не выезжает сама (телефон)', () => {
  test('«Новый кошелёк»: на телефоне курсора в «Названии» нет, пока не нажали на поле; на ПК он там сразу', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = sheet(page, 'Новый кошелёк');
    await expect(dlg).toBeVisible();
    const name = dlg.getByRole('textbox', { name: 'Название' });
    if (isPhone(page)) {
      await expect(name).not.toBeFocused();
      expect((await focusInfo(page)).typing).toBe(false);
      await name.click();
      await expect(name).toBeFocused();
    } else {
      await expect(name).toBeFocused();
    }
  });

  test('«Новая операция»: сумма под курсором (своя цифровая клавиатура), «Заметка» и «Новая» категория — без курсора на телефоне', async ({ page }) => {
    await openApp(page);
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toBeFocused();

    await dlg.getByRole('button', { name: 'Заметка', exact: true }).click();
    const note = dlg.getByRole('textbox', { name: 'Заметка' });
    await expect(note).toBeVisible();
    if (isPhone(page)) {
      await expect(note).not.toBeFocused();
      expect((await focusInfo(page)).typing).toBe(false);
    } else {
      await expect(note).toBeFocused();
    }
    await dlg.getByRole('button', { name: 'Готово', exact: true }).click();

    await dlg.getByRole('button', { name: /^Категория:/ }).click();
    if (isPhone(page)) expect((await focusInfo(page)).typing).toBe(false);
    await dlg.getByRole('button', { name: 'Новая категория' }).click();
    const fresh = dlg.getByRole('textbox', { name: 'Название новой категории' });
    await expect(fresh).toBeVisible();
    if (isPhone(page)) await expect(fresh).not.toBeFocused();
    else await expect(fresh).toBeFocused();
  });
});
