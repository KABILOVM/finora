import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Параметры через переменные окружения — чтобы несколько прогонов могли идти одновременно:
//   E2E_PORT  — порт предпросмотра (по умолчанию 4173)
//   E2E_DIST  — папка сборки (по умолчанию dist)
//   PW_CHROMIUM_PATH — путь к Chromium (по умолчанию системный /opt/pw-browsers/chromium, если он есть)
const PORT = Number(process.env.E2E_PORT ?? 4173);
const DIST = process.env.E2E_DIST ?? 'dist';
const CHROMIUM = process.env.PW_CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const launchOptions = CHROMIUM ? { executablePath: CHROMIUM } : {};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Asia/Dushanbe',
    launchOptions,
  },
  webServer: {
    command: `npx vite build --outDir ${DIST} --emptyOutDir && npx vite preview --outDir ${DIST} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium', launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions } },
  ],
});
