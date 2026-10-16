import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from '../helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVariant, headersFor, listFiles, parseCsp, recordViolations, startHeaderServer, type HeaderServer } from './helpers';

/* ---------------------------------------------------------------------------------------------
 * Облачный режим под CSP: сборка с VITE_SUPABASE_URL=https://example-ref.supabase.co и поддельным ключом.
 * Политика в этой сборке разрешает ТОЧНО этот проект (https + wss), а не любой *.supabase.co: запрос к чужому проекту блокируется.
 * Supabase подменён заглушкой на уровне сети (page.route): если бы CSP заблокировал запрос, заглушка до него не дошла бы.
 * Заодно: что человек видит, что лежит в хранилище, куда уходят токены и что попадает в отчёт проверки облака.
 * ------------------------------------------------------------------------------------------- */

const REF = 'example-ref';
const SUPA = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_FAKEKEYFORTESTING0123456789';
const EMAIL = 'friend.secret@example.org';
const PASSWORD = 'p@ssw0rd-SECRET-123';
const USER_ID = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48';

const RATE_HOSTS = ['https://www.nbt.tj', 'https://cdn.jsdelivr.net', 'https://latest.currency-api.pages.dev', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'];
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ACCESS = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fakesignature`;
const REFRESH = 'REFRESH-TOKEN-SECRET-xyz';

const userJson = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
};
const sessionJson = () => ({
  access_token: ACCESS, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: REFRESH, user: userJson,
});

let srv: HeaderServer;
let variantDir = '';
const buildVariantPath = (): string => variantDir;
test.beforeAll(async () => {
  const dir = buildVariant('cloud', { VITE_SUPABASE_URL: SUPA, VITE_SUPABASE_ANON_KEY: ANON });
  variantDir = dir;
  srv = await startHeaderServer(dir);
});
test.afterAll(async () => {
  await srv?.close();
});

interface Mock {
  /** Запросы, до которых дошла заглушка (то есть CSP их пропустила). */
  seen: Request[];
  loginOk: boolean;
}

/** Заглушка Supabase: вход (успешный или нет), чтение таблиц — пусто, запись — принята. */
async function mockSupabase(page: Page, opts: { loginOk: boolean }): Promise<Mock> {
  const mock: Mock = { seen: [], loginOk: opts.loginOk };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  await page.context().route(
    (u) => u.hostname === `${REF}.supabase.co`,
    async (route: Route) => {
      const req = route.request();
      mock.seen.push(req);
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
        route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
      if (url.pathname === '/auth/v1/token') {
        return mock.loginOk ? json(200, sessionJson()) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (url.pathname === '/auth/v1/user') return json(200, userJson);
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname.startsWith('/rest/v1/')) {
        return req.method() === 'GET' ? json(200, [], { 'content-range': '*/0' }) : json(201, []);
      }
      return json(404, { message: 'not found' });
    },
  );
  return mock;
}

async function signIn(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Почта' }).fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
}

test.describe('Облачный режим: CSP и Supabase', () => {
  test('в облачной сборке лежит только публичный ключ, без секретных и без чужих адресов', () => {
    const dir = buildVariantPath();
    const issues: string[] = [];
    let anonSeen = false;
    for (const f of listFiles(dir).filter((x) => /\.(js|html|css|webmanifest)$/.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (s.includes(ANON)) anonSeen = true;
      if (/sb_secret_[A-Za-z0-9_-]{16,}|service_role[\w.-]*eyJ/.test(s)) issues.push(`${f}: секретный ключ`);
      for (const jwt of s.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g) ?? []) issues.push(`${f}: JWT ${jwt.slice(0, 12)}…`);
      for (const h of new Set(s.match(/https?:\/\/[a-z0-9.-]+\.supabase\.co/g) ?? [])) if (h !== SUPA && h !== 'https://abcdefgh.supabase.co') issues.push(`${f}: чужой адрес Supabase ${h}`);
      if (/\.map$/.test(f) || /sourceMappingURL/.test(s)) issues.push(`${f}: карта исходников`);
    }
    expect(anonSeen, 'публичный ключ вшит в сборку (так и задумано)').toBe(true);
    expect(issues).toEqual([]);
  });

  test('экран входа открывается, запрос на *.supabase.co не блокируется CSP (даже когда вход отклонён)', async ({ page }) => {
    const violations = await recordViolations(page);
    const mock = await mockSupabase(page, { loginOk: false });
    await page.goto(`${srv.origin}/#/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await signIn(page);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(mock.seen.some((r) => r.url().includes('/auth/v1/token')), 'запрос входа дошёл до сети').toBe(true);
    expect(await violations(), 'нарушения CSP').toEqual([]);
    // токен входа ушёл ТОЛЬКО на адрес Supabase из сборки, с ключом приложения
    for (const r of mock.seen) expect(new URL(r.url()).origin).toBe(SUPA);
    expect((await mock.seen.find((r) => r.url().includes('/auth/v1/token'))!.allHeaders())['apikey']).toBe(ANON);
    // пароль не попал ни в адрес, ни в текст страницы
    expect(page.url()).not.toContain(PASSWORD);
    expect(await page.locator('body').innerText()).not.toContain(PASSWORD);
  });

  test('контроль: запрос на чужой хост из облачной сборки CSP блокирует', async ({ page, errors }) => {
    errors.allow(/Refused to|Content Security Policy/i);
    const violations = await recordViolations(page);
    await mockSupabase(page, { loginOk: false });
    await page.goto(`${srv.origin}/#/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    const outcome = await page.evaluate(async () => {
      const r: Record<string, string> = {};
      const attempts = {
        other: 'https://evil.example/x',
        lookalike: 'https://example-ref.supabase.co.evil.example/x',
        http: 'http://example-ref.supabase.co/x',
        // кража в ЧУЖОЙ проект Supabase: подстановка *.supabase.co его пропускала, точный адрес — нет
        foreignProject: 'https://attacker-ref.supabase.co/rest/v1/steal',
        foreignAuth: 'https://attacker-ref.supabase.co/auth/v1/token',
        parentDomain: 'https://supabase.co/x',
        subOfOwn: 'https://x.example-ref.supabase.co/x',
      };
      for (const [k, u] of Object.entries(attempts)) {
        try { await fetch(u); r[k] = 'sent'; } catch (e) { r[k] = (e as Error).name; }
      }
      return r;
    });
    const v = (await violations()).filter((x) => x.directive === 'connect-src').map((x) => x.blocked);
    expect(v.some((b) => b.includes('evil.example/x')), `connect-src на evil.example: ${v.join(' | ')}`).toBe(true);
    expect(v.some((b) => b.startsWith('https://example-ref.supabase.co.evil.example')), 'двойник *.supabase.co.evil.example не пропущен').toBe(true);
    expect(v.some((b) => b.startsWith('https://attacker-ref.supabase.co/rest/v1/steal')), `чужой проект Supabase заблокирован: ${v.join(' | ')}`).toBe(true);
    expect(v.some((b) => b.startsWith('https://attacker-ref.supabase.co/auth/v1/token'))).toBe(true);
    expect(Object.values(outcome).every((x) => x === 'TypeError'), JSON.stringify(outcome)).toBe(true);
  });

  test('вход, хранилище, консоль, отчёт проверки облака, выход: секреты не утекают', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.origin }).catch(() => undefined);
    const violations = await recordViolations(page);
    const mock = await mockSupabase(page, { loginOk: true });
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));

    await page.goto(`${srv.origin}/#/`);
    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible({ timeout: 20_000 });

    // что лежит в localStorage: ключи и значения (для отчёта о находках)
    const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''])));
    const keys = Object.keys(ls).sort();
    test.info().annotations.push({ type: 'localStorage', description: keys.join(', ') });
    expect(keys).toContain('finora-auth');
    expect(ls['finora-auth']).toContain(REFRESH); // сессия хранится открытым текстом: именно поэтому нужна CSP
    expect(JSON.parse(ls['finora:lastUser']!)).toEqual({ id: USER_ID, email: EMAIL }); // почта открытым текстом (находка low)
    // пароль нигде не сохранён
    expect(JSON.stringify(ls)).not.toContain(PASSWORD);
    const idb = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.map((d) => d.name);
    });
    test.info().annotations.push({ type: 'indexedDB', description: String(idb) });

    // экран «Настройки» не показывает секретов
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    if ((await nav.getByRole('link', { name: 'Настройки', exact: true }).count()) > 0) {
      await nav.getByRole('link', { name: 'Настройки', exact: true }).first().click(); // ПК: пункт боковой панели
    } else {
      await nav.getByRole('link', { name: 'Ещё', exact: true }).first().click(); // телефон: через «Ещё»
      await page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true }).click();
    }
    const body = await page.locator('body').innerText();
    for (const secret of [ACCESS, REFRESH, ANON, PASSWORD]) expect(body).not.toContain(secret);
    if (process.env.SEC_DEBUG) console.log(`--- localStorage: ${JSON.stringify(ls).replace(ACCESS, '<ACCESS>')}\n--- idb: ${idb}\n--- консоль:\n${logs.join('\n')}`);

    // консоль: ни токенов, ни пароля, ни ключа
    for (const secret of [ACCESS, REFRESH, ANON, PASSWORD]) {
      expect(logs.filter((l) => l.includes(secret)), `консоль содержит ${secret.slice(0, 12)}…`).toEqual([]);
    }
    // адрес страницы без токенов
    expect(page.url()).not.toMatch(/access_token|refresh_token|token=/);

    // запросы: только свой хост и Supabase; Authorization — только на Supabase
    const hosts = new Set(mock.seen.map((r) => new URL(r.url()).host));
    expect([...hosts]).toEqual([`${REF}.supabase.co`]);
    expect(await violations(), 'нарушения CSP в облачном режиме').toEqual([]);

    // Сервис-воркер не кэширует ничего приватного: ни ответы Supabase, ни чужие адреса
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
      return out;
    });
    test.info().annotations.push({ type: 'cache entries', description: String(cached.length) });
    expect(cached.filter((u) => /supabase\.co|\/rest\/v1|\/auth\/v1/.test(u))).toEqual([]);
    expect(cached.filter((u) => new URL(u).origin !== srv.origin)).toEqual([]);

    // Выход: сессия и «последний пользователь» убраны
    await page.getByRole('button', { name: /Выйти/ }).first().click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /Выйти/ });
    if (await confirm.count()) await confirm.first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible({ timeout: 15_000 });
    const after = await page.evaluate(() => ({ auth: localStorage.getItem('finora-auth'), last: localStorage.getItem('finora:lastUser') }));
    expect(after).toEqual({ auth: null, last: null });
  });

  test('параметры адреса не подменяют Supabase и не уводят со страницы (открытый редирект)', async ({ page }) => {
    const mock = await mockSupabase(page, { loginOk: true });
    const outside: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      // источники курсов (src/rates) — законные; важно, что нет НИЧЕГО сверх них и сверх Supabase из сборки
      if (u.origin !== srv.origin && u.hostname !== `${REF}.supabase.co` && !RATE_HOSTS.includes(u.origin)) outside.push(r.url());
    });
    const evil = 'https://evil.example';
    const q = `next=${evil}&redirect=${evil}&returnTo=${evil}&supabase_url=${evil}&VITE_SUPABASE_URL=${evil}&url=${evil}`;
    await page.goto(`${srv.origin}/?${q}#/login?${q}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).origin).toBe(srv.origin);
    expect(outside, 'запросы к чужим хостам').toEqual([]);
    expect(mock.seen.every((r) => r.url().startsWith(SUPA))).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeVisible();
  });

  test('мета-политика облачной сборки: точный адрес проекта (https и wss), без звёздочек, стиль строгий; заголовок тот же, что и в локальной', async ({ request }) => {
    const html = readFileSync(join(variantDir, 'index.html'), 'utf8');
    const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? '';
    expect(meta).not.toContain('@@');
    expect(meta).not.toMatch(/\*/);
    const csp = parseCsp(meta);
    expect(csp['connect-src']).toEqual(["'self'", SUPA, `wss://${REF}.supabase.co`, ...RATE_HOSTS]);
    expect(csp['style-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    // заголовок не зависит от ключей сборки и содержит только frame-ancestors
    const r = await request.get(`${srv.origin}/`);
    expect(r.headers()['content-security-policy']).toBe(headersFor('/')['content-security-policy']);
    expect(parseCsp(r.headers()['content-security-policy'] ?? '')).toEqual({ 'frame-ancestors': ["'none'"] });
  });

  test('WebSocket (realtime): свой проект по wss политика не блокирует, чужой проект и ws:// (без шифрования) — блокирует', async ({ page, errors }) => {
    // Playwright подменяет WebSocket на уровне страницы (routeWebSocket) раньше политики, поэтому здесь настоящие соединения:
    // свой адрес в песочнице недоступен (ошибка сети — это нормально), а нарушения политики видны по событию securitypolicyviolation.
    errors.allow(/Refused to|Content Security Policy|WebSocket/i);
    const violations = await recordViolations(page);
    await mockSupabase(page, { loginOk: false });
    await page.goto(`${srv.origin}/#/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await page.evaluate(() => {
      for (const u of ['wss://example-ref.supabase.co/realtime/v1/websocket', 'wss://attacker-ref.supabase.co/realtime/v1/websocket', 'ws://example-ref.supabase.co/realtime/v1/websocket']) {
        try { new WebSocket(u).addEventListener('error', () => undefined); } catch { /* блокировка может быть и исключением */ }
      }
    });
    await expect
      .poll(async () => (await violations()).filter((x) => x.directive === 'connect-src').length, { message: 'нарушения connect-src должны быть записаны' })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(500);
    const blocked = (await violations()).filter((x) => x.directive === 'connect-src').map((x) => x.blocked);
    expect(blocked.some((b) => b.startsWith('wss://attacker-ref.supabase.co')), `чужой wss заблокирован: ${blocked.join(' | ')}`).toBe(true);
    expect(blocked.some((b) => b.startsWith('ws://example-ref.supabase.co')), 'ws:// (без шифрования) к своему проекту заблокирован').toBe(true);
    expect(blocked.some((b) => b.startsWith('wss://example-ref.supabase.co')), 'свой wss не заблокирован').toBe(false);
  });
});
