/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readCloudConfig } from './src/auth/config';

/* ---------------------------------------------------------------------------------------------
 * Политика безопасности страницы (CSP) собирается ПОД КОНКРЕТНЫЙ проект Supabase.
 * В index.html лежат две метки; при сборке (и в `npm run dev`) они заменяются так:
 *   @@SUPABASE_CONNECT@@ — точные источники Supabase из VITE_SUPABASE_URL: `https://<хост>` и `wss://<хост>`
 *                          (для http-адреса: `http://` и `ws://`). Нет облака (переменных нет или в них заготовка из
 *                          .env.example — тот же разбор, что у самого приложения, readCloudConfig) — источников Supabase нет вовсе;
 *   @@DEV_STYLE@@        — `'unsafe-inline'` ТОЛЬКО в `npm run dev` (там Vite вставляет CSS тегом <style>); в сборке стиль строгий.
 * Подстановки вида *.supabase.co нет: иначе при XSS данные можно было бы выгрузить в ЧУЖОЙ проект Supabase, а свой домен
 * Supabase (не *.supabase.co) браузер блокировал бы. Заголовок из vercel.json держит только frame-ancestors (в <meta> он не работает).
 * ------------------------------------------------------------------------------------------- */

const CSP_SUPABASE_MARK = '@@SUPABASE_CONNECT@@';
const CSP_DEV_STYLE_MARK = '@@DEV_STYLE@@';

/**
 * Источники Supabase для connect-src. Пусто, если облака нет. Бросает ошибку, если адрес приложению подходит, а в политику
 * его безопасно вписать нельзя (иначе облако молча перестало бы работать, а то и «просочилось» бы чужое в политику).
 */
export function supabaseConnectSources(env: Record<string, unknown>): string[] {
  const cfg = readCloudConfig(env);
  if (cfg === null) return [];
  const u = new URL(cfg.url);
  // В имени хоста по правилам URL допустимы и «;», и кавычки, и «*»: из них можно было бы дописать чужую директиву в политику.
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(u.hostname) || !/^\d{0,5}$/.test(u.port)) {
    throw new Error(`VITE_SUPABASE_URL: адрес «${u.host}» нельзя вписать в политику безопасности страницы (CSP). Нужен обычный адрес вида https://abcdefgh.supabase.co`);
  }
  const [http, ws] = u.protocol === 'https:' ? ['https', 'wss'] : ['http', 'ws'];
  return [`${http}://${u.host}`, `${ws}://${u.host}`];
}

/** Мета-тег с политикой: метки заменяются только внутри его content (в комментарии index.html о метках рассказано словами). */
const CSP_META = /(http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;

/** Подставляет метки CSP в index.html. Бросает ошибку, если мета-тега или меток нет (иначе политика осталась бы неполной). */
export function applyCsp(html: string, env: Record<string, unknown>, dev: boolean): string {
  const m = CSP_META.exec(html);
  if (m === null) throw new Error('index.html: нет мета-тега Content-Security-Policy');
  for (const mark of [CSP_SUPABASE_MARK, CSP_DEV_STYLE_MARK]) {
    if (!m[2]!.includes(mark)) throw new Error(`index.html: в политике безопасности страницы нет метки ${mark}`);
  }
  const policy = m[2]!
    .replaceAll(CSP_SUPABASE_MARK, supabaseConnectSources(env).map((s) => ` ${s}`).join(''))
    .replaceAll(CSP_DEV_STYLE_MARK, dev ? " 'unsafe-inline'" : '');
  return html.replace(CSP_META, (_all, head: string, _old: string, tail: string) => `${head}${policy}${tail}`);
}

function finoraCsp(): Plugin {
  let env: Record<string, unknown> = {};
  return {
    name: 'finora-csp',
    // config.env — ровно те значения VITE_*, которые попадут в приложение как import.meta.env (с учётом файлов .env)
    configResolved: (config) => {
      env = config.env;
    },
    transformIndexHtml: (html, ctx) => applyCsp(html, env, ctx.server !== undefined),
  };
}

// base: './' — чтобы работало на любом хостинге (GitHub Pages в подпапке, Cloudflare Pages в корне).
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    finoraCsp(),
    react(),
    VitePWA({
      // «prompt»: новая версия не подменяет приложение молча, пока человек вносит операцию.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Sumoima — учёт денег',
        short_name: 'Sumoima',
        description: 'Личный учёт расходов и доходов. Работает без интернета.',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#080a18',
        theme_color: '#080a18',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Только файлы самого приложения. Запросы к Supabase НЕ кэшируем никогда (приватные данные).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
        // Показ push-напоминаний: файл из public/ подключается к сервис-воркеру (вся логика push — в нём, не в generateSW).
        importScripts: ['push-handler.js'],
      },
    }),
  ],
  build: {
    target: 'es2022',
    // Шрифты — всегда отдельными файлами: политика безопасности (font-src 'self') не пускает шрифты, встроенные в CSS как data:.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    sourcemap: false,
    rollupOptions: {
      output: {
        // Тяжёлые библиотеки — отдельными файлами: при выходе новой версии приложения они не скачиваются заново.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-react';
          if (/node_modules\/(@supabase|@supabase\/.*|tslib|iceberg-js)\//.test(id)) return 'vendor-supabase';
          if (/node_modules\/(dexie|dexie-react-hooks)\//.test(id)) return 'vendor-dexie';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    globals: false,
    testTimeout: 20000,
    // В CI один повтор для редких гонок (тест «выйти и удалить данные» иногда не успевает за удалением базы); локально — без повторов, чтобы флаки были видны
    retry: process.env.CI ? 1 : 0,
  },
});
