import type { CDPSession, Page } from '@playwright/test';
import { addLink, expect, goSection, isPhone, openApp, sheet, tapAmount, test } from '../helpers';

/* ---------------------------------------------------------------------------------------------
 * ЛОМАТЕЛЬ: замок приложения в настоящем Chromium (виртуальный Face ID, локальный режим, по localhost — на IP WebAuthn не работает).
 * Каждый тест — попытка доказать поломку. Падающий тест = находка.
 * ------------------------------------------------------------------------------------------- */

const PORT = process.env.E2E_PORT ?? '4173';
test.use({ baseURL: `http://localhost:${PORT}` });

async function addAuthenticator(page: Page): Promise<{ cdp: CDPSession; verified(v: boolean): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, verified: async (v) => void (await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v })) };
}

const lockSwitch = (page: Page) => page.getByRole('switch', { name: 'Открывать по Face ID / отпечатку' });
const cover = (page: Page) => page.getByRole('dialog', { name: 'Finora закрыта' });

const hide = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

/** Окна приложения, которые сейчас есть в странице (в том числе недоступные под заслонкой): подписи. */
const dialogTitles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((d) => document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''),
  );

test.describe('auth-adversarial: замок + окно приложения под ним', () => {
  /** Замок «Сразу» включён, открыто окно «Новая операция» с набранной суммой, приложение свёрнуто и развёрнуто: заслонка закрыта. */
  async function lockedOverDraft(page: Page) {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await goSection(page, 'Настройки');
    await lockSwitch(page).click();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Сразу' }).click();
    await addLink(page).click();
    await expect(sheet(page, 'Новая операция')).toBeVisible();
    await tapAmount(page, '1500');
    await auth.verified(false); // дальше открыть нечем
    await hide(page, true);
    await expect(cover(page)).toBeVisible();
    await hide(page, false);
    await expect(cover(page)).toBeVisible();
    expect(await dialogTitles(page)).toContain('Новая операция');
    return auth;
  }

  test('Esc на заслонке не закрывает окно «Новая операция» под ней (набранная сумма не пропадает)', async ({ page }) => {
    test.skip(isPhone(page), 'клавиатурный сценарий — на desktop');
    await lockedOverDraft(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await dialogTitles(page), 'окно под заслонкой закрылось от Esc, набранное потеряно').toContain('Новая операция');
    await expect(cover(page)).toBeVisible();
  });

  test('жест «назад» на заслонке не закрывает окно «Новая операция» под ней', async ({ page }) => {
    await lockedOverDraft(page);
    // заслонка отменяет «назад» от человека: переход не происходит, и goBack его конца не дожидается — ждём недолго
    await page.goBack({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(await dialogTitles(page), 'окно под заслонкой закрылось от «назад», набранное потеряно').toContain('Новая операция');
  });

  test('Tab на заслонке доходит до «Не получается?» (окно под ней не глотает Tab)', async ({ page }) => {
    test.skip(isPhone(page), 'клавиатурный сценарий — на desktop');
    await lockedOverDraft(page);
    await expect(page.getByRole('button', { name: 'Открыть по Face ID / отпечатку' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Не получается? Снять замок' }), 'с клавиатуры до запасного выхода не добраться').toBeFocused();
  });
});

test.describe('auth-adversarial: данные не уходят из-под заслонки', () => {
  test('Ctrl+A / Ctrl+C на заслонке не копирует текст закрытого приложения', async ({ page, context }) => {
    test.skip(isPhone(page), 'клавиатурные сценарии — на desktop');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);
    await createWalletForCopy(page);
    const auth = await addAuthenticator(page);
    await goSection(page, 'Настройки');
    await lockSwitch(page).click();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await auth.verified(false);
    await page.reload();
    await expect(cover(page)).toBeVisible();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR'));
    test.info().annotations.push({ type: 'selection', description: JSON.stringify(sel.slice(0, 200)) });
    test.info().annotations.push({ type: 'clipboard', description: JSON.stringify(clip.slice(0, 200)) });
    expect(sel, 'выделение — это сама заслонка, а не приложение под ней').toContain('Finora закрыта');
    expect(sel, 'выделение захватило текст закрытого приложения').not.toMatch(/Копилка|Главная|Кошельки/);
    expect(clip, 'буфер обмена получил текст закрытого приложения').not.toMatch(/Копилка|Главная|Кошельки/);
  });
});

async function createWalletForCopy(page: Page) {
  await goSection(page, 'Кошельки');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dlg = sheet(page, 'Новый кошелёк');
  await dlg.getByRole('textbox', { name: 'Название' }).fill('Копилка');
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
}

test.describe('auth-adversarial: окно открылось по ссылке уже под заслонкой', () => {
  test('адрес #/add при закрытой заслонке: окно недоступно, фокус и набор с клавиатуры его не достигают', async ({ page }) => {
    test.skip(isPhone(page), 'клавиатурный сценарий — на desktop');
    await openApp(page);
    const auth = await addAuthenticator(page);
    await goSection(page, 'Настройки');
    await lockSwitch(page).click();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await auth.verified(false);
    await page.reload();
    await expect(cover(page)).toBeVisible();

    await page.evaluate(() => void (location.hash = '#/add'));
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Новая операция')) as HTMLElement | undefined;
      const active = document.activeElement as HTMLElement | null;
      return {
        sheetExists: !!dlg,
        sheetInert: !!dlg?.closest('[inert]'),
        activeInSheet: !!(dlg && active && dlg.contains(active)),
        activeInCover: !!active?.closest('[data-lock-cover]'),
        activeTag: active?.tagName ?? null,
      };
    });
    test.info().annotations.push({ type: 'state', description: JSON.stringify(state) });
    expect(state.sheetExists).toBe(true);
    expect(state.sheetInert, 'окно под заслонкой недоступно').toBe(true);
    expect(state.activeInSheet, 'фокус не в окне под заслонкой').toBe(false);
    await expect(cover(page)).toBeVisible();
  });
});
