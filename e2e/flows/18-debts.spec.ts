import type { Locator, Page } from '@playwright/test';
import {
  activateServiceWorker, addTx, createWallet, dismissToasts, expect, goSection, homeTotalText, isPhone, money, monthRow, moneyExact, norm,
  openApp, shot, sheet, tapAmount, test, waitReady, walletRowText,
} from '../helpers';

/**
 * «Сегодня» на странице закреплено: 15 октября 2026 (14:00 в Душанбе). Даты долгов и сроки отсюда считаются точно.
 */
const NOW = new Date('2026-10-15T09:00:00Z');

async function pinClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
}

const debtLink = (page: Page, name: string): Locator => page.getByRole('link', { name: new RegExp(`^${name}`) });

async function eraseAmount(dlg: Locator, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await dlg.getByRole('button', { name: 'Стереть' }).click();
}

interface NewDebt {
  name: string;
  amount: string;
  /** Я взял в долг (по умолчанию — я дал). */
  borrowed?: boolean;
  /** Без движения денег (долг «на бумаге»). */
  paper?: boolean;
  /** Дата долга 'ГГГГ-ММ-ДД' (по умолчанию «Сегодня»). */
  date?: string;
  /** Срок возврата 'ГГГГ-ММ-ДД'. */
  due?: string;
  note?: string;
  currency?: string;
}

/** Открыть «Новый долг», заполнить и нажать «Сохранить». Экран «Долги» уже открыт. */
async function addDebt(page: Page, d: NewDebt): Promise<void> {
  await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
  const dlg = sheet(page, 'Новый долг');
  await expect(dlg).toBeVisible();
  if (d.borrowed) await dlg.getByRole('radio', { name: 'Я взял в долг' }).click();
  await dlg.getByRole('textbox', { name: d.borrowed ? 'У кого я взял' : 'Кому я дал' }).fill(d.name);
  if (d.currency) await dlg.getByRole('combobox', { name: 'Валюта' }).selectOption(d.currency);
  await tapAmount(page, d.amount);
  if (d.date) {
    await dlg.getByRole('group', { name: 'Дата долга' }).getByRole('button', { name: 'Другая дата' }).click();
    await dlg.getByLabel('Дата долга: календарь').fill(d.date);
  }
  if (d.due) {
    await dlg.getByRole('group', { name: 'Срок возврата' }).getByRole('button', { name: 'Указать срок' }).click();
    await dlg.getByLabel('Срок возврата: календарь').fill(d.due);
  }
  if (d.note) await dlg.getByRole('textbox', { name: 'Заметка' }).fill(d.note);
  if (d.paper) await dlg.getByRole('checkbox', { name: 'Записать движение денег' }).uncheck();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

/** Платёж по открытому долгу. amount не задан — оставляем сумму по умолчанию (весь остаток). */
async function addPayment(page: Page, amount?: string, opts: { confirmOverpay?: boolean } = {}): Promise<void> {
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Платёж по долгу');
  await expect(dlg).toBeVisible();
  if (amount !== undefined) {
    const shown = (await dlg.getByRole('textbox', { name: /^Сумма платежа/ }).inputValue()).replace(/[^\d,]/g, '');
    await eraseAmount(dlg, shown.length);
    await tapAmount(page, amount);
  }
  if (opts.confirmOverpay) await dlg.getByRole('checkbox', { name: 'Это переплата — записать платёж полностью' }).check();
  await dlg.getByRole('button', { name: 'Записать платёж' }).click();
  await expect(dlg).toBeHidden();
  await dismissToasts(page);
}

const remaining = (page: Page): Locator => page.getByTestId('debt-remaining');

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: страница шире экрана`).toBeLessThanOrEqual(o.client);
}

test.describe('18. Долги и кредиты', () => {
  test('«Я дал Алишеру 500» с движением денег: кошелёк уменьшился, расходы месяца не выросли; частичный платёж; операции с меткой «Долг»', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('1 000 с.'));
    const expensesBefore = await monthRow(page, 'Расходы');
    const incomeBefore = await monthRow(page, 'Доходы');
    expect(expensesBefore).toMatch(moneyExact('0 с.'));
    await expect(page.getByTestId('attention-row')).toHaveCount(0); // долгов нет — строки «Требует внимания» нет

    // экран «Долги»: пустое состояние понятно
    await goSection(page, 'Долги');
    await expect(page.getByRole('heading', { level: 2, name: 'Вам пока никто не должен' })).toBeVisible();
    await shot(page, '18-debts-empty', testInfo);

    // «Новый долг»: по умолчанию «Записать движение денег» включено, кошелёк подставлен
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await expect(dlg.getByRole('checkbox', { name: 'Записать движение денег' })).toBeChecked();
    await expect(dlg.getByRole('group', { name: 'Кошелёк' }).getByRole('button', { name: /Наличные/ })).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Алишер');
    await tapAmount(page, '500');
    await shot(page, '18-debt-sheet', testInfo);
    // «Сохранить» и клавиатура помещаются в экран
    const vp = page.viewportSize()!;
    const saveBox = await dlg.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox();
    expect(saveBox, 'кнопка «Сохранить» видна').not.toBeNull();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(vp.height);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    const row = debtLink(page, 'Алишер');
    await expect(row).toContainText(money('500 с.'));
    await expect(row).toContainText('Возвращено 0%');
    await expect(page.getByTestId('debts-totals')).toContainText(money('500 с.'));
    await shot(page, '18-debts-list', testInfo);

    // кошелёк уменьшился на 500, «Всего» тоже; расходы и доходы месяца — те же
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('500 с.'));
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('500 с.'));
    expect(await monthRow(page, 'Расходы')).toBe(expensesBefore);
    expect(await monthRow(page, 'Доходы')).toBe(incomeBefore);
    await expect(page.getByTestId('attention-row')).toHaveCount(0); // долг не просрочен — на «Главной» о нём тишина
    await shot(page, '18-home-widget', testInfo);

    // в журнале операций выдача несёт метку «Долг: Алишер» и не выглядит как «Без категории»
    await goSection(page, 'Операции');
    const issueRow = page.getByRole('button', { name: /Долг: Алишер/ });
    await expect(issueRow).toHaveCount(1);
    await expect(issueRow).not.toContainText('Без категории');
    await shot(page, '18-transactions-tag', testInfo);

    // страница долга и частичный платёж 200 (сумма по умолчанию — весь остаток 500)
    await goSection(page, 'Долги');
    await debtLink(page, 'Алишер').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();
    await expect(remaining(page)).toContainText(money('500 с.'));
    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    const pay = sheet(page, 'Платёж по долгу');
    await expect(pay.getByRole('textbox', { name: /^Сумма платежа/ })).toHaveValue('500');
    await shot(page, '18-payment-sheet', testInfo);
    await pay.getByRole('button', { name: 'Закрыть' }).click();
    await addPayment(page, '200');
    await expect(remaining(page)).toContainText(money('300 с.'));
    await expect(page.getByRole('list', { name: 'Платежи по долгу' })).toContainText(money('200 с.'));
    await expect(page.getByTestId('debt-summary')).toContainText('Возвращено 40%');
    await shot(page, '18-debt-detail', testInfo);

    // кошелёк: 1000 − 500 + 200 = 700; расходы и доходы месяца по-прежнему не тронуты
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('700 с.'));
    await goSection(page, 'Главная');
    expect(await homeTotalText(page)).toMatch(money('700 с.'));
    expect(await monthRow(page, 'Расходы')).toBe(expensesBefore);
    expect(await monthRow(page, 'Доходы')).toBe(incomeBefore);

    // после перезагрузки всё на месте
    await page.reload();
    await waitReady(page);
    expect(await homeTotalText(page)).toMatch(money('700 с.'));
  });

  test('просрочка красным и словами; закрыть и открыть снова; удалить платёж и вернуть; «Закрытые» свёрнуты', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    // долг выдан 1 октября, срок 12-го: сегодня 15-е — просрочен на 3 дня
    await addDebt(page, { name: 'Бобур', amount: '300', date: '2026-10-01', due: '2026-10-12', note: 'на ремонт' });
    await addDebt(page, { name: 'Сардор', amount: '100', due: '2026-10-20' });

    const late = debtLink(page, 'Бобур');
    await expect(late).toContainText('Просрочен на 3 дня (срок был 12.10.2026)');
    await expect(debtLink(page, 'Сардор')).toContainText('Срок 20.10.2026 · через 5 дней');
    await expect(page.getByTestId('debts-totals')).toContainText('Просрочено: 1 долг');
    expect(await late.locator('.text-danger').count(), 'просрочка выделена красным').toBeGreaterThan(0);
    await shot(page, '18-debts-overdue', testInfo);
    // просроченный стоит первым
    await expect(page.getByRole('list', { name: 'Мне должны' }).getByRole('link').first()).toContainText('Бобур');

    // «Главная»: просрочка попала в строку «Требует внимания»
    await goSection(page, 'Главная');
    const next = page.getByTestId('attention-row').getByRole('link', { name: /Долг просрочен: Бобур/ });
    await expect(next).toBeVisible();
    await shot(page, '18-home-overdue', testInfo);
    await next.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Бобур' })).toBeVisible();
    await expect(page.getByTestId('debt-summary')).toContainText('Просрочен на 3 дня');
    await expect(page.getByTestId('debt-summary')).toContainText('на ремонт');

    // платёж 100 → удалить → остаток вернулся → «Отменить» возвращает платёж
    await addPayment(page, '100');
    await expect(remaining(page)).toContainText(money('200 с.'));
    await page.getByRole('button', { name: /^Удалить платёж/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Удалить платёж?' });
    await expect(confirm).toContainText('остаток долга и остаток кошелька пересчитаются');
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(remaining(page)).toContainText(money('300 с.'));
    await expect(page.getByText('Платежей пока нет')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(remaining(page)).toContainText(money('200 с.'));
    await dismissToasts(page);

    // закрыть долг: остаток не обнуляется, но долг уходит из итогов и с «Главной»
    await page.getByRole('button', { name: 'Закрыть долг', exact: true }).click();
    const closeDlg = page.getByRole('alertdialog', { name: 'Закрыть долг?' });
    await expect(closeDlg).toContainText(money('Остаток 200 с.'));
    await closeDlg.getByRole('button', { name: 'Закрыть долг', exact: true }).click();
    await expect(page.getByTestId('debt-summary')).toContainText('Закрыт');
    await expect(remaining(page)).toContainText(money('200 с.'));
    await dismissToasts(page);
    await page.getByRole('link', { name: 'Все долги' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Долги и кредиты' })).toBeVisible();
    await expect(debtLink(page, 'Бобур')).toHaveCount(0);
    const fold = page.getByRole('button', { name: 'Закрытые · 1' });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('debts-totals')).not.toContainText('Просрочено');
    await fold.click();
    await expect(debtLink(page, 'Бобур')).toContainText('Закрыт');
    await shot(page, '18-debts-closed', testInfo);
    await goSection(page, 'Главная');
    await expect(page.getByTestId('attention-row')).toHaveCount(0); // закрытый долг строку «Требует внимания» не вызывает

    // открыть снова
    await goSection(page, 'Долги');
    await page.getByRole('button', { name: 'Закрытые · 1' }).click();
    await debtLink(page, 'Бобур').click();
    await page.getByRole('button', { name: 'Открыть снова', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Закрыть долг', exact: true })).toBeVisible();
    await dismissToasts(page);
    await page.getByRole('link', { name: 'Все долги' }).click();
    await expect(debtLink(page, 'Бобур')).toContainText('Просрочен на 3 дня');
  });

  test('«Я должен»: получение — доход на кошелёк, платёж — расход; больше остатка только с «Это переплата»; долг «на бумаге»', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Долги');
    await page.getByRole('radio', { name: 'Я должен' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Вы никому не должны' })).toBeVisible();
    await addDebt(page, { name: 'Банк', amount: '1000', borrowed: true });
    await expect(page.getByRole('radio', { name: 'Я должен' })).toHaveAttribute('aria-checked', 'true');
    await expect(debtLink(page, 'Банк')).toContainText(money('1 000 с.'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('1 000 с.'));

    await goSection(page, 'Долги');
    await page.getByRole('radio', { name: 'Я должен' }).click();
    await debtLink(page, 'Банк').click();
    await expect(page.getByTestId('debt-summary')).toContainText('Вы ещё должны');
    // платёж 1200 при остатке 1000: без подтверждения не пройдёт
    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    const pay = sheet(page, 'Платёж по долгу');
    await eraseAmount(pay, 4);
    await tapAmount(page, '1200');
    await expect(pay.getByRole('group', { name: 'Переплата' })).toContainText(money('больше остатка на 200 с.'));
    await shot(page, '18-overpay', testInfo);
    await pay.getByRole('button', { name: 'Записать платёж' }).click();
    await expect(pay.getByRole('alert').filter({ hasText: 'Платёж больше остатка' })).toBeVisible();
    await pay.getByRole('checkbox', { name: 'Это переплата — записать платёж полностью' }).check();
    await pay.getByRole('button', { name: 'Записать платёж' }).click();
    await expect(pay).toBeHidden();
    await dismissToasts(page);
    await expect(remaining(page)).toContainText(moneyExact('0 с.'));
    await expect(page.getByTestId('debt-summary')).toContainText('Погашен');
    await expect(page.getByTestId('debt-summary')).toContainText(money('Переплата'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('−200 с.')); // 1000 получили − 1200 отдали

    // долг «на бумаге»: деньги не двигались
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Дилшод', amount: '50', paper: true });
    await debtLink(page, 'Дилшод').click();
    await expect(page.getByTestId('debt-summary')).toContainText('Деньги не двигались');
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('−200 с.'));
  });

  test('нет кошелька в валюте долга: долг «на бумаге» с пояснением; итог по каждой валюте отдельно', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Долги');
    await page.getByRole('button', { name: 'Новый долг', exact: true }).click();
    const dlg = sheet(page, 'Новый долг');
    await dlg.getByRole('combobox', { name: 'Валюта' }).selectOption('USD');
    const note = dlg.getByTestId('debt-paper-note');
    await expect(note).toContainText('Нет кошелька в валюте USD');
    await expect(note).toContainText('на бумаге');
    await expect(dlg.getByRole('checkbox', { name: 'Записать движение денег' })).toBeDisabled();
    await shot(page, '18-paper-note', testInfo);
    await dlg.getByRole('textbox', { name: 'Кому я дал' }).fill('Джон');
    await tapAmount(page, '20');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    // итог каждой валюты отдельно
    await addDebt(page, { name: 'Алишер', amount: '500', paper: true });
    const totals = page.getByTestId('debts-totals');
    await expect(totals.getByRole('listitem')).toHaveCount(2);
    await expect(totals).toContainText(money('500 с.'));
    await expect(totals).toContainText(money('20 $'));
    await expect(totals).toContainText('Валюты не складываем');
  });

  test('офлайн: долг и платёж записываются без сети и переживают перезагрузку', async ({ page, context }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата' });
    await dismissToasts(page);
    await activateServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await waitReady(page);

    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер', amount: '500' });
    await debtLink(page, 'Алишер').click();
    await addPayment(page, '200');
    await expect(remaining(page)).toContainText(money('300 с.'));
    await shot(page, '18-offline-detail', testInfo);

    await page.reload();
    await waitReady(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Алишер' })).toBeVisible();
    await expect(remaining(page)).toContainText(money('300 с.'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('700 с.'));

    await context.setOffline(false);
    await goSection(page, 'Долги');
    await expect(debtLink(page, 'Алишер')).toContainText(money('300 с.'));
  });

  test('раскладка: длинное имя и огромные суммы не ломают экраны; шит помещается; нет горизонтальной прокрутки', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await addTx(page, { kind: 'income', amount: '9999999,99', category: 'Зарплата' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    const longName = 'Абдурахмонзода Саидмуродхон Нурмуҳаммадович-Рахимов';
    await addDebt(page, { name: longName, amount: '1234567,89', due: '2026-10-20' });
    await addDebt(page, { name: 'Сардор', amount: '5000000', borrowed: true });
    await page.getByRole('radio', { name: 'Мне должны' }).click();
    await shot(page, '18-layout-list', testInfo);
    await noHorizontalScroll(page, 'Долги');

    await debtLink(page, 'Абдурахмонзода').click();
    await expect(page.getByTestId('debt-summary')).toBeVisible();
    await noHorizontalScroll(page, 'Страница долга');
    await shot(page, '18-layout-detail', testInfo);
    const add = await page.getByRole('button', { name: 'Добавить платёж', exact: true }).boundingBox();
    expect(add, 'кнопка «Добавить платёж» видна').not.toBeNull();
    expect(add!.x + add!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    const pay = sheet(page, 'Платёж по долгу');
    await expect(pay).toBeVisible();
    // шит выезжает снизу с анимацией: ждём, пока кнопка встанет на место, и она обязана поместиться в экран
    const saveButton = pay.getByRole('button', { name: 'Записать платёж' });
    await expect
      .poll(async () => {
        const b = await saveButton.boundingBox();
        return b ? b.y + b.height : Infinity;
      }, { message: 'кнопка «Записать платёж» не помещается в экран' })
      .toBeLessThanOrEqual(page.viewportSize()!.height);
    await shot(page, isPhone(page) ? '18-layout-pay-phone' : '18-layout-pay-desktop', testInfo);
    await pay.getByRole('button', { name: 'Закрыть' }).click();

    await goSection(page, 'Главная');
    await expect(page.getByTestId('home-total')).toBeVisible();
    await noHorizontalScroll(page, 'Главная');
    await shot(page, '18-layout-home', testInfo);
    await goSection(page, 'Операции');
    await noHorizontalScroll(page, 'Операции');
    expect(norm(await page.locator('main').innerText())).toContain('Долг: ');
  });

  test('правка операции по долгу: связь сохраняется, чужая валюта кошелька не принимается понятной ошибкой', async ({ page, errors }, testInfo) => {
    // шит правки пишет в консоль отказ репозитория (ожидаемый здесь): только этот текст, больше ничего
    errors.allow(/Не удалось сохранить правку:.*не совпадает с валютой долга/s);
    await pinClock(page);
    await openApp(page);
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '100' });
    await addTx(page, { kind: 'income', amount: '1000', category: 'Зарплата', wallet: 'Наличные' });
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер', amount: '500' });

    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Долг: Алишер/ }).click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit).toBeVisible();
    await expect(edit.getByTestId('tx-link-notice')).toContainText('Эта операция относится к долгу «Алишер»');
    // другая валюта кошелька — ошибка репозитория словами, операция не меняется
    await edit.getByRole('button', { name: /^Кошелёк:/ }).click();
    await edit.getByRole('group', { name: 'Кошелёк' }).getByRole('button', { name: /Доллары/ }).click();
    await edit.getByRole('textbox', { name: /^Курс:/ }).fill('10,9'); // курса из сети в проверочной среде нет
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit.getByRole('alert').filter({ hasText: 'не совпадает с валютой долга' })).toBeVisible();
    await shot(page, '18-edit-currency-error', testInfo);
    // назад на «Наличные» и правка суммы: связь с долгом жива, остаток долга пересчитан
    await edit.getByRole('button', { name: /^Кошелёк:/ }).click();
    await edit.getByRole('group', { name: 'Кошелёк' }).getByRole('button', { name: /Наличные/ }).click();
    await eraseAmount(edit, 3);
    await tapAmount(page, '450');
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await debtLink(page, 'Алишер').click();
    // сумма долга 500, исходная операция теперь 450: остаток считается от суммы долга, а не от операции выдачи
    await expect(remaining(page)).toContainText(money('500 с.'));
    await expect(page.getByTestId('debt-summary')).toContainText(money('450 с.'));
  });

  test('правка платежа в журнале: «200» → «2000» не проходит молча, а спрашивает про переплату', async ({ page }, testInfo) => {
    await pinClock(page);
    await openApp(page);
    await goSection(page, 'Долги');
    await addDebt(page, { name: 'Алишер', amount: '500', paper: true });
    await debtLink(page, 'Алишер').click();
    await addPayment(page, '200');
    await expect(remaining(page)).toContainText(money('300 с.'));

    await goSection(page, 'Операции');
    await page.getByRole('button', { name: /Долг: Алишер/ }).click();
    const edit = sheet(page, 'Правка операции');
    await expect(edit).toBeVisible();
    await eraseAmount(edit, 3);
    await tapAmount(page, '2000');
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();

    // вопрос поверх шита: кнопки помещаются в экран, платёж пока не записан
    const ask = page.getByRole('alertdialog', { name: 'Платежи больше долга' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('переплата');
    await page.waitForTimeout(600);
    await shot(page, '18-edit-overpay-ask', testInfo);
    const vp = page.viewportSize()!;
    for (const name of ['Поправить сумму', 'Это переплата — сохранить']) {
      const box = await ask.getByRole('button', { name }).boundingBox();
      expect(box, `кнопка «${name}» отрисована`).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await noHorizontalScroll(page, 'вопрос о переплате');

    // «Поправить сумму»: шит остаётся, в базе прежние 200
    await ask.getByRole('button', { name: 'Поправить сумму' }).click();
    await expect(ask).toBeHidden();
    await expect(edit).toBeVisible();
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(ask).toBeVisible();

    // подтверждение: платёж записан, на странице долга видна переплата
    await ask.getByRole('button', { name: 'Это переплата — сохранить' }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await goSection(page, 'Долги');
    await debtLink(page, 'Алишер').click();
    await expect(page.getByTestId('debt-summary')).toContainText('Переплата');
    await expect(page.getByTestId('debt-summary')).toContainText(money('1 500 с.'));
  });
});
