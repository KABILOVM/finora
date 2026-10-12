import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, TMP, launchProfile, pngSize, startStatic, type StaticServer } from './helpers';

// 1. Манифест, иконки, мета-теги, критерии установки. Раздача: корень домена и подпапка (GitHub Pages).
for (const prefix of ['/', '/finora-app/v2/']) {
  test.describe(`манифест и установка, раздача из «${prefix}»`, () => {
    let srv: StaticServer;
    test.beforeAll(async () => {
      srv = await startStatic(DIST, prefix);
    });
    test.afterAll(async () => {
      await srv.close();
    });

    test('manifest.webmanifest валиден; start_url и scope верны', async ({ request }) => {
      const res = await request.get(`${srv.url}manifest.webmanifest`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
      const m = await res.json();
      expect(m.name).toBeTruthy();
      expect(m.short_name).toBe('Sumoima');
      expect(m.short_name.length).toBeLessThanOrEqual(12);
      expect(m.lang).toBe('ru');
      expect(m.display).toBe('standalone');
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
      // Относительные адреса: никаких «/…» (в подпапке они увели бы на чужой корень домена).
      for (const key of ['start_url', 'scope'] as const) {
        expect(m[key], key).toBeDefined();
        expect(String(m[key]).startsWith('/'), `${key} не должен начинаться с «/»`).toBe(false);
        expect(String(m[key]), key).not.toMatch(/^[a-z]+:/i);
      }
      const manifestUrl = new URL(`${srv.url}manifest.webmanifest`);
      const start = new URL(m.start_url, manifestUrl);
      const scope = new URL(m.scope, manifestUrl);
      expect(scope.href).toBe(srv.url);
      expect(start.href.startsWith(scope.href), 'start_url внутри scope').toBe(true);
      // start_url реально открывается (200, html), а не 404 в подпапке
      const startRes = await request.get(start.href);
      expect(startRes.status()).toBe(200);
      expect(startRes.headers()['content-type']).toMatch(/text\/html/);
      for (const ic of m.icons) {
        expect(String(ic.src).startsWith('/'), `иконка ${ic.src} без «/» в начале`).toBe(false);
      }
    });

    test('иконки 192/512/maskable отдаются как PNG нужного размера', async ({ request }) => {
      const m = await (await request.get(`${srv.url}manifest.webmanifest`)).json();
      const found = new Set<string>();
      for (const ic of m.icons as Array<{ src: string; sizes: string; type: string; purpose?: string }>) {
        const res = await request.get(new URL(ic.src, `${srv.url}manifest.webmanifest`).href);
        expect(res.status(), ic.src).toBe(200);
        expect(res.headers()['content-type'], ic.src).toBe('image/png');
        expect(ic.type).toBe('image/png');
        const size = pngSize(await res.body());
        expect(size, `${ic.src}: это не PNG`).not.toBeNull();
        const [w, h] = ic.sizes.split('x').map(Number);
        expect({ w: size!.w, h: size!.h }, `${ic.src}: размер файла против sizes=${ic.sizes}`).toEqual({ w, h });
        found.add(`${ic.sizes}:${ic.purpose ?? 'any'}`);
      }
      expect(found).toContain('192x192:any');
      expect(found).toContain('512x512:any');
      expect(found).toContain('512x512:maskable');
    });

    test('maskable-иконка: значимое содержимое внутри безопасной зоны (круг 80%), фон сплошной', async ({ page, request }) => {
      await page.goto(srv.url);
      const m = await (await request.get(`${srv.url}manifest.webmanifest`)).json();
      const mask = m.icons.find((i: { purpose?: string }) => i.purpose === 'maskable');
      const res = await page.evaluate(async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        const bg = [data[0]!, data[1]!, data[2]!];
        let maxR = 0;
        let transparent = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3]! < 250) transparent++;
            const d = Math.abs(data[i]! - bg[0]!) + Math.abs(data[i + 1]! - bg[1]!) + Math.abs(data[i + 2]! - bg[2]!);
            if (d > 30) maxR = Math.max(maxR, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) / width);
          }
        }
        return { maxR, transparent };
      }, new URL(mask.src, `${srv.url}manifest.webmanifest`).href);
      expect(res.transparent, 'у maskable не должно быть прозрачных пикселей').toBe(0);
      expect(res.maxR, 'содержимое дальше 40% ширины от центра — обрежется маской').toBeLessThanOrEqual(0.4);
    });

    test('index.html: iOS-теги, viewport-fit=cover, theme-color для светлой и тёмной темы, ссылки живые', async ({ request }) => {
      const html = await (await request.get(srv.url)).text();
      expect(html).toMatch(/<html[^>]*lang="ru"/);
      expect(html).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
      expect(html).not.toMatch(/user-scalable=no|maximum-scale=1(?![0-9])/);
      expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
      expect(html).toMatch(/<meta name="apple-mobile-web-app-title"/);
      const themes = [...html.matchAll(/<meta name="theme-color" content="([^"]+)"(?: media="([^"]+)")?/g)];
      const byMedia = Object.fromEntries(themes.map((t) => [t[2] ?? 'any', t[1]]));
      expect(byMedia['(prefers-color-scheme: light)']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(byMedia['(prefers-color-scheme: dark)']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(byMedia['(prefers-color-scheme: light)']).not.toBe(byMedia['(prefers-color-scheme: dark)']);
      expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest"/);
      // Все href/src, ведущие на файлы приложения, относительные и отвечают 200 (иначе в подпапке — битые ссылки).
      const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!).filter((u) => !u.startsWith('http'));
      expect(refs.length).toBeGreaterThan(5);
      for (const ref of refs) {
        expect(ref.startsWith('/'), `${ref}: абсолютный путь сломается в подпапке`).toBe(false);
        const r = await request.get(new URL(ref, srv.url).href);
        expect(r.status(), ref).toBe(200);
      }
      const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
      expect(touch).toBeTruthy();
      const img = await request.get(new URL(touch!, srv.url).href);
      expect(img.headers()['content-type']).toBe('image/png');
      expect(pngSize(await img.body())).toEqual({ w: 180, h: 180 });
    });

    test('Chromium: критерии установки выполнены (Page.getInstallabilityErrors пуст)', async () => {
      mkdirSync(TMP, { recursive: true });
      // Обычный профиль: в «инкогнито» Chromium всегда отвечает in-incognito.
      const context = await launchProfile(mkdtempSync(join(TMP, 'install-')));
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(srv.url);
      await page.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      // Манифест и воркер разбираются не мгновенно: опрашиваем до 10 с.
      let errors: Array<{ errorId: string }> = [];
      for (let i = 0; i < 20; i++) {
        errors = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors as typeof errors;
        if (errors.length === 0) break;
        await page.waitForTimeout(500);
      }
      expect(errors).toEqual([]);
      const app = await cdp.send('Page.getAppManifest');
      expect(app.errors, 'ошибки разбора манифеста').toEqual([]);
      const parsed = JSON.parse(app.data ?? '{}');
      expect(parsed.display).toBe('standalone');
      await context.close();
    });
  });
}
