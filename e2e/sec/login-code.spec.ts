import type { Page, Request, Route } from '@playwright/test';
import { expect, shot, test } from '../helpers';
import { buildVariant, recordViolations, startHeaderServer, type HeaderServer } from './helpers';

/* ---------------------------------------------------------------------------------------------
 * Вход по коду на почту в облачной сборке (поддельный проект Supabase, ответы подменены на уровне сети — как в cloud.spec.ts).
 * Проверяем: полный путь «почта → код → вошёл»; новых пользователей не создаём; на неизвестную почту — тот же экран;
 * честные ошибки (нет сети, лимит попыток, неверный код); почта, код и токены не попадают в консоль, адрес и хранилище
 * сверх того, что кладёт supabase-js под своим ключом (и «последнего пользователя» из src/auth/lastUser.ts).
 * ------------------------------------------------------------------------------------------- */

const REF = 'example-ref';
const SUPA = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_FAKEKEYFORTESTING0123456789';
const EMAIL = 'friend.secret@example.org';
const UNKNOWN = 'nobody.secret@example.org';
const CODE = '482916';
const USER_ID = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48';

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ACCESS = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fakesignature`;
const REFRESH = 'REFRESH-TOKEN-SECRET-xyz';
const userJson = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const sessionJson = () => ({ access_token: ACCESS, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: REFRESH, user: userJson });

let srv: HeaderServer;
test.beforeAll(async () => {
  srv = await startHeaderServer(buildVariant('login-code', { VITE_SUPABASE_URL: SUPA, VITE_SUPABASE_ANON_KEY: ANON }));
});
test.afterAll(async () => {
  await srv?.close();
});

interface Mock {
  seen: Request[];
  /** Тела запросов кода и проверки. */
  otp: Array<Record<string, unknown>>;
  verify: Array<Record<string, unknown>>;
  /** Как отвечает запрос кода: ok | rate | offline | server. */
  otpMode: 'ok' | 'rate' | 'offline' | 'server';
  verifyMode: 'ok' | 'rate';
}

async function mockSupabase(page: Page): Promise<Mock> {
  const mock: Mock = { seen: [], otp: [], verify: [], otpMode: 'ok', verifyMode: 'ok' };
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
      const body = (): Record<string, unknown> => {
        try {
          return JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      if (url.pathname === '/auth/v1/otp') {
        const b = body();
        mock.otp.push(b);
        if (mock.otpMode === 'offline') return route.abort('failed');
        if (mock.otpMode === 'rate') return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
        if (mock.otpMode === 'server') return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error' });
        // как GoTrue: для неизвестной почты при create_user:false регистрация закрыта; письмо не отправляется
        if (b.email !== EMAIL && b.create_user === false) return json(422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
        return json(200, {});
      }
      if (url.pathname === '/auth/v1/verify') {
        const b = body();
        mock.verify.push(b);
        if (mock.verifyMode === 'rate') return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
        if (b.email === EMAIL && b.token === CODE && b.type === 'email') return json(200, sessionJson());
        return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      }
      if (url.pathname === '/auth/v1/user') return json(200, userJson);
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname.startsWith('/rest/v1/')) return req.method() === 'GET' ? json(200, [], { 'content-range': '*/0' }) : json(201, []);
      return json(404, { message: 'not found' });
    },
  );
  return mock;
}

const emailField = (page: Page) => page.getByRole('textbox', { name: 'Почта' });
const codeField = (page: Page) => page.getByRole('textbox', { name: 'Код из письма' });

async function openCodeLogin(page: Page): Promise<void> {
  await page.goto(`${srv.origin}/#/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
  await page.getByRole('radio', { name: 'Код на почту' }).click();
}

async function requestCode(page: Page, email: string): Promise<void> {
  await emailField(page).fill(email);
  await page.getByRole('button', { name: 'Прислать код' }).click();
}

const storageDump = (page: Page) =>
  page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''])),
    session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k) ?? ''])),
  }));

test.describe('Вход по коду на почту (облачная сборка)', () => {
  test('почта → код → вошёл: без создания пользователя, без утечек почты, кода и токенов', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const violations = await recordViolations(page);
    const mock = await mockSupabase(page);
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));
    const urls: string[] = [];
    page.on('framenavigated', (f) => urls.push(f.url()));

    await openCodeLogin(page);
    await requestCode(page, ` ${EMAIL.toUpperCase()} `);
    await expect(page.getByText('Если такая почта есть, мы отправили на неё код.')).toBeVisible();
    await expect(codeField(page)).toBeFocused();
    await shot(page, 'login-code-step2', testInfo);

    // запрос кода: именно эта почта (строчными), пользователей не создаём
    expect(mock.otp).toHaveLength(1);
    expect(mock.otp[0]).toMatchObject({ email: EMAIL, create_user: false });
    // кнопка «ещё раз» недоступна, отсчёт идёт
    await expect(page.getByRole('button', { name: 'Прислать код ещё раз' })).toBeDisabled();
    await expect(page.getByText(/через \d+ с/)).toBeVisible();
    await expect(page.getByText(/Проверьте «Спам»/)).toBeVisible();

    // на этом шаге почта и код нигде не сохранены
    const mid = await storageDump(page);
    expect(JSON.stringify(mid)).not.toContain(EMAIL);
    expect(JSON.stringify(mid)).not.toContain('friend.secret');
    expect(Object.keys(mid.local).filter((k) => /auth|lastUser/.test(k))).toEqual([]);

    // вставка кода с пробелом и дефисом
    await codeField(page).click();
    await page.evaluate(() => navigator.clipboard?.writeText('482-916').catch(() => undefined));
    await codeField(page).fill('482 916');
    await expect(codeField(page)).toHaveValue(CODE);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible({ timeout: 20_000 });

    expect(mock.verify).toEqual([{ email: EMAIL, token: CODE, type: 'email', gotrue_meta_security: {} }]);
    // токены и ключ ушли только на адрес Supabase из сборки
    for (const r of mock.seen) expect(new URL(r.url()).origin).toBe(SUPA);
    expect((await mock.seen.find((r) => r.url().includes('/auth/v1/verify'))!.allHeaders())['apikey']).toBe(ANON);
    // ни код, ни почта не попали в адреса запросов и страницы
    for (const r of mock.seen) expect(r.url()).not.toMatch(new RegExp(`${CODE}|friend|secret`, 'i'));
    expect([page.url(), ...urls].join(' ')).not.toMatch(new RegExp(`${CODE}|friend|secret|access_token|refresh_token`, 'i'));

    // хранилище: код нигде; почта и токены — только у supabase-js и в «последнем пользователе» (так задумано в src/auth/lastUser.ts)
    const after = await storageDump(page);
    for (const [key, value] of Object.entries({ ...after.local, ...after.session })) {
      expect(value, `код в ${key}`).not.toContain(CODE);
      if (key !== 'finora-auth' && key !== 'finora:lastUser') {
        expect(value, `почта в ${key}`).not.toContain(EMAIL);
        expect(value, `токен в ${key}`).not.toContain(REFRESH);
        expect(value, `токен в ${key}`).not.toContain(ACCESS);
      }
    }
    expect(after.local['finora-auth']).toContain(REFRESH);
    // консоль: ни почты, ни кода, ни токенов, ни ключа
    for (const secret of [EMAIL, 'friend.secret', CODE, ACCESS, REFRESH, ANON]) {
      expect(logs.filter((l) => l.includes(secret)), `консоль содержит ${secret.slice(0, 10)}…`).toEqual([]);
    }
    expect(await violations(), 'нарушения CSP').toEqual([]);
  });

  test('неизвестная почта: тот же экран и те же слова, что и для известной; код при этом не приходит', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCodeLogin(page);
    await requestCode(page, EMAIL);
    await expect(codeField(page)).toBeVisible();
    const known = (await page.locator('main').innerText()).replaceAll(EMAIL, '<почта>');

    await page.reload();
    await openCodeLogin(page);
    await requestCode(page, UNKNOWN);
    await expect(codeField(page)).toBeVisible();
    const unknown = (await page.locator('main').innerText()).replaceAll(UNKNOWN, '<почта>');
    expect(unknown).toBe(known);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(mock.otp.map((b) => b.create_user)).toEqual([false, false]);

    // с любым кодом войти нельзя, ответ как у неверного кода
    await codeField(page).fill(CODE);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Неверный или просроченный код/);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
  });

  test('лимит попыток при запросе кода и при проверке — честные сообщения, шаги не сбиваются', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCodeLogin(page);
    mock.otpMode = 'rate';
    await requestCode(page, EMAIL);
    await expect(page.getByRole('alert')).toHaveText('Слишком много попыток. Подождите несколько минут и повторите.');
    await expect(codeField(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Прислать код' })).toBeEnabled();

    mock.otpMode = 'ok';
    await page.getByRole('button', { name: 'Прислать код' }).click();
    await expect(codeField(page)).toBeVisible();
    mock.verifyMode = 'rate';
    await codeField(page).fill(CODE);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Слишком много попыток. Подождите несколько минут и повторите.');
    await expect(codeField(page)).toHaveValue(CODE);
  });

  test('нет сети и сбой сервера при запросе кода', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCodeLogin(page);
    mock.otpMode = 'offline';
    await requestCode(page, EMAIL);
    await expect(page.getByRole('alert')).toHaveText('Нет связи: для первого входа нужен интернет');
    mock.otpMode = 'server';
    await page.getByRole('button', { name: 'Прислать код' }).click();
    await expect(page.getByRole('alert')).toHaveText('Сервер сейчас недоступен. Попробуйте позже.');
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
  });

  test('неверный код → ошибка, цифры остаются; верный — пускает; «Изменить почту» возвращает на шаг 1', async ({ page }) => {
    await mockSupabase(page);
    await openCodeLogin(page);
    await requestCode(page, EMAIL);
    await codeField(page).fill('000000');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Неверный или просроченный код/);
    await expect(codeField(page)).toHaveValue('000000');

    await page.getByRole('button', { name: 'Изменить почту' }).click();
    await expect(emailField(page)).toHaveValue(EMAIL);
    await page.getByRole('button', { name: 'Прислать код' }).click();
    await codeField(page).fill(CODE);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('«Войти» недоступна, пока код короче минимума; ничего не уходит на сервер само', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCodeLogin(page);
    await requestCode(page, EMAIL);
    await codeField(page).pressSequentially('48291');
    await expect(page.getByRole('button', { name: 'Войти' })).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(mock.verify).toEqual([]);
    await codeField(page).pressSequentially('6');
    await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled();
    await page.waitForTimeout(300);
    expect(mock.verify, 'при наборе полной длины код сам не отправляется').toEqual([]);
  });

  test('парольная форма в облачной сборке размечена для связки ключей: username / current-password, name, id', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`${srv.origin}/#/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    const attrs = await page.evaluate(() => {
      const pick = (el: Element | null) => (el ? Object.fromEntries(['autocomplete', 'name', 'id', 'type', 'enterkeyhint'].map((a) => [a, el.getAttribute(a)])) : null);
      return { email: pick(document.querySelector('#login-email')), password: pick(document.querySelector('#login-password')), method: document.querySelector('form#password-login')?.getAttribute('method') };
    });
    expect(attrs.email).toEqual({ autocomplete: 'username', name: 'username', id: 'login-email', type: 'email', enterkeyhint: 'next' });
    expect(attrs.password).toEqual({ autocomplete: 'current-password', name: 'password', id: 'login-password', type: 'password', enterkeyhint: 'go' });
    expect(attrs.method).toBe('post');
  });

  test('вёрстка: оба способа и оба шага входа помещаются в экран (в том числе 320 px), ничего не обрезано', async ({ page }, testInfo) => {
    const mock = await mockSupabase(page);
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    const sizes = phone ? [{ width: 390, height: 844 }, { width: 320, height: 568 }] : [{ width: 1280, height: 800 }];
    for (const size of sizes) {
      await page.setViewportSize(size);
      const fits = async (label: string) => {
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const bad = [...document.querySelectorAll('main input, main button, main p, main h1, main label')]
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5))
            .map(({ e }) => (e.textContent ?? e.tagName).slice(0, 30));
          return { vw, scrollW: document.documentElement.scrollWidth, bad };
        });
        expect(m.scrollW, `${label}: горизонтальной прокрутки нет (${size.width}px)`).toBeLessThanOrEqual(m.vw);
        expect(m.bad, `${label}: не обрезано (${size.width}px)`).toEqual([]);
      };
      mock.otpMode = 'ok';
      await page.goto(`${srv.origin}/#/`);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
      await fits('пароль');
      await shot(page, `login-password-${size.width}`, testInfo);
      await page.getByRole('radio', { name: 'Код на почту' }).click();
      await fits('код, шаг 1');
      await shot(page, `login-code-step1-${size.width}`, testInfo);
      mock.otpMode = 'rate';
      await requestCode(page, EMAIL);
      await expect(page.getByRole('alert')).toBeVisible();
      await fits('код, шаг 1, ошибка');
      await shot(page, `login-code-step1-error-${size.width}`, testInfo);
      mock.otpMode = 'ok';
      await page.getByRole('button', { name: 'Прислать код' }).click();
      await expect(codeField(page)).toBeVisible();
      await codeField(page).fill('000000');
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await fits('код, шаг 2, ошибка');
      await shot(page, `login-code-step2-error-${size.width}`, testInfo);
    }
  });
});
