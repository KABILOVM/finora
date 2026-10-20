import { test as base, expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MORE_TITLE, SECTIONS } from '../src/app/sections';

/* ---------------------------------------------------------------------------------------------
 * Общие помощники для сквозных сценариев. Кнопки ищем по доступным именам (роль + текст/aria-label),
 * а не по CSS. Проекты: iphone (узкий экран, нижняя панель) и desktop (боковая панель).
 * ------------------------------------------------------------------------------------------- */

/** Сетевые сбои к внешним хостам (курсы валют и т. п.) в проверочной среде нормальны и находкой не считаются. */
const NETWORK_NOISE = /Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED/i;

export interface ErrorSink {
  /** Настоящие ошибки: pageerror и console.error, не похожие на сетевой сбой. */
  list: string[];
  /** Сетевые сбои (для отчёта: какие адреса не открылись). */
  network: string[];
  /** Подключить ещё одну страницу (новая вкладка, чистый контекст). */
  watch(page: Page): void;
  /** Сценарий нарочно ломает среду: ожидаемую запись в консоли (по тексту) не считать ошибкой. Только точечно. */
  allow(re: RegExp): void;
}

function makeSink(): ErrorSink {
  const allowed: RegExp[] = [];
  const sink: ErrorSink = {
    list: [],
    network: [],
    allow: (re) => void allowed.push(re),
    watch(page) {
      page.on('pageerror', (e) => sink.list.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (NETWORK_NOISE.test(text)) sink.network.push(text);
        else if (allowed.some((re) => re.test(text))) return;
        else sink.list.push(`console.error: ${text}`);
      });
    },
  };
  return sink;
}

/**
 * test с автоматической проверкой «нет ошибок»: каждый сценарий на каждом проекте
 * в конце проверяет, что не было ни pageerror, ни console.error (кроме сетевых сбоев).
 */
export const test = base.extend<{ errors: ErrorSink; showOnboarding: boolean; skipOnboarding: void }>({
  /** Сценарий про сам мастер настройки (26-onboarding) ставит true через test.use: тогда мастер заранее не отключается. */
  showOnboarding: [false, { option: true }],
  /** Мастер закрывает «Главную» у человека с чистой базой, а почти все сценарии открывают приложение именно так (и не только через openApp). */
  skipOnboarding: [
    async ({ page, showOnboarding }, use) => {
      if (!showOnboarding) await skipOnboardingInAdvance(page);
      await use();
    },
    { auto: true },
  ],
  errors: [
    async ({ page }, use) => {
      const sink = makeSink();
      sink.watch(page);
      await use(sink);
      expect(sink.list, 'ошибки в консоли страницы (pageerror / console.error)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/* ------------------------------ окружение ------------------------------ */

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;

/** Папка для снимков экрана: E2E_SHOTS или test-results/shots. */
export async function shot(page: Page, name: string, testInfo: TestInfo): Promise<string> {
  const dir = process.env.E2E_SHOTS ?? join(process.cwd(), 'test-results', 'shots');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Чистый контекст с теми же параметрами устройства, что у проекта (для «восстановления на новом устройстве»). */
export async function freshContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const u = testInfo.project.use;
  return browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport ?? undefined,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
    timezoneId: u.timezoneId,
    acceptDownloads: true,
  });
}

/* ------------------------------ текст и деньги ------------------------------ */

/** Неразрывные пробелы → обычные, лишние пробелы схлопнуты: так суммы удобно сравнивать. */
export const norm = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Регулярка для суммы: пробелы в ней могут быть любыми (в приложении это неразрывные). Пример: money('−12,50 с.'). */
export function money(text: string): RegExp {
  return new RegExp(text.split(/\s+/).map(esc).join('\\s'));
}

/** Регулярка «ровно эта сумма и ничего вокруг». */
export function moneyExact(text: string): RegExp {
  return new RegExp(`^\\s*${text.split(/\s+/).map(esc).join('\\s')}\\s*$`);
}

/* ------------------------------ запуск и ожидание ------------------------------ */

/** Открыть приложение по адресу (хэш-маршрут) и дождаться, пока появится каркас и данные прочитаны. */
export async function openApp(page: Page, hash = '/', opts: { onboarding?: boolean } = {}): Promise<void> {
  // Пошаговая настройка (мастер) появляется у человека с чистой базой и закрывает «Главную». Остальным сценариям она не нужна:
  // заранее отмечаем её пройденной (только если отметки ещё нет). Сценарий про сам мастер (26-onboarding) просит { onboarding: true }.
  if (!opts.onboarding) await skipOnboardingInAdvance(page);
  await page.goto(`/#${hash}`);
  if (opts.onboarding) {
    await expect(page.getByRole('dialog', { name: 'Настройка Sumoima' })).toBeVisible();
    return;
  }
  await waitReady(page);
  await closeOnboarding(page);
  await dismissInstallPrompt(page);
}

/** Пользователи сценариев: локальный режим и общий «вошедший» пользователь заглушек облака (21-reminders, sec/*). */
const ONBOARDING_USER_IDS = ['10ca1de0-0000-4000-8000-000000000001', '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48'];

/** Мастер настройки уже отмечен пройденным (скрипт срабатывает при каждой загрузке страницы, существующую отметку не затирает). */
export async function skipOnboardingInAdvance(page: Page): Promise<void> {
  await page.addInitScript((ids: string[]) => {
    try {
      // e2e.keepOnboarding — запрет затирать отметку (сценарий «старый аккаунт без отметки на устройстве»)
      if (localStorage.getItem('e2e.keepOnboarding') !== null) return;
      const done = JSON.stringify({ v: 1, step: 'finish', path: null, done: true, skipped: true, wants: { reminders: false, lock: false, install: false } });
      for (const id of ids) {
        const key = `finora:onboarding:v1:${id}`;
        if (localStorage.getItem(key) === null) localStorage.setItem(key, done);
      }
    } catch {
      // localStorage недоступен — мастер закроет closeOnboarding
    }
  }, ONBOARDING_USER_IDS);
}

/** Если мастер всё же показался — пропустить его («Пропустить, настрою сам»); если его нет, ничего не делает. */
export async function closeOnboarding(page: Page): Promise<void> {
  const dlg = page.getByRole('dialog', { name: 'Настройка Sumoima' });
  if ((await dlg.count()) === 0) return;
  await dlg.getByRole('button', { name: 'Пропустить, настрою сам' }).click();
  await expect(dlg).toBeHidden();
}

/**
 * Окно «Установить Sumoima на экран телефона» появляется через ~1,5 с после входа (только на телефоне) и перекрывает экран.
 * Дождаться его и закрыть кнопкой «Не сейчас»; на ПК и если окно не появилось — ничего не делает.
 * Сценарий про само окно (25-install-prompt) этот помощник не вызывает.
 */
export async function dismissInstallPrompt(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  // уже закрывали (или установили) — окно не появится, ждать нечего
  const remembered = await page.evaluate(() => {
    try {
      return localStorage.getItem('finora.installPrompt.v1') !== null;
    } catch {
      return false;
    }
  });
  if (remembered) return;
  const dlg = page.getByRole('dialog', { name: 'Установить Sumoima на экран телефона' });
  try {
    await dlg.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    return; // не появилось: уже закрывали, замок, приложение «установлено»
  }
  await dlg.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(dlg).toBeHidden();
}

export async function waitReady(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();
  await expect(page.getByText('Загрузка…')).toHaveCount(0);
}

/**
 * Дождаться, что сервис-воркер активен и УПРАВЛЯЕТ страницей (после первой установки нужна перезагрузка:
 * без неё страница воркером не управляется). Возвращает после перезагрузки.
 */
export async function activateServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('сервис-воркер не стал активным');
  });
  await page.reload();
  await waitReady(page);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { message: 'страница не под управлением сервис-воркера' })
    .toBe(true);
}

/* ------------------------------ навигация ------------------------------ */

export type Section =
  | 'Главная'
  | 'Операции'
  | 'Аналитика'
  | 'Кошельки'
  | 'Долги'
  | 'Бюджеты'
  | 'Платежи'
  | 'Покупки'
  | 'Курсы'
  | 'Погода'
  | 'Ещё'
  | 'Настройки';

/** Короткие имена в тестах → разделы реестра (src/app/sections.ts): название в меню и заголовок страницы там одно. */
const REGISTRY_ID: Partial<Record<Section, string>> = { Платежи: 'recurring', Курсы: 'rates' };

/** Название раздела (оно же заголовок h1 и название пункта меню). */
const SECTION_TITLE = (section: Section): string => {
  if (section === 'Ещё') return MORE_TITLE;
  const id = REGISTRY_ID[section];
  const found = SECTIONS.find((s) => (id ? s.id === id : s.title === section));
  if (!found) throw new Error(`Нет раздела «${section}» в реестре`);
  return found.title;
};

/** Пункты, которые есть в нижней панели телефона (из реестра); остальное на телефоне открывается через «Ещё». */
const PHONE_NAV: readonly string[] = [...SECTIONS.filter((s) => s.bottomBar).map((s) => s.title), MORE_TITLE];

/** Основная навигация (на ПК — боковая панель, на телефоне — нижняя). */
export const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Основная навигация' });

/**
 * Перейти в раздел через меню. ПК: пункт боковой панели. Телефон: пункт нижней панели (Главная, Операции, Аналитика, Ещё), а
 * остальное (Кошельки, Долги, Бюджеты, Платежи, Покупки, Курсы, Погода, Настройки) открывается в два шага: «Ещё», затем строка списка.
 */
export async function goSection(page: Page, section: Section): Promise<void> {
  const title = SECTION_TITLE(section);
  if (isPhone(page) && !PHONE_NAV.includes(title)) {
    await goSection(page, 'Ещё');
    await page.getByRole('main').getByRole('link', { name: title, exact: true }).click();
  } else {
    await mainNav(page).getByRole('link', { name: title, exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('Загрузка…')).toHaveCount(0);
}

/** Страница «Ещё» (только телефон) и её пункт по названию: Бюджеты, Регулярные платежи, Долги, Настройки. */
export async function openFromMore(page: Page, title: string): Promise<void> {
  await goSection(page, 'Ещё');
  await page.getByRole('main').getByRole('link', { name: title, exact: true }).click();
}

/** Экран «Категории»: Настройки → Категории (на телефоне «Настройки» лежат за «Ещё»). */
export async function openCategories(page: Page): Promise<void> {
  await goSection(page, 'Настройки');
  await page.getByRole('main').getByRole('link', { name: 'Категории', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
}

/** Окно с несохранённым вводом на «×», Esc и «назад» сначала спрашивает «Закрыть без сохранения?»: отвечаем «Закрыть». */
export async function confirmDiscard(page: Page): Promise<void> {
  const ask = page.getByRole('alertdialog', { name: 'Закрыть без сохранения?' });
  await expect(ask).toBeVisible();
  await ask.locator('button', { hasText: /^Закрыть$/ }).click();
  await expect(ask).toBeHidden();
}

/** Кнопка «+»: на телефоне — кругляш в нижней панели, на ПК — «Добавить операцию» в боковой панели. */
export function addLink(page: Page): Locator {
  const all = page.locator('a[href="#/add"]:visible');
  return isPhone(page) ? all.last() : all.first();
}

export const sheet = (page: Page, name: string | RegExp): Locator => page.getByRole('dialog', { name });

/* ------------------------------ внесение операции ------------------------------ */

/** Набрать сумму на экранной клавиатуре: '12,5' → 1, 2, «Запятая», 5. */
export async function tapAmount(page: Page, text: string): Promise<void> {
  const pad = page.getByRole('group', { name: 'Цифровая клавиатура' });
  for (const ch of text) {
    if (ch === ',' || ch === '.') await pad.getByRole('button', { name: 'Запятая' }).click();
    else await pad.getByRole('button', { name: ch, exact: true }).click();
  }
}

export interface TxInput {
  kind?: 'expense' | 'income' | 'transfer';
  amount: string;
  category?: string;
  note?: string;
  /** Кошелёк (расход/доход) или «откуда» (перевод): часть имени чипа. */
  wallet?: string;
  /** Перевод: «куда». */
  toWallet?: string;
  /** Перевод: сколько получено. Между валютами — поле «Получено»; в одной валюте разница со списанием вводится как комиссия. */
  received?: string;
  /** Операция в чужой валюте без курса: курс, который вводит человек. */
  rate?: string;
  /** Дата 'ГГГГ-ММ-ДД' (по умолчанию «Сегодня»). */
  date?: string;
}

/** Открыть шит «Новая операция» и заполнить его, не нажимая «Сохранить». */
/** В окне операции категории лежат за плиткой «Категория»: раскрыть список, если он закрыт; возвращает группу чипов. */
export async function openCategoryList(dlg: Locator): Promise<Locator> {
  const group = dlg.getByRole('group', { name: 'Категория' });
  if (!(await group.isVisible())) await dlg.getByRole('button', { name: /^Категория:/ }).click();
  await group.getByRole('button').first().waitFor();
  return group;
}

export async function fillTx(page: Page, tx: TxInput): Promise<Locator> {
  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  if (tx.kind === 'income') await dlg.getByRole('radio', { name: 'Доход' }).click();
  if (tx.kind === 'transfer') await dlg.getByRole('radio', { name: 'Перевод' }).click();
  if (tx.wallet) {
    await dlg.getByRole('button', { name: /^(Кошелёк|Откуда):/ }).click();
    await dlg.getByRole('group', { name: /^(Кошелёк|Откуда)$/ }).getByRole('button', { name: new RegExp(esc(tx.wallet)) }).click();
  }
  if (tx.toWallet) {
    await dlg.getByRole('button', { name: /^Куда:/ }).click();
    await dlg.getByRole('group', { name: 'Куда' }).getByRole('button', { name: new RegExp(esc(tx.toWallet)) }).click();
  }
  if (tx.date) {
    await dlg.getByRole('button', { name: /^Дата:/ }).click();
    await dlg.getByRole('group', { name: 'Дата' }).getByRole('button', { name: 'Другая дата' }).click();
    await dlg.getByLabel('Дата операции').fill(tx.date);
    // список даты раскрыт поверх формы: закрываем его, иначе он закрывает чипы категорий
    await dlg.getByRole('button', { name: 'Готово', exact: true }).click();
  }
  if (tx.category) {
    const group = await openCategoryList(dlg);
    await group.getByRole('button', { name: tx.category, exact: true }).click();
  }
  if (tx.rate) {
    // Курса не было — поле на месте. Курс уже вводили раньше — он подставлен сам, а поле прячется за «Изменить».
    const field = dlg.getByRole('textbox', { name: /^Курс:/ });
    const change = dlg.getByRole('button', { name: 'Изменить курс' });
    if ((await field.count()) === 0 && (await change.count()) > 0) await change.click();
    await field.fill(tx.rate);
  }
  await tapAmount(page, tx.amount);
  if (tx.received) {
    const received = dlg.getByRole('textbox', { name: /^Получено/ });
    if ((await received.count()) > 0) {
      await received.fill(tx.received);
    } else {
      // Одна валюта: комиссия = списано − получено, вводится кнопкой «%» → «Комиссия»
      const num = (t: string) => Number(t.replace(/[\s  ]/g, '').replace(',', '.'));
      await dlg.getByRole('button', { name: 'Комиссия', exact: true }).click();
      await dlg.getByRole('textbox', { name: /^Комиссия/ }).fill(String(Math.round((num(tx.amount) - num(tx.received)) * 100) / 100).replace('.', ','));
    }
  }
  if (tx.note) {
    await dlg.getByRole('button', { name: 'Заметка', exact: true }).click();
    await dlg.getByRole('textbox', { name: 'Заметка' }).fill(tx.note);
  }
  return dlg;
}

/** Напоминание «Новой операции», когда категория не выбрана. */
export const CATEGORY_NUDGE = 'Выберите категорию или оставьте без неё';

/**
 * «Сохранить» (или «Сохранить и добавить ещё») в «Новой операции». Без категории первое нажатие только напоминает о ней и
 * открывает список, второе — сохраняет: тесты, которым категория не важна, нажимают кнопку так, как сделал бы человек без неё.
 */
export async function saveNewTx(dlg: Locator, name = 'Сохранить'): Promise<void> {
  const button = dlg.getByRole('button', { name, exact: true });
  const nudge = dlg.getByText(CATEGORY_NUDGE);
  await button.click();
  // либо окно закрылось (сохранилось), либо появилось напоминание о категории
  await expect.poll(async () => (await nudge.isVisible()) || !(await dlg.isVisible()), { timeout: 5000 }).toBe(true);
  if (await nudge.isVisible()) {
    await dlg.page().waitForTimeout(450); // второе нажатие раньше ~350 мс — дрожание пальца, а не решение
    await button.click();
  }
}

/** Внести операцию целиком: заполнить, «Сохранить», дождаться закрытия шита. */
export async function addTx(page: Page, tx: TxInput): Promise<void> {
  const dlg = await fillTx(page, tx);
  await saveNewTx(dlg);
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Сохранено' }).first()).toBeVisible();
}

/* ------------------------------ кошельки ------------------------------ */

export interface WalletInput {
  name: string;
  /** Код валюты из списка: 'USD', 'TJS'… */
  currency?: string;
  /** Начальный остаток текстом: '100' или '12,5'. */
  opening?: string;
}

export async function createWallet(page: Page, w: WalletInput, opts: { verifyVisible?: boolean } = {}): Promise<void> {
  await goSection(page, 'Кошельки');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dlg = sheet(page, 'Новый кошелёк');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Название' }).fill(w.name);
  if (w.currency) await dlg.getByRole('combobox', { name: 'Валюта' }).selectOption(w.currency);
  if (w.opening) await dlg.getByRole('textbox', { name: /^Начальный остаток/ }).fill(w.opening);
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  if (opts.verifyVisible !== false) await expect(page.getByRole('list').getByText(w.name, { exact: true }).first()).toBeVisible();
}

/** Остаток кошелька на экране «Кошельки» (текст строки, пробелы нормализованы). */
export async function walletRowText(page: Page, name: string): Promise<string> {
  const row = page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) }).first();
  return norm(await row.innerText());
}

/* ------------------------------ сводка «Главной» ------------------------------ */

export const homeTotal = (page: Page): Locator => page.getByTestId('home-total');

/** Текст карточки «Всего» (нормализованный). */
export async function homeTotalText(page: Page): Promise<string> {
  return norm(await homeTotal(page).innerText());
}

/** Пояснения к итогу «Главной»: открывает окно по значку ⓘ, читает текст и закрывает его. */
export async function totalNotes(page: Page): Promise<string> {
  await homeTotal(page).getByRole('button', { name: 'Как посчитан итог' }).click();
  const dlg = sheet(page, 'Как посчитан итог');
  await expect(dlg).toBeVisible();
  const text = norm(await dlg.innerText());
  await dlg.getByRole('button', { name: 'Закрыть' }).click();
  await expect(dlg).toBeHidden();
  return text;
}

/**
 * Значение капсулы месяца в верхней карточке «Главной»: 'Доходы' (приход) или 'Расходы' (расход).
 * Прежнего «Итога месяца» с «Разницей» на «Главной» больше нет — эти цифры в «Аналитике».
 */
export async function monthRow(page: Page, label: 'Доходы' | 'Расходы'): Promise<string> {
  const testId = label === 'Доходы' ? 'home-flow-income' : 'home-flow-expense';
  return norm(await page.getByTestId(testId).innerText());
}

/** Карточка кошелька на «Главной» (виден список «Кошельки»). */
export function homeWallet(page: Page, name: string): Locator {
  return page.getByRole('region', { name: 'Кошельки' }).getByRole('listitem').filter({ hasText: name });
}

/** Подождать, пока тост «Сохранено» и т. п. исчезнет (чтобы не мешал нажимать на кнопки внизу). */
export async function dismissToasts(page: Page): Promise<void> {
  for (;;) {
    const close = page.getByRole('button', { name: 'Закрыть уведомление' }).first();
    if ((await close.count()) === 0) return;
    await close.click();
  }
}

/** Дата 'ГГГГ-ММ-ДД' по часам браузера (часовой пояс страницы): сдвиг в месяцах, день месяца задан. Для данных «в прошлых месяцах». */
export async function isoMonthsAgo(page: Page, months: number, day = 15): Promise<string> {
  return page.evaluate(
    ({ months, day }) => {
      const d = new Date();
      const t = new Date(d.getFullYear(), d.getMonth() - months, day);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
    },
    { months, day },
  );
}
