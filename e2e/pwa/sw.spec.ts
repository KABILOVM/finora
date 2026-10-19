import { expect, test, type Page } from '@playwright/test';
import { skipOnboardingInAdvance } from '../helpers';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, TMP, addExpense, cacheDump, launchProfile, listFiles, precacheUrls, startStatic, waitForSw, type StaticServer } from './helpers';

// 2, 3, 6, 7: сервис-воркер, кэши, холодный офлайн-старт, ленивые страницы, внешние хосты.
let srv: StaticServer;
test.beforeAll(async () => {
  srv = await startStatic(DIST);
  mkdirSync(TMP, { recursive: true });
});
test.afterAll(async () => {
  await srv.close();
});
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(info.project.name !== 'desktop', 'тяжёлые сценарии с профилями браузера — один раз, на «desktop»');
});

const ready = async (page: Page) => page.getByRole('navigation').first().waitFor();

test('precache: в sw.js есть index.html и КАЖДЫЙ файл сборки (js, css, иконки, манифест)', () => {
  const urls = new Set(precacheUrls());
  const files = listFiles(DIST).filter((f) => f !== 'sw.js' && !/^workbox-[0-9a-f]+\.js$/.test(f));
  expect(urls.has('index.html')).toBe(true);
  const missing = files.filter((f) => !urls.has(f));
  expect(missing, 'файлы сборки, которых нет в precache').toEqual([]);
  // Каждый precache-адрес реально существует в сборке (иначе установка воркера упадёт целиком).
  const files2 = new Set(listFiles(DIST));
  expect([...urls].filter((u) => !files2.has(u))).toEqual([]);
  for (const ext of ['js', 'css', 'png', 'svg', 'webmanifest']) {
    expect([...urls].some((u) => u.endsWith(`.${ext}`)), `.${ext} в precache`).toBe(true);
  }
  // Каждый ленивый чанк, на который ссылается главный бандл, лежит в precache.
  const entry = [...urls].find((u) => /^assets\/index-.*\.js$/.test(u))!;
  const entrySrc = readFileSync(join(DIST, entry), 'utf8');
  const chunks = [...entrySrc.matchAll(/\.\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => `assets/${m[1]}`).filter((c) => c !== 'assets/sw.js');
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.filter((c) => !urls.has(c))).toEqual([]);
});

test('sw.js: runtimeCaching пуст — единственный маршрут это навигационный fallback на index.html', () => {
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
  expect((sw.match(/registerRoute\(/g) ?? []).length).toBe(1);
  expect(sw).toContain('NavigationRoute');
  expect(sw).not.toMatch(/StaleWhileRevalidate|NetworkFirst|CacheFirst|CacheOnly|NetworkOnly|workbox-runtime|ExpirationPlugin/);
  expect(sw).toContain('cleanupOutdatedCaches');
  // skipWaiting только по сообщению от кнопки «Обновить», не сам по себе.
  expect(sw).not.toMatch(/self\.skipWaiting\(\)(?!\})/);
  expect(sw).not.toMatch(/clientsClaim|\.clients\.claim\(/);
});

test('Cache Storage = ровно precache; Supabase и внешние хосты не кэшируются', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  // Внешние хосты «отвечают» успешно и разрешают CORS: если воркер что-то кэширует, оно обязательно попадёт в кэш.
  const external: string[] = [];
  await ctx.route((u) => u.origin !== srv.origin, async (route) => {
    external.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"data":[],"rates":{}}' });
  });
  await page.goto(srv.url);
  await ready(page);
  await waitForSw(page);
  // Запросы, которые приложение сделало само (курсы), плюс то, что сделало бы облако.
  await page.evaluate(async () => {
    const urls = [
      'https://abcdefgh.supabase.co/rest/v1/transactions?select=*',
      'https://abcdefgh.supabase.co/auth/v1/token?grant_type=password',
      'https://abcdefgh.supabase.co/rest/v1/rpc/whatever',
      'https://www.nbt.tj/en/kurs/export_xml.php',
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    ];
    for (const u of urls) await fetch(u, { method: u.includes('token') ? 'POST' : 'GET', body: u.includes('token') ? '{}' : undefined }).catch(() => undefined);
  });
  await page.waitForTimeout(500);
  const dump = await cacheDump(page);
  const names = Object.keys(dump);
  expect(names.length, `кэши: ${names.join(', ')}`).toBe(1);
  const cached = dump[names[0]!]!;
  const origin = new URL(srv.url).origin;
  expect(cached.filter((u) => !u.startsWith(origin)), 'чужие адреса в кэше').toEqual([]);
  expect(cached.filter((u) => /\/rest\/v1|\/auth\/v1|supabase\.co|nbt\.tj|currency-api|jsdelivr\.net/.test(u))).toEqual([]);
  // Кэш содержит ровно то, что записано в precache (без «лишних» и без пропавших).
  const expected = precacheUrls().map((u) => new URL(u, srv.url).href);
  expect([...new Set(cached.map((u) => u.replace(/\?__WB_REVISION__=\w+$/, '')))].sort()).toEqual([...new Set(expected)].sort());
  // Запросы реально ушли в сеть, а не в кэш. Адреса Supabase в локальной сборке запрещены политикой безопасности
  // (так и задумано: разрешён только свой проект), поэтому проверяем разрешённые источники курсов.
  expect(external.some((u) => /nbt\.tj|jsdelivr\.net/.test(u))).toBe(true);
  await ctx.close();
});

test('ХОЛОДНЫЙ ОФЛАЙН-СТАРТ: после полного перезапуска браузера без сети приложение открывается с данными', async () => {
  const dir = mkdtempSync(join(TMP, 'cold-'));
  // 1) онлайн: заходим, вносим расход, ждём воркер, закрываем браузер целиком
  let ctx = await launchProfile(dir);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await skipOnboardingInAdvance(page);
  await page.goto(srv.url);
  await ready(page);
  await addExpense(page, '777');
  await waitForSw(page);
  const online = await cacheDump(page);
  expect(Object.values(online).flat().length).toBeGreaterThan(20);
  await ctx.close();

  // 2) офлайн с самого старта (сервер даже не доступен)
  const offlineSrv = srv; // тот же адрес, но сеть отключена на уровне браузера
  ctx = await launchProfile(dir, { offline: true });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await skipOnboardingInAdvance(page);
  const before = offlineSrv.log.length;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.url}#/transactions`);
  await ready(page);
  await expect(page.getByText('−777 с.').first()).toBeVisible();
  expect(errors).toEqual([]);
  // никаких запросов к нашему серверу: всё из кэша воркера
  expect(offlineSrv.log.length).toBe(before);
  // глубокие ссылки и перезагрузка тоже работают офлайн
  await page.goto(`${srv.url}#/settings/categories`);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('heading', { name: /Категории/ }).first()).toBeVisible();
  await page.goto(`${srv.url}index.html#/wallets`);
  await ready(page);
  await expect(page.getByText('Наличные').first()).toBeVisible();
  // Явный заход «по пути» (как ссылка из закладки без #) тоже отдаёт приложение, а не ошибку браузера.
  await page.goto(`${srv.url}transactions`);
  await ready(page);
  // Ссылка со своими параметрами (например, из мессенджера) тоже открывается офлайн.
  await page.goto(`${srv.url}?from=share&utm_source=x#/transactions`);
  await ready(page);
  await expect(page.getByText('−777 с.').first()).toBeVisible();
  await ctx.close();
});

test('Сеть пропала ПОСЛЕ загрузки страницы: все ленивые страницы открываются из precache', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  await page.goto(srv.url);
  await ready(page);
  await waitForSw(page);
  await ready(page);
  await ctx.setOffline(true);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nav = page.getByRole('navigation').first();
  for (const [name, heading] of [
    ['Операции', 'Операции'],
    ['Аналитика', 'Аналитика'],
    ['Ещё', 'Ещё'],
  ] as const) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
  // «Ещё» — это меню; «Кошельки» и «Настройки» открываются вторым шагом, тоже без сети (ленивые страницы из precache)
  await page.getByRole('main').getByRole('link', { name: 'Кошельки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кошельки' }).first()).toBeVisible();
  await nav.getByRole('link', { name: 'Ещё' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки' }).first()).toBeVisible();
  await page.goto(`${srv.url}#/settings/categories`);
  await expect(page.getByRole('heading', { name: /Категории/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Добавить операцию' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('Первый заход: чанк страницы не загрузился — не белый экран, а «Раздел не загрузился» при живом меню, и «Повторить» лечит', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  let blocked = true;
  await ctx.route(/assets\/(TransactionsPage|WalletsPage)-.*\.js/, (route) => (blocked ? route.abort('internetdisconnected') : route.continue()));
  await page.goto(srv.url);
  await ready(page);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Операции' }).click();
  // карточка — на месте страницы, а меню остаётся: можно уйти в другой раздел
  const card = page.getByRole('main').getByRole('alert');
  await expect(card).toContainText('Раздел не загрузился', { timeout: 5000 });
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
  await card.getByRole('button', { name: 'На главную' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Операции' }).click();
  await expect(card).toBeVisible();
  blocked = false; // сеть вернулась
  await card.getByRole('button', { name: 'Повторить' }).click();
  await ready(page);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Операции' }).click();
  await expect(page.getByRole('heading', { name: 'Операции' }).first()).toBeVisible();
  await ctx.close();
});

test('Первый заход: ленивый чанк «завис» (медленная сеть) — не белый экран', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  await ctx.route(/assets\/WalletsPage-.*\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await page.goto(srv.url);
  await ready(page);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Ещё' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Кошельки', exact: true }).click();
  await page.waitForTimeout(800);
  // Пока страница грузится, каркас (меню, шапка) на экране, а не пустота.
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Кошельки' }).first()).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test('Внешние хосты при старте и обходе всех страниц: только курсы валют, никаких шрифтов/CDN/аналитики', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await skipOnboardingInAdvance(page);
  const hosts = new Map<string, number>();
  ctx.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== srv.origin && /^https?:/.test(u.protocol)) hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
  });
  await ctx.route((u) => u.origin !== srv.origin, (route) => route.abort('internetdisconnected'));
  await page.goto(srv.url);
  await ready(page);
  await waitForSw(page);
  for (const hash of ['#/', '#/transactions', '#/wallets', '#/settings', '#/settings/categories']) {
    await page.goto(srv.url + hash);
    await ready(page);
  }
  await page.waitForTimeout(1500);
  const list = [...hosts.entries()];
  console.log('Внешние хосты:', JSON.stringify(list));
  const allowed = /^(www\.nbt\.tj|nbt\.tj|cdn\.jsdelivr\.net|latest\.currency-api\.pages\.dev)$/;
  expect(list.filter(([h]) => !allowed.test(h)).map(([h]) => h), 'неожиданные внешние хосты').toEqual([]);
  expect(list.some(([h]) => /fonts\.(googleapis|gstatic)|cdnjs|unpkg|analytics|gtag|sentry/.test(h))).toBe(false);
  // Курсы не должны «штормить»: не больше 3 попыток на хост за весь обход.
  for (const [h, n] of list) expect(n, `${h}: слишком много запросов`).toBeLessThanOrEqual(3);
  await ctx.close();
});

test('Раздача из ПОДПАПКИ домена: воркер встаёт на её scope, офлайн-старт и данные работают', async () => {
  const sub = await startStatic(DIST, '/finora-app/v2/');
  const dir = mkdtempSync(join(TMP, 'sub-'));
  let ctx = await launchProfile(dir);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await skipOnboardingInAdvance(page);
  await page.goto(sub.url);
  await ready(page);
  await addExpense(page, '42');
  await waitForSw(page);
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => ({ scope: r.scope, script: r.active?.scriptURL })));
  expect(regs).toEqual([{ scope: sub.url, script: `${sub.url}sw.js` }]);
  // корень домена воркером не занят (иначе он перехватил бы чужие страницы того же домена)
  expect(await page.evaluate(async (o) => !!(await navigator.serviceWorker.getRegistration(`${o}/`)), sub.origin)).toBe(false);
  await ctx.close();

  ctx = await launchProfile(dir, { offline: true });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await skipOnboardingInAdvance(page);
  await page.goto(`${sub.url}#/transactions`);
  await ready(page);
  await expect(page.getByText('−42 с.').first()).toBeVisible();
  await page.goto(`${sub.url}#/settings/categories`);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('heading', { name: /Категории/ }).first()).toBeVisible();
  await ctx.close();
  await sub.close();
});
