import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

/** Корень проекта (Playwright запускается из него). */
export const ROOT = process.cwd();
/** Папка для временных сборок. Можно переопределить: PWA_TMP=/путь. */
export const TMP = process.env.PWA_TMP ?? join(tmpdir(), 'finora-pwa-e2e');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export interface StaticServer {
  /** Адрес приложения, например http://127.0.0.1:5555/sub/app/ */
  url: string;
  origin: string;
  /** Подменить раздаваемую папку «на лету» — как выкладка новой версии на хостинг. */
  setRoot(dir: string): void;
  /** Все запросы, которые дошли до сервера: [путь, код]. */
  log: Array<[string, number]>;
  close(): Promise<void>;
}

/**
 * Минимальный статический хостинг: заголовки как у Vercel/Cloudflare (html и sw.js — перепроверять всегда,
 * /assets/* — навсегда). prefix — раздача из подпапки домена (GitHub Pages: /repo/).
 */
export async function startStatic(root: string, prefix = '/'): Promise<StaticServer> {
  let current = resolve(root);
  const log: Array<[string, number]> = [];
  const pre = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const server: Server = createServer((req, res) => {
    const reply = (code: number, body?: Buffer | string, headers: Record<string, string> = {}) => {
      log.push([req.url ?? '', code]);
      res.writeHead(code, headers);
      res.end(body);
    };
    try {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      if (!path.startsWith(pre)) return reply(404, 'not found');
      let rel = path.slice(pre.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(current, rel));
      if (!file.startsWith(current) || !existsSync(file) || !statSync(file).isFile()) return reply(404, 'not found');
      const immutable = rel.startsWith('assets/');
      reply(200, readFileSync(file), {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      });
    } catch {
      reply(500, 'error');
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}${pre}`,
    origin,
    setRoot: (dir) => {
      current = resolve(dir);
    },
    log,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

/** Копия исходников проекта (без node_modules, dist, тестов) во временной папке; node_modules — ссылкой. */
export function makeWorkCopy(name: string): string {
  const dest = join(TMP, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of ['index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'postcss.config.js', 'tailwind.config.js', 'package.json']) {
    if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dest, f));
  }
  cpSync(join(ROOT, 'public'), join(dest, 'public'), { recursive: true });
  cpSync(join(ROOT, 'src'), join(dest, 'src'), {
    recursive: true,
    filter: (p) => !/\.test\.tsx?$/.test(p) && !p.includes('__fixtures__'),
  });
  symlinkSync(join(ROOT, 'node_modules'), join(dest, 'node_modules'), 'dir');
  return dest;
}

/** Собрать копию проекта в outDir (vite build). */
export function buildCopy(copyDir: string, outDir: string): void {
  execFileSync(join(ROOT, 'node_modules/.bin/vite'), ['build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: copyDir,
    stdio: 'pipe',
    env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  });
}

/** Заменить текст в файле копии; бросает, если такого текста нет (чтобы тест не «прошёл» вхолостую). */
export function patchFile(file: string, from: string, to: string): void {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(from)) throw new Error(`В ${file} нет текста «${from}»`);
  writeFileSync(file, src.split(from).join(to));
}

export function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out;
}

/** Дождаться, пока сервис-воркер станет активным и возьмёт страницу под контроль. */
export async function waitForSw(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((ok) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true });
        setTimeout(ok, 4000);
      });
    }
    void reg;
  });
  // Если воркер активировался уже после загрузки страницы, контроль появится после перезагрузки.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

/** Содержимое всех кэшей: { имя кэша: [url, ...] }. */
export async function cacheDump(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      out[name] = (await c.keys()).map((r) => r.url);
    }
    return out;
  });
}

/** Внести расход через интерфейс: «+» → сумма → категория → «Сохранить». */
export async function addExpense(page: Page, digits: string, category = 'Еда'): Promise<void> {
  await page.getByRole('link', { name: 'Добавить операцию' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const amount = dialog.locator('input.money').first();
  await amount.click();
  await amount.fill(digits);
  await dialog.getByRole('button', { name: category, exact: false }).first().click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

export async function newCtx(browser: import('@playwright/test').Browser, extra: Parameters<import('@playwright/test').Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ locale: 'ru-RU', timezoneId: 'Asia/Dushanbe', viewport: { width: 390, height: 800 }, ...extra });
}

/** Папка собранного приложения (то же, что собирает webServer из playwright.config.ts). */
export const DIST = resolve(ROOT, process.env.E2E_DIST ?? 'dist');

/** Сколько байт/пикселей у PNG (из заголовка IHDR). */
export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Список адресов из precacheAndRoute([...]) в собранном sw.js. */
export function precacheUrls(dist: string = DIST): string[] {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  return [...sw.matchAll(/\{url:"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * Обычный (не «инкогнито») профиль Chromium в папке dir. Нужен там, где важно настоящее поведение браузера:
 * критерии установки (в инкогнито они всегда «in-incognito»), полный перезапуск браузера, офлайн с самого старта.
 */
export async function launchProfile(
  dir: string,
  opts: { offline?: boolean; viewport?: { width: number; height: number } } = {},
): Promise<BrowserContext> {
  const exe = process.env.PW_CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
  return chromium.launchPersistentContext(dir, {
    ...(exe ? { executablePath: exe } : {}),
    locale: 'ru-RU',
    timezoneId: 'Asia/Dushanbe',
    viewport: opts.viewport ?? { width: 390, height: 800 },
    offline: opts.offline ?? false,
  });
}
