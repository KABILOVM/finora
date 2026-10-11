import type { Page } from '@playwright/test';
import {
  activateServiceWorker, createWallet, dismissToasts, expect, goSection, money, norm, openApp, sheet, shot, test, waitReady, walletRowText,
} from '../helpers';

/* ---------------------------------------------------------------------------------------------
 * 17. Регулярные платежи: создание, «Провести», «Пропустить», автопроведение, виджет на «Главной», офлайн.
 * ------------------------------------------------------------------------------------------- */

/** Дата 'ГГГГ-ММ-ДД' по часовому поясу проекта (Asia/Dushanbe, без перехода на летнее время), сдвиг в днях от настоящего момента. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Dushanbe' });

interface RuleInput {
  amount: string;
  note: string;
  category?: string;
  /** Часть названия чипа кошелька. */
  wallet?: string;
  /** 'ГГГГ-ММ-ДД'; по умолчанию сегодня. */
  start?: string;
  auto?: boolean;
  frequency?: 'День' | 'Неделя' | 'Месяц' | 'Год';
}

/** Открыть «Платежи», создать правило через окно и дождаться закрытия окна. */
async function addRule(page: Page, r: RuleInput): Promise<void> {
  await goSection(page, 'Платежи');
  await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
  const dlg = sheet(page, 'Новый регулярный платёж');
  await expect(dlg).toBeVisible();
  if (r.wallet) await dlg.getByRole('group', { name: 'Кошелёк' }).getByRole('button', { name: new RegExp(r.wallet) }).click();
  await dlg.getByRole('textbox', { name: /^Сумма/ }).fill(r.amount);
  if (r.category) {
    const group = dlg.getByRole('group', { name: 'Категория' });
    const chip = group.getByRole('button', { name: r.category, exact: true });
    await group.getByRole('button').first().waitFor();
    // видны только самые частые категории: остальные под кнопкой «Ещё N»
    if ((await chip.count()) === 0) await group.getByRole('button', { name: /^Ещё/ }).click();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  }
  await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill(r.note);
  if (r.frequency) await dlg.getByRole('group', { name: 'Периодичность' }).getByRole('button', { name: r.frequency, exact: true }).click();
  if (r.start) await dlg.getByLabel('Первый платёж').fill(r.start);
  if (r.auto) await dlg.getByRole('switch', { name: 'Проводить само' }).click();
  await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dlg).toBeHidden();
}

/** Окна выезжают снизу ~200 мс: снимок экрана делаем, когда они встали на место. */
const settle = (page: Page) => page.waitForTimeout(500);

/** Все операции за всё время (строки списка). */
async function allOps(page: Page) {
  await goSection(page, 'Операции');
  // операций нет совсем — фильтров нет, есть пустое состояние
  const allTime = page.getByRole('button', { name: 'Всё время' });
  await expect(allTime.or(page.getByText('Операций пока нет'))).toBeVisible();
  if (await allTime.isVisible()) await allTime.click();
  return page.getByRole('region').getByRole('button');
}

test.describe('17. Регулярные платежи', () => {
  test('аренда на сегодня без автопроведения: «Сегодня» → «Провести» → операция в «Операциях», остаток уменьшился', async ({ page }, testInfo) => {
    await openApp(page);
    await addRule(page, { amount: '500', note: 'аренда', category: 'Жильё' });

    // Платёж в «Сегодня» и в «Все правила», а не проведён сам
    await expect(page.getByRole('heading', { level: 2, name: 'Сегодня' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Все правила' })).toBeVisible();
    await expect(page.getByText('Каждый месяц, ', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Ждёт подтверждения')).toBeVisible();
    await settle(page);
    await shot(page, '17-page-today', testInfo);
    await dismissToasts(page);

    await page.getByRole('button', { name: /^Провести: аренда/ }).click();
    const dlg = sheet(page, 'Провести платёж');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue(/^500$/);
    await settle(page);
    await shot(page, '17-post-sheet', testInfo);
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж проведён: аренда' })).toBeVisible();
    await dismissToasts(page);
    // из «Сегодня» ушёл
    await expect(page.getByRole('button', { name: /^Провести: аренда/ })).toHaveCount(0);

    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    expect(norm(await ops.first().innerText())).toMatch(money('−500 с.'));
    await expect(page.getByText('аренда', { exact: false }).first()).toBeVisible();
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('−500 с.'));
  });

  test('сумму и заметку можно изменить до подтверждения; двойное нажатие «Провести» — одна операция', async ({ page }) => {
    await openApp(page);
    await addRule(page, { amount: '200', note: 'свет', category: 'Связь' });
    await dismissToasts(page);
    await page.getByRole('button', { name: /^Провести: свет/ }).click();
    const dlg = sheet(page, 'Провести платёж');
    await dlg.getByRole('textbox', { name: /^Сумма/ }).fill('187,5');
    await dlg.getByRole('textbox', { name: 'Заметка' }).fill('свет за сентябрь');
    await dlg.getByRole('button', { name: 'Провести', exact: true }).dblclick();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    expect(norm(await ops.first().innerText())).toMatch(money('−187,50 с.'));
    await expect(page.getByText('свет за сентябрь')).toBeVisible();
    // правило осталось прежним
    await goSection(page, 'Платежи');
    await expect(page.getByRole('button', { name: /^свет/ })).toContainText(money('−200 с.'));
  });

  test('автопроведение: правило на «вчера» создано три дня назад — после перезагрузки операция ОДНА, и после второй, и после третьей', async ({ page }, testInfo) => {
    const yesterday = day(-1);
    // Приложение «думает», что сейчас три дня назад: правило будет создано тогда (граница «историю не проводим» — день создания)
    await page.clock.install({ time: Date.now() - 3 * 86_400_000 });
    await openApp(page);
    await addRule(page, { amount: '300', note: 'абонемент', category: 'Здоровье', start: yesterday, auto: true });
    await dismissToasts(page);
    // «Сегодня» (по часам приложения) для этого платежа не наступило — он ждёт в «Скоро», проведён не был
    await expect(page.getByRole('heading', { level: 2, name: 'Скоро' })).toBeVisible();
    expect(await (await allOps(page)).count()).toBe(0);

    // возвращаем настоящее время и перезагружаем: вчерашний день уже прошёл, правило создано три дня назад
    await page.clock.setSystemTime(Date.now());
    await page.reload();
    await waitReady(page);
    await expect(page.getByRole('status').filter({ hasText: 'Проведено автоплатежей: 1' })).toBeVisible();
    await dismissToasts(page);

    for (let i = 0; i < 2; i++) {
      const ops = await allOps(page);
      await expect(ops, `операций после перезагрузки №${i + 1}`).toHaveCount(1);
      expect(norm(await ops.first().innerText())).toMatch(money('−300 с.'));
      await page.reload();
      await waitReady(page);
      // второго уведомления нет: проводить уже нечего
      await page.waitForTimeout(400);
      await expect(page.getByRole('status').filter({ hasText: 'Проведено автоплатежей' })).toHaveCount(0);
    }
    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Наличные')).toMatch(money('−300 с.'));
    await shot(page, '17-auto-posted', testInfo);
  });

  test('правило, созданное сегодня с автопроведением на сегодня: проводится сразу, а историю («вчера») не трогает', async ({ page }) => {
    await openApp(page);
    await addRule(page, { amount: '50', note: 'кофе', category: 'Еда', frequency: 'День', start: day(-1), auto: true });
    // сегодняшний день проведён сам (после сохранения), вчерашний остался в «Просроченных»
    await expect(page.getByRole('status').filter({ hasText: 'Проведено автоплатежей: 1' })).toBeVisible();
    await dismissToasts(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Просроченные' })).toBeVisible();
    await expect(page.getByText('Просрочено на 1 день')).toBeVisible();
    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    // вчерашний платёж подтверждается вручную
    await goSection(page, 'Платежи');
    await page.getByRole('button', { name: /^Провести: кофе, Вчера/ }).click();
    const dlg = sheet(page, 'Провести платёж');
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    await expect(await allOps(page)).toHaveCount(2);
  });

  test('«Пропустить»: с подтверждением, операции нет, в «Предстоящих» не возвращается даже после перезагрузки; «Вернуть» записывает платёж', async ({ page }, testInfo) => {
    await openApp(page);
    await addRule(page, { amount: '700', note: 'интернет', category: 'Связь' });
    await dismissToasts(page);

    await page.getByRole('button', { name: /^Пропустить: интернет/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Пропустить платёж?' });
    await expect(confirm).toBeVisible();
    await settle(page);
    await shot(page, '17-skip-dialog', testInfo);
    await confirm.getByRole('button', { name: 'Пропустить', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж пропущен: интернет' })).toBeVisible();
    await dismissToasts(page);
    await expect(page.getByRole('button', { name: /^Провести: интернет/ })).toHaveCount(0);

    await expect(await allOps(page)).toHaveCount(0);
    await page.reload();
    await waitReady(page);
    await goSection(page, 'Платежи');
    await expect(page.getByRole('button', { name: /^Провести: интернет/ })).toHaveCount(0);
    await expect(await allOps(page)).toHaveCount(0);

    // «Пропущенные» хранят его, «Вернуть» записывает в операции
    await goSection(page, 'Платежи');
    await page.getByRole('button', { name: /^Пропущенные · 1/ }).click();
    await settle(page);
    await shot(page, '17-skipped', testInfo);
    await page.getByRole('button', { name: /^Вернуть платёж: интернет/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж возвращён' })).toBeVisible();
    await dismissToasts(page);
    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    expect(norm(await ops.first().innerText())).toMatch(money('−700 с.'));
  });

  test('виджет «Ближайшие платежи» на «Главной»: «Провести» в одно касание, «Все платежи» ведёт на экран платежей', async ({ page }, testInfo) => {
    await openApp(page);
    await addRule(page, { amount: '120', note: 'подписка', category: 'Подписки' });
    await dismissToasts(page);
    await goSection(page, 'Главная');
    const widget = page.getByRole('region', { name: 'Ближайшие платежи' });
    await expect(widget).toBeVisible();
    await widget.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(widget).toContainText('подписка');
    await settle(page);
    await shot(page, '17-home-widget', testInfo);
    await widget.getByRole('button', { name: /^Провести: подписка/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Платёж проведён: подписка' })).toBeVisible();
    // платёж проведён — виджету показывать нечего, он исчезает
    await expect(page.getByRole('region', { name: 'Ближайшие платежи' })).toHaveCount(0);
    await dismissToasts(page);
    await expect(await allOps(page)).toHaveCount(1);
  });

  test('кошелёк в долларах и курса нет: автоплатёж не проводится, одно уведомление; вручную — с вводом курса', async ({ page }, testInfo) => {
    await openApp(page);
    await createWallet(page, { name: 'Доллары', currency: 'USD', opening: '100' });
    await addRule(page, { amount: '10', note: 'облако', category: 'Подписки', wallet: 'Доллары', auto: true });
    // курсов в проверочной среде нет: уведомление и пометка у платежа, операции нет
    // ошибка-уведомление — role=alert; курсы обновляются при открытии приложения, пока идёт обновление, «нет курса» не объявляется
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось провести автоплатёж: нет курса USD → TJS' })).toBeVisible({ timeout: 20_000 });
    await dismissToasts(page);
    await expect(page.getByText(/Не проведён сам: нет курса USD → TJS/).first()).toBeVisible();
    await settle(page);
    await shot(page, '17-no-rate', testInfo);
    await expect(await allOps(page)).toHaveCount(0);

    // вручную: окно просит курс и не даёт молчать
    await goSection(page, 'Платежи');
    await page.getByRole('button', { name: /^Провести: облако/ }).click();
    const dlg = sheet(page, 'Провести платёж');
    await expect(dlg.getByTestId('fx-notice')).toContainText('Введите курс сами');
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg.getByRole('alert')).toContainText('Курса пока нет');
    await dlg.getByRole('textbox', { name: /^Курс:/ }).fill('11');
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);
    const ops = await allOps(page);
    await expect(ops).toHaveCount(1);
    expect(norm(await ops.first().innerText())).toMatch(money('−10 $'));
    await goSection(page, 'Кошельки');
    expect(await walletRowText(page, 'Доллары')).toMatch(money('90 $'));
  });

  test('офлайн: страница платежей, создание правила и «Провести» работают без сети, данные переживают перезагрузку', async ({ page, context }, testInfo) => {
    await openApp(page);
    await activateServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await waitReady(page);

    await addRule(page, { amount: '90', note: 'газ', category: 'Жильё' });
    await dismissToasts(page);
    await page.getByRole('button', { name: /^Провести: газ/ }).click();
    const dlg = sheet(page, 'Провести платёж');
    await dlg.getByRole('button', { name: 'Провести', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await page.reload();
    await waitReady(page);
    await goSection(page, 'Платежи');
    await expect(page.getByRole('button', { name: /^газ/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Провести: газ/ })).toHaveCount(0);
    await expect(await allOps(page)).toHaveCount(1);
    await shot(page, '17-offline', testInfo);
    await context.setOffline(false);
  });

  test('правка и архив: расписание словами, предпросмотр дат, подсказка про 31-е, архив и возврат', async ({ page }, testInfo) => {
    await openApp(page);
    await goSection(page, 'Платежи');
    await page.getByRole('button', { name: 'Добавить платёж', exact: true }).click();
    const dlg = sheet(page, 'Новый регулярный платёж');
    await dlg.getByRole('textbox', { name: /^Сумма/ }).fill('1000');
    await dlg.getByRole('textbox', { name: 'Название или заметка' }).fill('кредит');
    await dlg.getByLabel('Первый платёж').fill('2027-01-31');
    await expect(dlg.getByText('В коротких месяцах платёж будет в последний день месяца')).toBeVisible();
    await expect(dlg.getByTestId('rule-preview')).toContainText('Ближайшие даты:');
    await settle(page);
    await shot(page, '17-rule-sheet', testInfo);
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    await expect(page.getByText('Каждый месяц, 31-го')).toBeVisible();
    await page.getByRole('button', { name: /^кредит/ }).click();
    const edit = sheet(page, 'Правка платежа');
    await edit.getByRole('button', { name: 'Убрать в архив' }).click();
    await page.getByRole('alertdialog', { name: 'Убрать платёж в архив?' }).getByRole('button', { name: 'В архив' }).click();
    await expect(edit).toBeHidden();
    await dismissToasts(page);
    await expect(page.getByText('Все платежи в архиве.')).toBeVisible();
    await page.getByRole('button', { name: /^В архиве · 1/ }).click();
    await page.getByRole('button', { name: 'Вернуть из архива: кредит' }).click();
    await expect(page.getByRole('button', { name: /^кредит/ })).toBeVisible();
  });
});
