import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import type { Page } from '@playwright/test';

/* ---------------------------------------------------------------------------------------------
 * Помощники модуля «sec». Главное: маленький статический сервер, который отдаёт ЗАГОЛОВКИ ИЗ vercel.json
 * (vite preview их не отдаёт), чтобы проверять настоящую политику безопасности (CSP) в настоящем браузере.
 * ------------------------------------------------------------------------------------------- */

export const ROOT = process.cwd();
/** Папка сборки (та же, что собирает playwright.config.ts для E2E_DIST). */
export const DIST = resolve(ROOT, process.env.E2E_DIST ?? 'dist');
/** Куда класть дополнительные сборки (например, «облачную»). */
export const SEC_TMP = process.env.SEC_TMP ?? join(tmpdir(), 'finora-sec-e2e');

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
  '.map': 'application/json',
};

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

export function readVercel(): { headers: HeaderRule[] } {
  return JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { headers: HeaderRule[] };
}

/** `/assets/(.*)` → регулярка. Поддерживаем только то, что нам нужно: простой путь и `(.*)`. */
function sourceToRegExp(source: string): RegExp {
  const body = source
    .split('(.*)')
    .map((part) => part.replace(/[.+?^${}|[\]\\()*]/g, '\\$&'))
    .join('(.*)');
  return new RegExp(`^${body}$`);
}

/** Заголовки для пути так, как их собрал бы Vercel: правила по порядку, поздние дополняют ранние. */
export function headersFor(path: string, rules: HeaderRule[] = readVercel().headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) {
    if (!sourceToRegExp(r.source).test(path)) continue;
    for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

export interface HeaderServer {
  origin: string;
  /** Все запросы: [путь, код]. */
  log: Array<[string, number]>;
  close(): Promise<void>;
}

/** Статический хостинг папки `root` с заголовками из vercel.json. */
export async function startHeaderServer(root: string = DIST, extra: Record<string, string> = {}): Promise<HeaderServer> {
  const dir = resolve(root);
  const rules = readVercel().headers;
  const log: Array<[string, number]> = [];
  const server: Server = createServer((req, res) => {
    const reply = (code: number, body?: Buffer | string, headers: Record<string, string> = {}) => {
      log.push([req.url ?? '', code]);
      res.writeHead(code, headers);
      res.end(body);
    };
    try {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      const file = normalize(join(dir, rel));
      if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
        return reply(404, 'not found', headersFor(path, rules));
      }
      reply(200, readFileSync(file), {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        ...headersFor(path, rules),
        ...extra,
      });
    } catch (e) {
      reply(500, String(e));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    log,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

/** Сервер «чужого сайта» с одной страницей (для проверки встраивания приложения в чужую страницу). */
export async function startHostPage(html: string): Promise<HeaderServer> {
  const log: Array<[string, number]> = [];
  const server = createServer((req, res) => {
    log.push([req.url ?? '', 200]);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, log, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

/** Рекурсивный список файлов папки (относительные пути). */
export function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out;
}

/** Сборка с переменными окружения облака в отдельную папку (кэшируется на время прогона). */
export function buildVariant(name: string, env: Record<string, string>): string {
  const out = join(SEC_TMP, name);
  mkdirSync(SEC_TMP, { recursive: true });
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'pipe',
    timeout: 180_000,
  });
  return out;
}

/* ------------------------------ нарушения CSP ------------------------------ */

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
  sample: string;
}

/**
 * Начать запись нарушений CSP на странице (событие securitypolicyviolation) и текстов «Refused to …» из консоли.
 * Вызывать ДО page.goto. Возвращает функцию чтения.
 */
export async function recordViolations(page: Page): Promise<() => Promise<CspViolation[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: unknown[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, sample: e.sample });
    });
  });
  const consoleRefused: CspViolation[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Refused to|violates the following Content Security Policy|Content Security Policy/i.test(t)) {
      consoleRefused.push({ directive: 'console', blocked: t.slice(0, 300), source: '', sample: '' });
    }
  });
  return async () => {
    const fromPage = await page.evaluate(() => ((window as unknown as { __csp?: unknown[] }).__csp ?? []) as CspViolation[]).catch(() => []);
    return [...fromPage, ...consoleRefused];
  };
}

/** Разобрать CSP в {директива: [источники]}. */
export function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = vals;
  }
  return out;
}
