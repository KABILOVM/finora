import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { skipOnboardingInAdvance } from '../helpers';
import { join } from 'node:path';
import { addExpense, buildCopy, cacheDump, listFiles, makeWorkCopy, patchFile, precacheUrls, startStatic, waitForSw, type StaticServer } from './helpers';

// 4. Обновление версии A -> B на одной раздаче. Исходники копируются во временную папку, репозиторий не трогаем.
// Версия различима и в главном бандле (подпись «Ещё A/B» в меню), и в ленивом чанке (заголовок «Кошельки A/B»).
test.setTimeout(120_000);

let srv: StaticServer;
let dirA: string;
let dirB: string;
let dirCrash: string;

const NAV = 'src/app/sections.ts'; // MORE_TITLE — подпись «Ещё» в нижней панели
const WALLETS = 'src/features/wallets/WalletsPage.tsx';

test.beforeAll(async ({ browserName: _b }, info) => {
  if (info.project.name !== 'desktop') return; // сборки тяжёлые: только для проекта desktop
  test.setTimeout(240_000);
  const copy = makeWorkCopy('upd');
  patchFile(join(copy, NAV), "MORE_TITLE = 'Ещё'", "MORE_TITLE = 'Ещё A'");
  patchFile(join(copy, WALLETS), 'title="Кошельки"', 'title="Кошельки A"');
  dirA = join(copy, '..', 'upd-dist-A');
  buildCopy(copy, dirA);
  patchFile(join(copy, NAV), "MORE_TITLE = 'Ещё A'", "MORE_TITLE = 'Ещё B'");
  patchFile(join(copy, WALLETS), 'title="Кошельки A"', 'title="Кошельки B"');
  dirB = join(copy, '..', 'upd-dist-B');
  buildCopy(copy, dirB);
  // Версия A2: как A, но «падает» при отрисовке, если в localStorage стоит finora-test-crash=1 (имитация ошибки в выпущенной версии).
  const copy2 = makeWorkCopy('upd2');
  patchFile(join(copy2, NAV), "MORE_TITLE = 'Ещё'", "MORE_TITLE = 'Ещё A'");
  patchFile(
    join(copy2, 'src/App.tsx'),
    'export function AppRoutes() {',
    "export function AppRoutes() {\n  if (typeof localStorage !== 'undefined' && localStorage.getItem('finora-test-crash') === '1') throw new Error('test crash');",
  );
  dirCrash = join(copy2, '..', 'upd-dist-crash');
  buildCopy(copy2, dirCrash);
  srv = await startStatic(dirA);
});
test.afterAll(async () => {
  await srv?.close();
});
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(info.project.name !== 'desktop', 'один раз, на «desktop»');
  srv.setRoot(dirA);
  srv.log.length = 0;
});

const checkUpdate = (page: Page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  });
const prompt = (page: Page) => page.getByText('Доступна новая версия');
const navLabel = (page: Page) => page.getByRole('navigation').first().getByRole('link', { name: /^Ещё/ });

async function openA(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  await page.goto(srv.url);
  await navLabel(page).waitFor();
  await waitForSw(page);
  return page;
}

test('сборки A и B действительно разные (и в бандле, и в ленивом чанке)', () => {
  const a = precacheUrls(dirA).filter((u) => /^assets\/(index|WalletsPage)-/.test(u));
  const b = precacheUrls(dirB).filter((u) => /^assets\/(index|WalletsPage)-/.test(u));
  expect(a.length).toBe(3); // index js+css, WalletsPage
  expect(a.filter((u) => b.includes(u)).filter((u) => u.endsWith('.js'))).toEqual([]);
});

test('A открыта, выложена B: подсказка «Доступна новая версия», ввод не прерывается, работает A; «Обновить» -> B, данные целы, кэши чистые', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const errors: string[] = [];
  const page = await openA(ctx);
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(navLabel(page)).toHaveText('Ещё A');
  await addExpense(page, '321');

  // человек посреди ввода новой операции
  await page.getByRole('link', { name: 'Добавить операцию' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.locator('input.money').first().fill('55');

  // выкладка B (файлов A на сервере больше нет, как на обычном хостинге)
  srv.setRoot(dirB);
  await checkUpdate(page);
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 });

  // пока не нажали «Обновить»: всё ещё A, шит и введённая сумма на месте
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input.money').first()).toHaveValue('55');
  expect(await page.evaluate(() => document.body.textContent)).toContain('Ещё A');
  expect(await page.evaluate(() => document.body.textContent)).not.toContain('Ещё B');
  // кнопка «Обновить» доступна, даже когда открыт шит (не закрыта им)
  await page.getByRole('button', { name: 'Обновить' }).click({ trial: true });

  // продолжаем работу в A: сохраняем ввод и открываем ЛЕНИВУЮ страницу, чанк которой в этом сеансе не грузился
  await dialog.getByRole('button', { name: /^Категория:/ }).click();
  await dialog.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Еда' }).first().click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки A' })).toBeVisible();
  await expect(prompt(page)).toBeVisible();

  // «Обновить»
  await page.getByRole('button', { name: 'Обновить' }).click();
  await expect(navLabel(page)).toHaveText('Ещё B', { timeout: 20_000 });
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки B' })).toBeVisible();
  await page.goto(`${srv.url}#/transactions`);
  await expect(page.getByText('−321 с.').first()).toBeVisible();
  await expect(page.getByText('−55 с.').first()).toBeVisible();

  // старые кэши очищены: один кэш, внутри ровно файлы B, ни одного файла A
  const dump = await cacheDump(page);
  expect(Object.keys(dump).length, Object.keys(dump).join(', ')).toBe(1);
  const cached = Object.values(dump)[0]!.map((u) => new URL(u).pathname.replace(/^\//, '').replace(/\?.*$/, ''));
  const onlyA = precacheUrls(dirA).filter((u) => !precacheUrls(dirB).includes(u) && u.startsWith('assets/'));
  expect(onlyA.length).toBeGreaterThan(0);
  expect(cached.filter((u) => onlyA.includes(u)), 'остатки версии A в кэше').toEqual([]);
  expect(new Set(cached)).toEqual(new Set(precacheUrls(dirB)));

  // и без сети работает B целиком
  await ctx.setOffline(true);
  await page.reload();
  await expect(navLabel(page)).toHaveText('Ещё B');
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки B' })).toBeVisible();
  expect(errors).toEqual([]);
  // ни одного 404 за весь сценарий (= ни один кусок A или B не потерялся)
  expect(srv.log.filter(([, code]) => code >= 400)).toEqual([]);
  await ctx.close();
});

test('«Позже» не ломает приложение; после перезапуска вкладки подсказка возвращается, версия не смешивается', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await openA(ctx);
  srv.setRoot(dirB);
  await checkUpdate(page);
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Позже' }).click();
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки A' })).toBeVisible();
  // обычная перезагрузка вкладки: воркер B ещё ждёт, страница всё ещё A целиком, подсказка снова на месте
  await page.reload();
  await expect(navLabel(page)).toHaveText('Ещё A');
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки A' })).toBeVisible();
  await ctx.close();
});

test('Закрыли ВСЕ вкладки и открыли заново: сразу полностью B (без смеси) и без ошибок', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await openA(ctx);
  await addExpense(page, '12');
  srv.setRoot(dirB);
  await checkUpdate(page);
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 });
  await page.close();
  const p2 = await ctx.newPage();
  await skipOnboardingInAdvance(p2);
  const errors: string[] = [];
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(srv.url);
  await navLabel(p2).waitFor();
  // воркер B может сменить A не сразу (ждёт, пока закроются клиенты): допускается ровно одна из двух согласованных версий
  const label = await navLabel(p2).textContent();
  await p2.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  const heading = label === 'Ещё B' ? 'Кошельки B' : 'Кошельки A';
  await expect(p2.getByRole('heading', { name: heading })).toBeVisible();
  await p2.goto(`${srv.url}#/transactions`);
  await expect(p2.getByText('−12 с.').first()).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('Вторая вкладка: после «Обновить» в первой вторая сама переходит на B, а не остаётся со сломанными кусками A', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const tab1 = await openA(ctx);
  const tab2 = await openA(ctx);
  srv.setRoot(dirB);
  await checkUpdate(tab1);
  await expect(prompt(tab1)).toBeVisible({ timeout: 15_000 });
  await expect(prompt(tab2)).toBeVisible({ timeout: 15_000 });
  await tab1.getByRole('button', { name: 'Обновить' }).click();
  await expect(navLabel(tab1)).toHaveText('Ещё B', { timeout: 20_000 });
  // вкладка 2 ещё не открывала «Кошельки»: если бы она осталась на A, чанк A уже пропал бы
  await expect(navLabel(tab2)).toHaveText('Ещё B', { timeout: 20_000 });
  await tab2.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(tab2.getByRole('heading', { name: 'Кошельки B' })).toBeVisible();
  await ctx.close();
});

test('Вторая вкладка с НЕСОХРАНЁННЫМ вводом не перезагружается без спроса из-за «Обновить» в другой вкладке', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const tab1 = await openA(ctx);
  const tab2 = await openA(ctx);
  await tab2.getByRole('link', { name: 'Добавить операцию' }).first().click();
  await tab2.getByRole('dialog').locator('input.money').first().fill('99');
  srv.setRoot(dirB);
  await checkUpdate(tab1);
  await expect(prompt(tab1)).toBeVisible({ timeout: 15_000 });
  await tab1.getByRole('button', { name: 'Обновить' }).click();
  await expect(navLabel(tab1)).toHaveText('Ещё B', { timeout: 20_000 });
  await tab2.waitForTimeout(3000);
  // Человек во второй вкладке не нажимал «Обновить», а набранная сумма пропала бы при перезагрузке.
  expect(await tab2.evaluate(() => document.body.textContent)).toContain('Ещё A');
  await expect(tab2.getByRole('dialog').locator('input.money').first()).toHaveValue('99');
  await ctx.close();
});

test('Вторая вкладка с вводом: как только ввод закончен (окно закрыто), она сама переходит на B', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const tab1 = await openA(ctx);
  const tab2 = await openA(ctx);
  await tab2.getByRole('link', { name: 'Добавить операцию' }).first().click();
  await tab2.getByRole('dialog').locator('input.money').first().fill('77');
  srv.setRoot(dirB);
  await checkUpdate(tab1);
  await expect(prompt(tab1)).toBeVisible({ timeout: 15_000 });
  await tab1.getByRole('button', { name: 'Обновить' }).click();
  await expect(navLabel(tab1)).toHaveText('Ещё B', { timeout: 20_000 });
  // пока окно открыто, вторая вкладка остаётся на A и честно говорит, что приложение уже обновлено
  await expect(tab2.getByText('Приложение обновлено')).toBeVisible({ timeout: 10_000 });
  expect(await tab2.evaluate(() => document.body.textContent)).toContain('Ещё A');
  // человек закрыл окно — вкладка переходит на B без нажатий
  await tab2.keyboard.press('Escape');
  await expect(navLabel(tab2)).toHaveText('Ещё B', { timeout: 15_000 });
  await ctx.close();
});

test('Приложение само находит новую версию в долго открытой вкладке (вернулись в приложение / прошли сутки)', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  await page.clock.install();
  await page.goto(srv.url);
  await navLabel(page).waitFor();
  await waitForSw(page);
  await page.waitForTimeout(4000); // дать закончиться проверке, которую браузер делает сам при загрузке страницы
  srv.setRoot(dirB);
  const swFetches = () => srv.log.filter(([u]) => u.endsWith('/sw.js')).length;
  const before = swFetches();
  // iPhone/Android: человек вернулся в приложение, сеть «появилась», прошли сутки
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward('24:00:00');
  await page.waitForTimeout(6000);
  expect(swFetches() - before, 'sw.js ни разу не перепроверен: об обновлении узнаем только после перезапуска вкладки').toBeGreaterThan(0);
  await expect(prompt(page)).toBeVisible();
  await ctx.close();
});

test('Каждый файл, нужный версии B, отдаётся; кэш не содержит файлов, которых нет в сборке', () => {
  const filesB = new Set(listFiles(dirB));
  expect(precacheUrls(dirB).filter((u) => !filesB.has(u))).toEqual([]);
});

async function crashScenario(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  srv.setRoot(dirCrash);
  await page.goto(srv.url);
  await navLabel(page).waitFor();
  await waitForSw(page);
  await page.waitForTimeout(3000);
  // Выкладываем исправление B, а у человека в этот момент версия A2 «ломается» (данные/состояние, на которых она падает)
  srv.setRoot(dirB);
  await page.evaluate(() => localStorage.setItem('finora-test-crash', '1'));
  await page.reload();
  await expect(page.getByText('Что-то пошло не так')).toBeVisible();
  return { ctx, page };
}

test('Выпущенная версия «падает» при отрисовке: экран ошибки не запирает человека в ней — после «Перезагрузить» приходит исправленная версия', async ({ browser }) => {
  const { ctx, page } = await crashScenario(browser);
  // Исправление могло успеть скачаться, и тогда приложение исправляется само, а кнопки уже нет: это тоже хороший исход.
  await page.getByRole('button', { name: 'Перезагрузить' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const state = await page
    .evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { waiting: !!reg?.waiting, installing: !!reg?.installing, errorScreen: document.body.textContent?.includes('Что-то пошло не так') ?? false };
    })
    .catch(() => 'страница как раз перезагружается');
  console.log('После «Перезагрузить»:', JSON.stringify(state));
  // Ожидание: после перезагрузки (исправление уже на сервере) человек получает рабочее приложение, а не тот же экран ошибки.
  await expect(navLabel(page), `остался на сломанной версии (${JSON.stringify(state)}): исправленная версия не применяется`).toHaveText('Ещё B', {
    timeout: 15_000,
  });
  await ctx.close();
});

test('Выпущенная версия «падает» при отрисовке, человек ничего не нажимает: исправленная версия ставится сама, потому что на экране ошибки терять нечего', async ({ browser }) => {
  const { ctx, page } = await crashScenario(browser);
  await expect(navLabel(page)).toHaveText('Ещё B', { timeout: 20_000 });
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
  await ctx.close();
});

test('«Позже» нажали до поломки: исправление всё равно ставится, когда приложение упало', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  srv.setRoot(dirCrash);
  await page.goto(srv.url);
  await navLabel(page).waitFor();
  await waitForSw(page);
  await page.waitForTimeout(3000);
  // Выложено исправление B, человек видит подсказку и отвечает «Позже»…
  srv.setRoot(dirB);
  await checkUpdate(page);
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Позже' }).click();
  await expect(prompt(page)).toHaveCount(0);
  // …и после этого сломанная версия падает на его данных прямо во время работы (без перезагрузки; воркер B всё ещё ждёт).
  await page.evaluate(() => localStorage.setItem('finora-test-crash', '1'));
  await page.getByRole('navigation').first().getByRole('link', { name: 'Кошельки' }).click();
  await expect(navLabel(page)).toHaveText('Ещё B', { timeout: 20_000 });
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
  await ctx.close();
});
