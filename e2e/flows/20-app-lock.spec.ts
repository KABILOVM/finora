import type { CDPSession, Page } from '@playwright/test';
import { createWallet, expect, goSection, isPhone, openApp, shot, test, walletRowText } from '../helpers';
import { headersFor, startHeaderServer, type HeaderServer, DIST } from '../sec/helpers';

/* ---------------------------------------------------------------------------------------------
 * 20. Замок приложения (Face ID / отпечаток) в Chromium с ВИРТУАЛЬНЫМ аутентификатором (CDP: WebAuthn.*).
 * WebAuthn не работает на IP-адресе (rp.id должен быть доменом), поэтому открываем приложение по localhost, а не по 127.0.0.1.
 * Локальный режим (без облака). Настоящего Face ID здесь нет: виртуальный аутентификатор отвечает «подтверждено» или «отказ».
 * ------------------------------------------------------------------------------------------- */

const PORT = process.env.E2E_PORT ?? '4173';
test.use({ baseURL: `http://localhost:${PORT}` });

interface Authenticator {
  cdp: CDPSession;
  /** true — «Face ID сошёлся», false — отказ. */
  verified(v: boolean): Promise<void>;
}

async function addAuthenticator(page: Page): Promise<Authenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    verified: async (v) => {
      await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v });
    },
  };
}

/** Записывает, что видно в каждый кадр и при каждом изменении страницы: не было ли момента, когда содержимое есть, а заслонки нет. */
async function watchFirstFrame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = { armed: true, first: null as null | { cover: boolean }, violations: 0, samples: 0 };
    (window as unknown as { __lockLog: unknown }).__lockLog = log;
    const check = () => {
      if (!log.armed) return;
      const root = document.getElementById('root');
      if (!root || root.childElementCount === 0) return;
      const cover = document.querySelector('[data-lock-cover]') !== null;
      if (log.first === null) log.first = { cover };
      log.samples++;
      if (!cover) log.violations++;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    const loop = () => {
      check();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

const lockLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __lockLog: { armed: boolean; first: { cover: boolean } | null; violations: number; samples: number } }).__lockLog);
const disarm = (page: Page) => page.evaluate(() => void ((window as unknown as { __lockLog: { armed: boolean } }).__lockLog.armed = false));

const lockSwitch = (page: Page) => page.getByRole('switch', { name: 'Открывать по Face ID / отпечатку' });
const cover = (page: Page) => page.getByRole('dialog', { name: 'Sumoima закрыта' });
const openButton = (page: Page) => page.getByRole('button', { name: 'Открыть по Face ID / отпечатку' });

/** Включить замок в Настройках (аутентификатор подтверждает) и вернуться на «Главную». */
async function enableLock(page: Page): Promise<void> {
  await goSection(page, 'Настройки');
  await expect(lockSwitch(page)).toBeEnabled();
  await lockSwitch(page).click();
  await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Замок включён.')).toBeVisible();
}

test.describe('20. Замок приложения', () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page) && !/вёрстка/.test(test.info().title), 'сценарии замка идут на desktop; на телефоне — только вёрстка заслонки');
    return page;
  });

  test('включить → перезагрузка → заслонка с первого кадра, содержимое недоступно → отказ не открывает → подтверждение открывает', async ({ page }, testInfo) => {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await enableLock(page);
    await shot(page, 'lock-settings-on', testInfo);

    // Перезагрузка: аутентификатор «не узнаёт» человека, чтобы автозапрос при показе не открыл заслонку сам
    await auth.verified(false);
    await watchFirstFrame(page);
    await page.reload();
    await expect(cover(page)).toBeVisible();

    const log = await lockLog(page);
    expect(log.first, 'содержимое страницы появилось только вместе с заслонкой').toEqual({ cover: true });
    expect(log.violations, `кадров без заслонки при непустой странице (из ${log.samples})`).toBe(0);
    await shot(page, 'lock-cover', testInfo);

    // Приложение под заслонкой есть в DOM, но недоступно: ни роли, ни фокуса, ни клика
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0);
    expect(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('root')?.getAttribute('aria-hidden'))).toBe('true');
    expect(await page.evaluate(() => document.querySelector('nav[aria-label="Основная навигация"]') !== null)).toBe(true);
    await expect(page.locator('nav[aria-label="Основная навигация"]').getByRole('link', { name: 'Операции' }).click({ timeout: 1500 })).rejects.toThrow();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const insideApp = await page.evaluate(() => !!document.activeElement?.closest('#root'));
      expect(insideApp, `фокус ушёл в закрытое приложение после ${i + 1}-го Tab`).toBe(false);
    }
    // Клик мышью «сквозь» заслонку по месту, где под ней пункт меню
    const spot = await page.evaluate(() => {
      const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent?.trim().startsWith('Операции') && x.getBoundingClientRect().width > 0);
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    expect(spot, 'пункт меню под заслонкой найден').not.toBeNull();
    const urlBefore = page.url();
    await page.mouse.click(spot!.x, spot!.y);
    await page.waitForTimeout(300);
    expect(page.url(), 'клик сквозь заслонку не перешёл на другую страницу').toBe(urlBefore);
    // Esc и «назад» заслонку не снимают
    await page.keyboard.press('Escape');
    // «Назад» от человека заслонка отменяет (переход не происходит, поэтому goBack не дожидается его конца — ждём недолго)
    await page.goBack({ timeout: 2000 }).catch(() => undefined);
    await expect(cover(page)).toBeVisible();
    expect(page.url(), 'Esc и «назад» не меняют страницу под заслонкой').toBe(urlBefore);

    // Отказ подтверждения не открывает
    await openButton(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не подтверждено' })).toBeVisible();
    await expect(cover(page)).toBeVisible();

    // Подтверждение открывает, приложение работает
    await auth.verified(true);
    await disarm(page);
    await openButton(page).click();
    await expect(cover(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('[inert]') === null && document.querySelector('[aria-hidden="true"][inert]') === null)).toBe(true);
    await goSection(page, 'Кошельки');
  });

  test('выключить замок можно только после подтверждения', async ({ page }) => {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await enableLock(page);

    await auth.verified(false);
    await lockSwitch(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не подтверждено. Замок остался включённым.' })).toBeVisible();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('finora:appLock:')))).toBe(true);

    await auth.verified(true);
    await lockSwitch(page).click();
    await expect(page.getByText('Замок выключен.')).toBeVisible();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('finora:appLock:')))).toBe(false);

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();
    await expect(cover(page)).toHaveCount(0);
  });

  test('отказ при включении: замок не включается, ничего не сохраняется', async ({ page }) => {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await auth.verified(false);
    await goSection(page, 'Настройки');
    await expect(lockSwitch(page)).toBeEnabled();
    await lockSwitch(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Замок не включён' })).toBeVisible();
    await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('finora:appLock:')))).toBe(false);
  });

  test('«Не получается? Снять замок» (локальный режим): замок снят, записи на месте и после перезагрузки замка нет', async ({ page }) => {
    await openApp(page);
    await createWallet(page, { name: 'Копилка', opening: '150' });
    const auth = await addAuthenticator(page);
    await enableLock(page);
    await auth.verified(false);
    await page.reload();
    await expect(cover(page)).toBeVisible();

    await page.getByRole('button', { name: 'Не получается? Снять замок' }).click();
    await expect(page.getByRole('heading', { name: 'Снять замок?' })).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(cover(page)).toBeVisible();
    await page.getByRole('button', { name: 'Не получается? Снять замок' }).click();
    await page.getByRole('button', { name: 'Снять замок', exact: true }).click();
    await expect(cover(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();

    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Копилка')).toContain('150');
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();
    await expect(cover(page)).toHaveCount(0);
  });

  test('время закрытия: «через 1 минуту» не закрывает сразу, «Сразу» закрывает при скрытии; приложение при этом не пересоздаётся', async ({ page }) => {
    await openApp(page);
    await addAuthenticator(page);
    await enableLock(page);
    const hide = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);

    await page.evaluate(() => void ((window as unknown as { __marker: Element | null }).__marker = document.querySelector('nav[aria-label="Основная навигация"]')));
    await hide(true);
    await hide(false);
    await expect(cover(page)).toHaveCount(0); // по умолчанию — через минуту

    await page.getByRole('radio', { name: 'Сразу' }).click();
    await hide(true);
    await expect(cover(page)).toBeVisible();
    await hide(false);
    await expect(cover(page)).toBeVisible(); // само не открывается
    expect(await page.evaluate(() => (window as unknown as { __marker: Element }).__marker.isConnected), 'приложение под заслонкой не пересоздано').toBe(true);

    await openButton(page).click(); // аутентификатор подтверждает
    await expect(cover(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __marker: Element }).__marker.isConnected)).toBe(true);
    await expect(page.getByRole('radio', { name: 'Сразу' })).toHaveAttribute('aria-checked', 'true');
  });

  test('окно появилось под заслонкой (адрес #/add): фокус остаётся на заслонке, Tab ходит по её кнопкам по кругу, Esc и «назад» окно не трогают', async ({ page }) => {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await enableLock(page);
    await auth.verified(false);
    await page.reload();
    await expect(cover(page)).toBeVisible();
    await expect(openButton(page)).toBeFocused();

    const sheetExists = () =>
      page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.includes('Новая операция') && !d.hasAttribute('data-lock-cover')));
    await page.evaluate(() => void (location.hash = '#/add'));
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.includes('Новая операция')));
    // окно, пока открывалось, могло забрать фокус и потерять его вместе с доступностью: заслонка забирает его обратно
    await expect(openButton(page)).toBeFocused();

    const leave = page.getByRole('button', { name: 'Не получается? Снять замок' });
    await page.keyboard.press('Tab');
    await expect(leave).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(openButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(leave).toBeFocused();

    const urlBefore = page.url();
    await page.keyboard.press('Escape');
    await page.goBack({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
    expect(page.url(), 'Esc и «назад» не меняют адрес под заслонкой').toBe(urlBefore);
    expect(await sheetExists(), 'окно под заслонкой на месте').toBe(true);
    await expect(cover(page)).toBeVisible();
  });

  test('устройство без Face ID / отпечатка: причина простыми словами, переключатель недоступен', async ({ page }) => {
    await openApp(page);
    await goSection(page, 'Настройки');
    await expect(page.getByText('Проверяем…')).toHaveCount(0);
    await expect(lockSwitch(page)).toBeDisabled();
    await expect(page.getByText(/Это устройство не умеет/)).toBeVisible();
  });
});

test.describe('20. Замок: вёрстка заслонки и раздела', () => {
  test('вёрстка: заслонка и раздел «Блокировка» на своих размерах, ничего не обрезано (в том числе на 320 px)', async ({ page }, testInfo) => {
    await openApp(page);
    const auth = await addAuthenticator(page);
    await enableLock(page);
    await shot(page, 'lock-section-on', testInfo);
    await auth.verified(false);
    await page.reload();
    await expect(cover(page)).toBeVisible();

    const sizes = isPhone(page) ? [{ width: 390, height: 844 }, { width: 320, height: 568 }] : [{ width: 1280, height: 800 }];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect(cover(page)).toBeVisible();
      const m = await page.evaluate(() => {
        const dlg = document.querySelector('[data-lock-cover]') as HTMLElement;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const items = [...dlg.querySelectorAll('button, h2, p')].map((e) => {
          const r = e.getBoundingClientRect();
          return { tag: e.tagName, text: (e.textContent ?? '').slice(0, 40), left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height };
        });
        return { vw, vh, scrollW: document.documentElement.scrollWidth, items, opaque: getComputedStyle(dlg).backgroundColor, dlg: dlg.getBoundingClientRect().toJSON() as { width: number; height: number } };
      });
      expect(m.scrollW, `горизонтальной прокрутки нет (${size.width}px)`).toBeLessThanOrEqual(m.vw);
      for (const it of m.items) {
        expect(it.left, `${it.text} не обрезан слева (${size.width}px)`).toBeGreaterThanOrEqual(0);
        expect(it.right, `${it.text} не обрезан справа (${size.width}px)`).toBeLessThanOrEqual(m.vw + 0.5);
      }
      for (const it of m.items.filter((i) => i.tag === 'BUTTON')) expect(it.h, `кнопка «${it.text}» ≥ 44px`).toBeGreaterThanOrEqual(44);
      expect(m.dlg.width).toBeGreaterThanOrEqual(m.vw - 1);
      expect(m.dlg.height).toBeGreaterThanOrEqual(m.vh - 1);
      expect(m.opaque, 'фон заслонки непрозрачный').not.toMatch(/rgba\(.*, 0\)$|transparent/);
      await shot(page, `lock-cover-${size.width}`, testInfo);
    }

    // сам раздел в настройках на узком экране
    await auth.verified(true);
    await openButton(page).click();
    await expect(cover(page)).toHaveCount(0);
    if (isPhone(page)) {
      await goSection(page, 'Настройки');
      const section = page.getByRole('region', { name: 'Блокировка приложения' });
      await section.scrollIntoViewIfNeeded();
      const w = await section.evaluate((el) => ({ right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left, vw: window.innerWidth, scrollW: document.documentElement.scrollWidth }));
      expect(w.left).toBeGreaterThanOrEqual(0);
      expect(w.right).toBeLessThanOrEqual(w.vw + 0.5);
      expect(w.scrollW).toBeLessThanOrEqual(w.vw);
      await shot(page, 'lock-section-320', testInfo);
    }
  });
});

/* С настоящими заголовками из vercel.json (vite preview их не отдаёт): раздел должен вести себя честно при ЛЮБОЙ их настройке. */
test.describe('20. Замок и заголовки безопасности из vercel.json', () => {
  let srv: HeaderServer;
  test.beforeAll(async () => {
    srv = await startHeaderServer(DIST);
  });
  test.afterAll(async () => {
    await srv?.close();
  });

  test('если Permissions-Policy запрещает WebAuthn — раздел прямо говорит об этом и не даёт включить «мёртвый» замок; если разрешает — замок работает', async ({ page }) => {
    test.skip(isPhone(page), 'проверка заголовков одинакова на всех экранах');
    const policy = headersFor('/')['permissions-policy'] ?? '';
    const blocked = /publickey-credentials-get=\(\)/.test(policy);
    test.info().annotations.push({ type: 'permissions-policy', description: blocked ? 'ЗАПРЕЩАЕТ publickey-credentials-get (замок в продакшене не заработает)' : 'разрешает WebAuthn' });
    const url = new URL(srv.origin);
    await page.goto(`http://localhost:${url.port}/#/`);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();
    await addAuthenticator(page);
    await goSection(page, 'Настройки');
    await expect(page.getByText('Проверяем…')).toHaveCount(0);
    if (blocked) {
      await expect(lockSwitch(page)).toBeDisabled();
      await expect(page.getByText(/Замок отключён настройками сайта/).first()).toBeVisible();
    } else {
      await expect(lockSwitch(page)).toBeEnabled();
      await lockSwitch(page).click();
      await expect(lockSwitch(page)).toHaveAttribute('aria-checked', 'true');
    }
  });
});
