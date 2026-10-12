import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, CDPSession, Locator, Page, Request, Route, Worker } from '@playwright/test';
import { activateServiceWorker, expect, goSection, openApp, shot, test } from '../helpers';
import { DIST, SEC_TMP, buildVariant, headersFor, startHeaderServer, type HeaderServer } from '../sec/helpers';

/* Этап 3, напоминания (push), сторона приложения: (1) локальный режим; (2) НАСТОЯЩИЙ приём push в Chromium (CDP deliverPushMessage);
 * (3) облачная сборка с подменёнными Supabase и PushManager (настоящий push-сервис без интернета недоступен): что уходит в сеть.
 * Чего здесь нет: доставки от FCM/APNs и настоящего iPhone — см. risks в отчёте. */

const SECTION = 'Напоминания';

const section = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: SECTION, exact: true }) });

async function openSettings(page: Page): Promise<void> {
  await goSection(page, 'Настройки');
  await expect(page.getByRole('heading', { level: 2, name: SECTION, exact: true })).toBeVisible();
}

/** Горизонтальной прокрутки у страницы быть не должно (ничего не вылезает за экран). */
async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, `ширина содержимого ${scroll} больше окна ${client}`).toBeLessThanOrEqual(client!);
}

test.describe('21. Напоминания: локальный режим', () => {
  test('раздел на месте и честно говорит, что нужно облако; кнопок включения нет; ошибок в консоли нет', async ({ page }, testInfo) => {
    await openApp(page);
    await openSettings(page);
    const s = section(page);
    await expect(s.getByText('Напоминания работают только при входе в облако.')).toBeVisible();
    await expect(s.getByRole('button')).toHaveCount(0);
    await s.scrollIntoViewIfNeeded();
    await shot(page, '21-reminders-local', testInfo);
    await noHorizontalOverflow(page);
  });

  test('на самом узком экране (320 px) ничего не обрезано и не вылезает', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openApp(page);
    await openSettings(page);
    await section(page).scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    await shot(page, '21-reminders-local-320', testInfo);
  });
});

test.describe('21. Напоминания: файлы доставки', () => {
  test('sw.js подключает push-handler.js, файл в precache и отдаётся без кэша; сборка без ключей и секретов', async () => {
    const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
    expect(sw).toContain('importScripts("push-handler.js")');
    expect(sw).toMatch(/\{url:"push-handler\.js",revision:"[0-9a-f]+"\}/);
    expect(headersFor('/push-handler.js')['cache-control']).toBe('no-cache');
    expect(headersFor('/sw.js')['cache-control']).toBe('no-cache');
    const handler = readFileSync(join(DIST, 'push-handler.js'), 'utf8');
    expect(handler).toBe(readFileSync(join(process.cwd(), 'public/push-handler.js'), 'utf8'));
    expect(sw + handler).not.toMatch(/VAPID_PRIVATE|vapid[_-]?private/i);
  });
});

/* ------------------------------ настоящий приём push ------------------------------ */

interface Shown {
  title: string;
  body: string;
  tag: string;
  icon: string;
  badge: string;
  lang: string;
  data: { url?: string } | null;
}

async function pushSetup(page: Page, context: BrowserContext): Promise<{ cdp: CDPSession; deliver: (data: string) => Promise<void> }> {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await context.grantPermissions(['notifications'], { origin });
  await openApp(page);
  await activateServiceWorker(page);
  const cdp = await context.newCDPSession(page);
  let registrationId = '';
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: Array<{ registrationId: string; scopeURL: string }> }) => {
    for (const r of e.registrations) if (r.scopeURL.startsWith(origin)) registrationId = r.registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrationId, { message: 'CDP не показал регистрацию сервис-воркера' }).not.toBe('');
  return { cdp, deliver: (data) => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data }).then(() => undefined) };
}

const notifications = (page: Page): Promise<Shown[]> =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: n.icon, badge: n.badge, lang: n.lang, data: n.data as { url?: string } | null }));
  });

/** Закрыть все уведомления и дождаться, пока их действительно не останется (закрытие у браузера асинхронное). */
const closeAll = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (const n of await reg.getNotifications()) n.close();
  });
  await expect.poll(async () => (await notifications(page)).length, { timeout: 10_000 }).toBe(0);
};

/** Послать push и дождаться уведомления. Сообщение могло пропасть, пока воркер стартует на загруженной машине: шлём до 3 раз (поломка обработчика проявится и после третьей). */
async function showPush(page: Page, deliver: (data: string) => Promise<void>, data: string, until: (list: Shown[]) => boolean = (l) => l.length > 0): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await deliver(data);
    try {
      await expect.poll(async () => until(await notifications(page)), { timeout: 6000 }).toBe(true);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

const FALLBACK = 'Sumoima: есть напоминание';

/** То, что нам нужно от глобальной области сервис-воркера внутри worker.evaluate. */
interface SwScope {
  registration: { getNotifications(o: { tag: string }): Promise<unknown[]> };
  dispatchEvent(e: unknown): boolean;
  NotificationEvent: new (type: string, init: { notification: unknown }) => unknown;
}

/** Настоящее нажатие на системное уведомление из браузера не сымитировать: отправляем воркеру то же событие, что отправил бы браузер. */
async function clickNotification(worker: Worker, tag: string): Promise<void> {
  await worker.evaluate(async (t) => {
    const sw = self as unknown as SwScope;
    const [notification] = await sw.registration.getNotifications({ tag: t });
    sw.dispatchEvent(new sw.NotificationEvent('notificationclick', { notification }));
  }, tag);
}

test.describe('21. Напоминания: настоящий приём push в Chromium', () => {
  test('сообщение доходит до сервис-воркера и показывается уведомлением с нужным текстом, значком и адресом', async ({ page, context }) => {
    const { deliver } = await pushSetup(page, context);
    await showPush(page, deliver, JSON.stringify({ title: 'Платежи сегодня', body: 'Подходит срок: 2 платежа', tag: 'payment-2026-10-11', url: '/recurring' }));
    const [n] = await notifications(page);
    expect(n).toMatchObject({ title: 'Платежи сегодня', body: 'Подходит срок: 2 платежа', tag: 'payment-2026-10-11', lang: 'ru', data: { url: '/recurring' } });
    expect(n!.icon).toMatch(/\/pwa-192\.png$/);
    expect(n!.badge).toMatch(/\/pwa-192\.png$/);
  });

  test('одинаковый tag заменяет уведомление, а не копит стопку', async ({ page, context }) => {
    const { deliver } = await pushSetup(page, context);
    await closeAll(page);
    const titles = (l: Shown[]) => l.map((n) => n.title).join('|');
    await showPush(page, deliver, JSON.stringify({ title: 'Первое', body: 'а', tag: 'same', url: '/' }), (l) => titles(l) === 'Первое');
    await showPush(page, deliver, JSON.stringify({ title: 'Второе', body: 'б', tag: 'same', url: '/' }), (l) => titles(l) === 'Второе');
  });

  test('испорченные сообщения (не JSON, пусто, массив, неверные типы) всё равно дают уведомление с запасным текстом', async ({ page, context }) => {
    const { deliver } = await pushSetup(page, context);
    const bad = ['просто текст', '{оборванный', '[1,2,3]', 'null', '{"title":123,"body":["x"],"url":5}', ''];
    for (const [i, data] of bad.entries()) {
      await closeAll(page);
      await showPush(page, deliver, data);
      const [n] = await notifications(page);
      expect(n!.title, `сообщение №${i}`).toBe(FALLBACK);
      expect(n!.data).toEqual({ url: '/' });
    }
  });

  test('длинные строки режутся, вредные адреса превращаются в «/»', async ({ page, context }) => {
    const { deliver } = await pushSetup(page, context);
    await closeAll(page);
    await showPush(page, deliver, JSON.stringify({ title: 'Т'.repeat(3000), body: 'Б'.repeat(3000), tag: 'g'.repeat(500), url: '//evil.com' }));
    const [n] = await notifications(page);
    expect(n!.title.length).toBeLessThanOrEqual(100);
    expect(n!.body.length).toBeLessThanOrEqual(300);
    expect(n!.tag.length).toBeLessThanOrEqual(64);
    expect(n!.data).toEqual({ url: '/' });
    for (const evil of ['javascript:alert(1)', 'https://evil.example/', '\\evil', '/a\nb']) {
      await closeAll(page);
      await showPush(page, deliver, JSON.stringify({ title: 'x', url: evil }));
      expect((await notifications(page))[0]!.data).toEqual({ url: '/' });
    }
  });

  test('нажатие на уведомление: окно приложения переходит на нужный экран (сервис-воркер получает notificationclick)', async ({ page, context }) => {
    const { deliver } = await pushSetup(page, context);
    await closeAll(page);
    await showPush(page, deliver, JSON.stringify({ title: 'Долг', body: 'Скоро срок возврата', tag: 'debt-1', url: '/debts' }));
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/sw.js'));
    expect(worker, 'сервис-воркер виден Playwright').toBeTruthy();
    await clickNotification(worker!, 'debt-1');
    await expect(page).toHaveURL(/#\/debts$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Долги и кредиты' })).toBeVisible();
    await expect.poll(async () => (await notifications(page)).length, { timeout: 10_000 }).toBe(0);
    // и вредный адрес из уведомления ведёт только на «Главную»
    await showPush(page, deliver, JSON.stringify({ title: 'Чужое', tag: 'evil', url: '//evil.com' }));
    await clickNotification(worker!, 'evil');
    await expect(page).toHaveURL(/#\/$/);
    expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL!).origin);
  });
});

/* ------------------------------ облачная сборка: включение, настройки, проверка ------------------------------ */

const REF = 'example-ref';
const SUPA = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_FAKEKEYFORTESTING0123456789';
const EMAIL = 'friend.secret@example.org';
const PASSWORD = 'p@ssw0rd-SECRET-123';
const USER_ID = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48';
/** Публичный ключ P-256 для сборки (не секретный, сделан только для проверки). */
const VAPID_PUBLIC = 'BCl9Na6L3jfcZ90djotMv3DPypj4qFW2SMstrtSImSvs6BwyjvEfKfNF8DsaYegHRZfR9Evgc7olyLEBfiAcmBw';
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ACCESS = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fakesignature`;
const REFRESH = 'REFRESH-TOKEN-SECRET-xyz';
const userJson = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const sessionJson = () => ({ access_token: ACCESS, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: REFRESH, user: userJson });
const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/ZTJlLXRlc3QtZW5kcG9pbnQ';

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

interface Cloud {
  seen: Seen[];
  settings: Record<string, unknown> | null;
  subs: Array<Record<string, unknown>>;
  fn: { status: number; body: unknown };
}

let srv: HeaderServer | null = null;
let variantName: string | null = null;

async function cloudServer(): Promise<HeaderServer> {
  if (srv) return srv;
  // Своя папка сборки на каждый запуск: общая «reminders-cloud» в /tmp пересобирается (--emptyOutDir) любым параллельным прогоном
  // этого файла, и сервер на миг отдаёт 404 на sw.js («A bad HTTP response code (404) was received when fetching the script»).
  variantName = `reminders-cloud-${process.pid}`;
  const dir = buildVariant(variantName, { VITE_SUPABASE_URL: SUPA, VITE_SUPABASE_ANON_KEY: ANON, VITE_VAPID_PUBLIC_KEY: VAPID_PUBLIC });
  srv = await startHeaderServer(dir);
  return srv;
}
test.afterAll(async () => {
  await srv?.close();
  srv = null;
  if (variantName) rmSync(join(SEC_TMP, variantName), { recursive: true, force: true });
  variantName = null;
});

/** Заглушка Supabase: вход, две таблицы напоминаний (в памяти), функция send-reminders; остальные таблицы пустые. */
async function mockSupabase(page: Page): Promise<Cloud> {
  const cloud: Cloud = { seen: [], settings: null, subs: [], fn: { status: 200, body: { ok: true, sent: 1 } } };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  await page.context().route(
    (u) => u.hostname === `${REF}.supabase.co`,
    async (route: Route) => {
      const req: Request = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const raw = req.postData();
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      cloud.seen.push({ method: req.method(), path: url.pathname, query: url.searchParams, headers: await req.allHeaders(), body });
      const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
        route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(data) });
      const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      const respond = (rows: Array<Record<string, unknown>>, status = 200) =>
        wantsObject ? (rows.length === 1 ? json(status, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(status, rows);

      if (url.pathname === '/auth/v1/token') return json(200, sessionJson());
      if (url.pathname === '/auth/v1/user') return json(200, userJson);
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === '/functions/v1/send-reminders') return json(cloud.fn.status, cloud.fn.body);
      if (url.pathname === '/rest/v1/reminder_settings') {
        if (req.method() === 'GET') return respond(cloud.settings ? [cloud.settings] : []);
        if (req.method() === 'POST') {
          cloud.settings = { user_id: USER_ID, enabled: false, hour_local: 9, timezone: 'Asia/Dushanbe', remind_payments: true, remind_debts: true, remind_daily: false, show_details: false, ...(cloud.settings ?? {}), ...(body as object) };
          return respond([cloud.settings], 201);
        }
      }
      if (url.pathname === '/rest/v1/push_subscriptions') {
        if (req.method() === 'GET') return respond(cloud.subs.filter((s) => s.revoked_at === null || s.revoked_at === undefined));
        if (req.method() === 'POST') {
          const b = body as Record<string, unknown>;
          const i = cloud.subs.findIndex((s) => s.endpoint === b.endpoint);
          if (i >= 0) Object.assign(cloud.subs[i]!, b);
          else cloud.subs.push({ id: `sub-${cloud.subs.length + 1}`, user_id: USER_ID, ...b });
          return respond([cloud.subs.find((s) => s.endpoint === b.endpoint)!], 201);
        }
        if (req.method() === 'PATCH') {
          const device = url.searchParams.get('device_id')?.replace(/^eq\./, '');
          const endpoint = url.searchParams.get('endpoint')?.replace(/^eq\./, '');
          for (const s of cloud.subs) if ((device && s.device_id === device) || (endpoint && s.endpoint === endpoint)) Object.assign(s, body);
          return route.fulfill({ status: 204, headers: cors });
        }
      }
      if (url.pathname.startsWith('/rest/v1/')) return req.method() === 'GET' ? json(200, [], { 'content-range': '*/0' }) : json(201, []);
      return json(404, { message: 'not found' });
    },
  );
  return cloud;
}

/** Подмена push-службы браузера (настоящая недоступна без интернета); разрешение и воркер настоящие. */
async function fakePushService(page: Page, opts: { standalone: boolean }): Promise<void> {
  await page.addInitScript(
    ({ endpoint, standalone }) => {
      let current: unknown = null;
      const buf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
      const P256DH = 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAqgPoerZxuKO7T0Z8-3x2cXuhgUCXq_4mFWPlOZJbyUQsTwzxqrQG4JkLs';
      const AUTH = 'tBHItJI5svbpez7KI4CCXg';
      PushManager.prototype.subscribe = async function (o: PushSubscriptionOptionsInit) {
        const key = o.applicationServerKey as ArrayBuffer | Uint8Array;
        const sub = {
          endpoint,
          options: { applicationServerKey: key instanceof Uint8Array ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) : key },
          toJSON: () => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } }),
          getKey: (n: string) => (n === 'p256dh' ? buf(P256DH) : n === 'auth' ? buf(AUTH) : null),
          unsubscribe: async () => {
            current = null;
            return true;
          },
        };
        current = sub;
        return sub as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
      if (standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
    },
    { endpoint: FAKE_ENDPOINT, standalone: opts.standalone },
  );
}

/** iPhone с iOS 17 (в эмуляторе Playwright «iPhone 14» старая iOS 15.5, а для push нужна 16.4+). */
const IOS17_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

/** На телефонном проекте подставляет браузеру iOS 17 (на «desktop» ничего не меняет). Вызывать до перехода на страницу. */
async function modernIos(page: Page): Promise<void> {
  if (test.info().project.name !== 'iphone') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: IOS17_UA });
}

async function signIn(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Почта' }).fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible({ timeout: 20_000 });
}

interface CloudOpts {
  standalone?: boolean;
  /** Подставить браузеру iOS 17 (по умолчанию да; false — оставить старую iOS 15.5 из эмулятора). */
  modern?: boolean;
  /** Что лежит в таблице настроек до входа. */
  settings?: Record<string, unknown>;
  /** Не открывать «Настройки» (нужно только войти). */
  stayHome?: boolean;
}

/** Облачная сборка: заглушки Supabase и push-службы, вход, «Настройки». Возвращает заглушку и раздел «Напоминания». */
async function openCloud(page: Page, context: BrowserContext, o: CloudOpts = {}): Promise<{ cloud: Cloud; server: HeaderServer; s: Locator }> {
  const server = await cloudServer();
  await context.grantPermissions(['notifications'], { origin: server.origin });
  const cloud = await mockSupabase(page);
  if (o.settings) cloud.settings = { user_id: USER_ID, ...o.settings };
  await fakePushService(page, { standalone: o.standalone ?? true });
  if (o.modern !== false) await modernIos(page);
  await page.goto(`${server.origin}/#/`);
  await signIn(page);
  if (!o.stayHome) await openSettings(page);
  return { cloud, server, s: section(page) };
}

const reqs = (c: Cloud, method: string, path: string) => c.seen.filter((r) => r.method === method && r.path === path);

test.describe('21. Напоминания: облачная сборка', () => {
  test.setTimeout(150_000);

  test('iPhone в обычной вкладке Safari: объяснение про экран «Домой», вопроса о разрешении и запросов о подписке нет', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'сценарий про iPhone');
    const { cloud, s } = await openCloud(page, context, { standalone: false });
    await expect(s.getByText(/только в приложении, добавленном на экран «Домой»/)).toBeVisible();
    await expect(s.getByText(/Установка на телефон/)).toBeVisible();
    await expect(s.getByRole('button')).toHaveCount(0);
    await s.scrollIntoViewIfNeeded();
    await shot(page, '21-reminders-ios-tab', testInfo);
    await noHorizontalOverflow(page);
    expect(reqs(cloud, 'POST', '/rest/v1/push_subscriptions')).toEqual([]);
    expect(reqs(cloud, 'POST', '/rest/v1/reminder_settings')).toEqual([]);
  });

  test('iPhone со старой iOS (15.5, как в эмуляторе Playwright): просит обновить систему, ничего не подписывает', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'сценарий про iPhone');
    const { cloud, s } = await openCloud(page, context, { modern: false });
    await expect(s.getByText(/с iOS 16\.4/)).toBeVisible();
    await expect(s.getByRole('button')).toHaveCount(0);
    await s.scrollIntoViewIfNeeded();
    await shot(page, '21-reminders-ios-old', testInfo);
    expect(reqs(cloud, 'POST', '/rest/v1/push_subscriptions')).toEqual([]);
  });

  test('включение → настройки → «Проверить» → выключение; в сеть уходит ровно то, что нужно, и ничего личного', async ({ page, context }, testInfo) => {
    const { cloud, s } = await openCloud(page, context);

    // 1. выключено; ничего не записано
    await expect(s.getByText('Напоминания выключены.')).toBeVisible();
    await s.scrollIntoViewIfNeeded();
    await shot(page, '21-reminders-off', testInfo);
    expect(reqs(cloud, 'POST', '/rest/v1/push_subscriptions')).toEqual([]);

    // 2. включаем
    await s.getByRole('button', { name: 'Включить напоминания' }).click();
    await expect(s.getByText('Напоминания включены на этом устройстве.')).toBeVisible();
    const subReq = reqs(cloud, 'POST', '/rest/v1/push_subscriptions')[0]!;
    expect(subReq.query.get('on_conflict')).toBe('user_id,endpoint');
    expect(subReq.headers['prefer']).toContain('resolution=merge-duplicates');
    const subBody = subReq.body as Record<string, unknown>;
    expect(subBody).toMatchObject({ endpoint: FAKE_ENDPOINT, revoked_at: null });
    expect(Object.keys(subBody).sort()).toEqual(['auth_secret', 'device_id', 'endpoint', 'last_seen_at', 'p256dh', 'revoked_at', 'user_agent']);
    expect(String(subBody.user_agent).length).toBeLessThanOrEqual(300);
    expect(String(subBody.device_id).length).toBeGreaterThanOrEqual(8);
    const setReq = reqs(cloud, 'POST', '/rest/v1/reminder_settings').at(-1)!;
    expect(setReq.query.get('on_conflict')).toBe('user_id');
    expect(setReq.body).toMatchObject({ enabled: true, timezone: 'Asia/Dushanbe' });
    expect(Object.keys(setReq.body as object).sort()).toEqual(['enabled', 'timezone', 'updated_at']);
    // авторизация — вошедшего пользователя; user_id в телах нет
    for (const r of [subReq, setReq]) {
      expect(r.headers['authorization']).toBe(`Bearer ${ACCESS}`);
      expect(r.headers['apikey']).toBe(ANON);
      expect(r.body).not.toHaveProperty('user_id');
    }
    expect(cloud.settings).toMatchObject({ enabled: true, hour_local: 9 });

    // 3. настройки
    await expect(s.getByRole('combobox', { name: 'В какое время напоминать (ваше местное время)' })).toHaveValue('9');
    await s.getByRole('combobox', { name: 'В какое время напоминать (ваше местное время)' }).selectOption('21');
    await expect.poll(() => cloud.settings?.hour_local).toBe(21);
    await s.getByRole('switch', { name: 'Показывать названия в уведомлении' }).click();
    await expect.poll(() => cloud.settings?.show_details).toBe(true);
    await expect(s.getByRole('switch', { name: 'Показывать названия в уведомлении' })).toHaveAttribute('aria-checked', 'true');
    await s.scrollIntoViewIfNeeded();
    await shot(page, '21-reminders-on', testInfo);
    await noHorizontalOverflow(page);

    // 4. «Проверить уведомление»: идёт ТОЛЬКО по нажатию и с телом {action:"test"}
    expect(reqs(cloud, 'POST', '/functions/v1/send-reminders')).toEqual([]);
    await s.getByRole('button', { name: 'Проверить уведомление' }).click();
    await expect(s.getByText('Отправили — ждите несколько секунд.')).toBeVisible();
    const fn = reqs(cloud, 'POST', '/functions/v1/send-reminders');
    expect(fn).toHaveLength(1);
    expect(fn[0]!.body).toEqual({ action: 'test' });
    expect(fn[0]!.headers['authorization']).toBe(`Bearer ${ACCESS}`);
    // функция не развёрнута
    cloud.fn = { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
    await s.getByRole('button', { name: 'Проверить уведомление' }).click();
    await expect(s.getByText(/функция send-reminders не развёрнута/)).toBeVisible();
    cloud.fn = { status: 500, body: { ok: false } };
    await s.getByRole('button', { name: 'Проверить уведомление' }).click();
    await expect(s.getByText(/не настроены ключи/)).toBeVisible();

    // 5. личное на экран не попадает
    const text = await page.locator('body').innerText();
    for (const secret of [FAKE_ENDPOINT, ACCESS, REFRESH, ANON, PASSWORD, 'BLc4xRzK', VAPID_PUBLIC]) expect(text).not.toContain(secret);

    // 6. выключение на этом устройстве (оно единственное → на аккаунте тоже выключено)
    await s.getByRole('button', { name: 'Выключить на этом устройстве' }).click();
    await expect(s.getByText('Напоминания выключены.')).toBeVisible();
    expect(cloud.subs.every((x) => x.revoked_at)).toBe(true);
    expect(cloud.settings).toMatchObject({ enabled: false });
    expect(reqs(cloud, 'DELETE', '/rest/v1/push_subscriptions')).toEqual([]);

    // 7. запросы — только к своему проекту; в ответах самого приложения ничего чужого
    expect(new Set(cloud.seen.map((r) => r.path.split('/')[1]))).toEqual(new Set(['auth', 'rest', 'functions']));
  });

  test('запасной путь перехода по уведомлению: сервис-воркер просит окно перейти — внутренний путь принимается, чужой адрес нет', async ({ page, context }) => {
    const { server } = await openCloud(page, context, { stayHome: true });
    await expect.poll(() => context.serviceWorkers().length, { message: 'сервис-воркер не запущен' }).toBeGreaterThan(0);
    const worker = context.serviceWorkers()[0]!;
    const ask = (path: unknown) =>
      worker.evaluate(async (p) => {
        const sw = self as unknown as { clients: { matchAll(o: object): Promise<Array<{ postMessage(m: unknown): void }>> } };
        for (const c of await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' })) c.postMessage({ type: 'finora-navigate', path: p });
      }, path);
    await ask('/debts');
    await expect(page).toHaveURL(/#\/debts$/);
    for (const evil of ['//evil.com', 'javascript:alert(1)', 'https://evil.example/', '\\evil', '/a\nb', 42]) {
      await ask(evil);
      await page.waitForTimeout(150);
      expect(page.url(), `после «${String(evil)}»`).toMatch(/#\/debts$/);
    }
    expect(new URL(page.url()).origin).toBe(server.origin);
  });

  test('на 320 px раздел с настройками целиком помещается в экран', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const { s } = await openCloud(page, context, { settings: { enabled: true, hour_local: 18, timezone: 'Asia/Dushanbe', remind_daily: true } });
    await expect(s.getByText('Напоминания включены для вашего аккаунта, но не на этом устройстве.')).toBeVisible();
    await expect(s.getByRole('button', { name: 'Включить на этом устройстве' })).toBeVisible();
    await s.scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    for (const b of await s.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await shot(page, '21-reminders-320', testInfo);
  });
});
