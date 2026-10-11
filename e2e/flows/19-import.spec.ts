import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { makeBigCsv } from '../../src/import/__fixtures__/bigCsv';
import { expect, goSection, isPhone, money, norm, openApp, openFromMore, shot, test, walletRowText } from '../helpers';

const FIXTURES = join(process.cwd(), 'src', 'import', '__fixtures__');
const fixture = (name: string) => ({ name, mimeType: 'text/csv', buffer: readFileSync(join(FIXTURES, name)) });
const csvBuffer = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

const LOCAL_DB = 'finora-v1-10ca1de0-0000-4000-8000-000000000001';

/** Сколько операций лежит в локальной базе (живых и всего). Читаем базу напрямую: список «Операции» на тысячах строк тяжёл. */
async function countTx(page: Page): Promise<{ live: number; total: number }> {
  return page.evaluate(
    (name) =>
      new Promise<{ live: number; total: number }>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('transactions').objectStore('transactions').getAll();
          all.onsuccess = () => {
            const rows = all.result as { deletedAt: string | null }[];
            db.close();
            resolve({ live: rows.filter((r) => r.deletedAt === null).length, total: rows.length });
          };
          all.onerror = () => reject(all.error);
        };
      }),
    LOCAL_DB,
  );
}

const heading1 = (page: Page) => page.getByRole('heading', { level: 1, name: 'Импорт из Zenmoney' });
const count = (page: Page, id: string): Locator => page.getByTestId(`count-${id}`);
const report = (page: Page, id: string): Locator => page.getByTestId(`report-${id}`);
const fileInput = (page: Page): Locator => page.getByLabel('Файл Zenmoney');
const rateField = (page: Page, cur: string): Locator => page.getByRole('textbox', { name: new RegExp(`^Курс для пересчёта в TJS \\(${cur}\\)`) });
const walletSelect = (page: Page, account: string): Locator => page.getByRole('combobox', { name: `Кошелёк для счёта «${account}»` });
const selectedText = (select: Locator): Promise<string> => select.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');

async function openImport(page: Page): Promise<void> {
  await openFromMore(page, 'Импорт из Zenmoney');
  await expect(heading1(page)).toBeVisible();
}

/** Загрузить файл и дождаться предпросмотра. */
async function pick(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await fileInput(page).setInputFiles(file);
  await expect(page.getByRole('region', { name: 'Итоги разбора файла' })).toBeVisible();
}

async function confirmImport(page: Page, n: number): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^Импортировать ${n} операци`) }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Импортировать', exact: true }).click();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe('19. Импорт из Zenmoney (CSV)', () => {
  test('файл → предпросмотр → курс → подтверждение → итог; повторная загрузка ничего не меняет', async ({ page }, testInfo) => {
    await openApp(page);
    await openImport(page);

    // Шаг 1: инструкция, честная оговорка, приватность, подсказка про копию
    await expect(page.getByText('Как выгрузить из Zenmoney')).toBeVisible();
    await expect(page.getByText('Выгрузите операции в CSV на сайте или в приложении Zenmoney', { exact: false })).toBeVisible();
    await expect(page.getByText('Формат мы проверяли на образце', { exact: false })).toBeVisible();
    await expect(page.getByText('никуда не отправляется', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Настройки → Резервная копия' })).toBeVisible();
    await shot(page, '19-import-pick', testInfo);

    // Шаг 2: предпросмотр
    await pick(page, fixture('basic.csv'));
    await expect(count(page, 'add')).toHaveText('8');
    await expect(count(page, 'exists')).toHaveText('0');
    await expect(count(page, 'review')).toHaveText('4');
    await expect(count(page, 'skipped')).toHaveText('2');
    await expect(page.getByText('Ждут курса: 2 операции', { exact: false })).toBeVisible();

    // Без курса доллара операции в долларах не добавятся: поле пустое и подсвечено
    const usd = rateField(page, 'USD');
    await expect(usd).toHaveValue('');
    await expect(page.getByText('Укажите курс — без него 2 операции в USD не добавятся')).toBeVisible();
    await expect(page.getByText('Курс на дату операции неизвестен', { exact: false })).toBeVisible();
    await usd.fill('10,9');
    await expect(count(page, 'add')).toHaveText('10');
    await expect(page.getByText('Ждут курса', { exact: false })).toHaveCount(0);

    // Сопоставление счетов: «Наличные» найден среди своих, остальные создаются
    expect(await selectedText(walletSelect(page, 'Наличные'))).toBe('Наличные');
    expect(await selectedText(walletSelect(page, 'Карта Алиф'))).toBe('Создать новый кошелёк «Карта Алиф»');
    expect(await selectedText(walletSelect(page, 'Доллары'))).toBe('Создать новый кошелёк «Доллары»');

    // Категории: «Кафе» новая
    await expect(page.getByTestId('categories-summary')).toHaveText(/Найдено у вас: 6\. Будет создано: 1\./);

    // Первые операции и спорные строки с причинами
    await expect(page.getByRole('list', { name: 'Первые операции файла' }).getByRole('listitem')).toHaveCount(10);
    const review = page.getByRole('list', { name: 'Строки, которые нужно проверить' });
    await expect(review.getByRole('listitem')).toHaveCount(4);
    await expect(review).toContainText('Строка 15');
    await expect(review).toContainText('«1,000» неоднозначна');
    await expect(review).toContainText('нет в календаре: «2023-02-29»');
    await expect(page.getByText('Нулевая сумма: 1 строка')).toBeVisible();
    await expect(page.getByText('Нет даты: 1 строка')).toBeVisible();
    await shot(page, '19-import-preview', testInfo);
    expect(await noHorizontalScroll(page), 'предпросмотр не должен прокручиваться вбок').toBe(true);

    // Шаг 3: подтверждение
    await confirmImport(page, 10);

    // Шаг 4: итог
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible();
    await expect(report(page, 'added')).toHaveText('10');
    await expect(report(page, 'exists')).toHaveText('0');
    await expect(report(page, 'review')).toHaveText('4');
    await expect(report(page, 'skipped')).toHaveText('2');
    await expect(report(page, 'failed')).toHaveText('0');
    const reconcile = page.getByRole('list', { name: 'Остатки по файлу' });
    await expect(reconcile.getByRole('listitem')).toHaveCount(2);
    expect(norm(await reconcile.getByRole('listitem').filter({ hasText: 'Карта Алиф' }).innerText())).toMatch(money('Остаток по файлу 3 114,50 с.'));
    expect(norm(await reconcile.getByRole('listitem').filter({ hasText: 'Доллары' }).innerText())).toMatch(money('Остаток по файлу 85,50 $'));
    await expect(page.getByRole('link', { name: 'К операциям' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить ещё файл' })).toBeVisible();
    await shot(page, '19-import-done', testInfo);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await countTx(page)).toEqual({ live: 10, total: 10 });

    // Остатки кошельков = сумма движений; найденные «Наличные» получили свои операции
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Карта Алиф')).toMatch(money('3 114,50 с.'));
    expect(await walletRowText(page, 'Доллары')).toMatch(money('85,50 $'));
    expect(await walletRowText(page, 'Наличные')).toMatch(money('800 с.'));

    // Операции видны в списке за всё время
    await goSection(page, 'Операции');
    await page.getByRole('button', { name: 'Всё время' }).click();
    await expect(page.getByRole('region').getByRole('button').filter({ hasText: 'Корвон' })).toBeVisible();

    // Повторная загрузка того же файла: «уже есть», добавлять нечего, число операций не меняется
    await openImport(page);
    await pick(page, fixture('basic.csv'));
    await expect(count(page, 'add')).toHaveText('0');
    await expect(count(page, 'exists')).toHaveText('10');
    await expect(count(page, 'review')).toHaveText('4');
    await expect(rateField(page, 'USD')).toHaveCount(0); // курс не нужен: все операции уже есть
    expect(await selectedText(walletSelect(page, 'Карта Алиф'))).toBe('Карта Алиф');
    await expect(page.getByText('Кошелёк, созданный прошлым импортом', { exact: false }).first()).toBeVisible();
    const again = page.getByRole('button', { name: 'Нечего импортировать' });
    await expect(again).toBeDisabled();
    expect(await countTx(page)).toEqual({ live: 10, total: 10 });
    await shot(page, '19-import-again', testInfo);

    // Кошельки не задвоились
    await goSection(page, 'Кошельки');
    await expect(page.getByRole('listitem').filter({ has: page.getByText('Карта Алиф', { exact: true }) })).toHaveCount(1);
    await expect(page.getByRole('listitem').filter({ has: page.getByText('Доллары', { exact: true }) })).toHaveCount(1);
  });

  test('чужой файл: понятный отказ словами; файл с BOM, точкой с запятой и запятой в числах читается', async ({ page }, testInfo) => {
    await openApp(page);
    await openImport(page);

    await fileInput(page).setInputFiles(fixture('not-zenmoney.csv'));
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Не похоже на файл Zenmoney. Нашли столбцы: Имя, Телефон, Почта');
    await expect(page.getByRole('region', { name: 'Итоги разбора файла' })).toHaveCount(0);

    await fileInput(page).setInputFiles(csvBuffer('empty.csv', ''));
    await expect(page.getByRole('alert')).toContainText('Файл пустой');

    await pick(page, fixture('semicolon-ru.csv'));
    await expect(count(page, 'add')).toHaveText('4');
    await expect(count(page, 'review')).toHaveText('0');
    await expect(page.getByRole('textbox', { name: /^Курс/ })).toHaveCount(0); // всё в сомони — курс не нужен
    await confirmImport(page, 4);
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible();
    await expect(report(page, 'added')).toHaveText('4');
    await shot(page, '19-import-ru', testInfo);

    // 7,50 + 1 234,56 расходов, 1 500 дохода, перевод себе 300 на «Наличные» (найден) со «Карта Алиф» (создан)
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Карта Алиф')).toMatch(money('1 200 с.'));
    expect(await walletRowText(page, 'Наличные')).toMatch(money('−942,06 с.'));
  });

  test('двойное нажатие «Импортировать» не задваивает; в итоге ровно 10 операций', async ({ page }) => {
    await openApp(page);
    await openImport(page);
    await pick(page, fixture('basic.csv'));
    await rateField(page, 'USD').fill('10,9');
    await page.getByRole('button', { name: 'Импортировать 10 операций' }).click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Импортировать', exact: true });
    await confirm.dblclick({ force: true }).catch(() => undefined); // второй клик может прийти уже в пустоту: это и проверяем
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible();
    await expect(report(page, 'added')).toHaveText('10');
    expect(await countTx(page)).toEqual({ live: 10, total: 10 });
  });

  test('ручной выбор кошелька: счёт попадает в существующий кошелёк той же валюты', async ({ page }) => {
    await openApp(page);
    await openImport(page);
    await pick(page, fixture('semicolon-ru.csv'));
    // «Карта Алиф» → существующие «Наличные»? Нет: выбираем из подходящих (та же валюта TJS) — «Наличные»
    const select = walletSelect(page, 'Карта Алиф');
    await select.selectOption({ label: 'Наличные' });
    await expect(page.getByText('Выбран вами.')).toBeVisible();
    // Теперь оба счёта — один кошелёк, и перевод «себе» между ними невозможен: уходит в «Нужно проверить»
    await expect(count(page, 'add')).toHaveText('3');
    await expect(count(page, 'review')).toHaveText('1');
    await expect(page.getByRole('list', { name: 'Строки, которые нужно проверить' })).toContainText('сопоставлены с одним кошельком');
    await confirmImport(page, 3);
    await expect(report(page, 'added')).toHaveText('3');
    await goSection(page, 'Кошельки');
    await expect(page.getByRole('listitem').filter({ has: page.getByText('Карта Алиф', { exact: true }) })).toHaveCount(0);
    expect(await walletRowText(page, 'Наличные')).toMatch(money('257,94 с.'));
  });

  test('экран читается на телефоне и на ПК: ничего не обрезано, нет прокрутки вбок', async ({ page }, testInfo) => {
    await openApp(page);
    await openImport(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    await pick(page, fixture('basic.csv'));
    expect(await noHorizontalScroll(page)).toBe(true);
    // Кнопка внизу достижима и не перекрыта нижней панелью
    const button = page.getByRole('button', { name: /^Импортировать \d+ операци/ });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (isPhone(page)) {
      const nav = await page.getByRole('navigation', { name: 'Основная навигация' }).first().boundingBox();
      if (nav) expect(box!.y + box!.height, 'кнопка не должна быть под нижней панелью').toBeLessThanOrEqual(nav.y + 1);
    }
    await shot(page, '19-import-bottom', testInfo);
  });
  test('большой файл (4 000 строк): остановка кнопкой, продолжение без дублей, замер скорости', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const big = csvBuffer('big.csv', makeBigCsv(4000));
    await openApp(page);
    await openImport(page);
    await pick(page, big);
    const total = Number(await count(page, 'add').innerText());
    expect(total).toBeGreaterThan(3900);

    await confirmImport(page, total);
    const bar = page.getByRole('progressbar', { name: 'Ход импорта' });
    await expect(bar).toBeVisible();
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Остановить импорт' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт остановлен' })).toBeVisible({ timeout: 60_000 });
    const first = Number(await report(page, 'added').innerText());
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(total);
    expect(await countTx(page)).toEqual({ live: first, total: first });
    await shot(page, '19-import-stopped', testInfo);

    // Продолжение: добавленное не повторяется, дописывается остальное
    await page.getByRole('button', { name: 'Загрузить ещё файл' }).click();
    await pick(page, big);
    await expect(count(page, 'exists')).toHaveText(String(first));
    await expect(count(page, 'add')).toHaveText(String(total - first));
    const t0 = Date.now();
    await confirmImport(page, total - first);
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible({ timeout: 180_000 });
    const ms = Date.now() - t0;
    testInfo.annotations.push({ type: 'скорость записи', description: `${total - first} операций за ${ms} мс` });
    await expect(report(page, 'added')).toHaveText(String(total - first));
    await expect(report(page, 'failed')).toHaveText('0');
    expect(await countTx(page)).toEqual({ live: total, total });

    // Третья загрузка: всё уже есть
    await page.getByRole('button', { name: 'Загрузить ещё файл' }).click();
    await pick(page, big);
    await expect(count(page, 'add')).toHaveText('0');
    await expect(count(page, 'exists')).toHaveText(String(total));
    expect(await countTx(page)).toEqual({ live: total, total });
  });

  test('уход с экрана во время записи останавливает её на границе порции; запись продолжается при новой загрузке', async ({ page }) => {
    test.setTimeout(240_000);
    const big = csvBuffer('big2.csv', makeBigCsv(3000, 11));
    await openApp(page);
    await openImport(page);
    await pick(page, big);
    const total = Number(await count(page, 'add').innerText());
    await confirmImport(page, total);
    const bar = page.getByRole('progressbar', { name: 'Ход импорта' });
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 60_000 }).toBeGreaterThan(0);
    await goSection(page, 'Кошельки'); // экран закрыт посреди записи

    // Запись остановилась (число операций перестало расти) и не дошла до конца
    let last = -1;
    await expect
      .poll(async () => {
        const now = (await countTx(page)).live;
        const stable = now === last;
        last = now;
        return stable;
      }, { timeout: 30_000, intervals: [1500] })
      .toBe(true);
    const part = (await countTx(page)).live;
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(total);

    await openImport(page);
    await pick(page, big);
    await expect(count(page, 'exists')).toHaveText(String(part));
    await confirmImport(page, total - part);
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт завершён' })).toBeVisible({ timeout: 180_000 });
    expect(await countTx(page)).toEqual({ live: total, total });
  });
});
