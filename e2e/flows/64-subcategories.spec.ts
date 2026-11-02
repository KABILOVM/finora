import { addTx, confirmDiscard, dismissToasts, expect, fillTx, goSection, openApp, openCategories, openCategoryList, saveNewTx, shot, sheet, test } from '../helpers';
import type { Page } from '@playwright/test';

/** Названия строк списка «Категории» сверху вниз. */
const categoryRows = (page: Page) => page.getByRole('main').getByRole('list').first().getByRole('listitem').allTextContents();

const rows = (page: Page) => page.getByRole('region').getByRole('button');

test.describe('64. Подкатегории', () => {
  test('родитель и подкатегории: создание, порядок в списке, операция в подкатегорию, фильтр по родителю, архив вместе с детьми', async ({ page }, testInfo) => {
    await openApp(page);
    await openCategories(page);

    // Родитель — обычная категория
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    let dlg = sheet(page, 'Новая категория расходов');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Коммунальные услуги');
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // «Вода» — из окна родителя: «Добавить подкатегорию», родитель уже выбран
    await page.getByRole('button', { name: /^Коммунальные услуги/ }).click();
    dlg = sheet(page, 'Правка категории');
    await dlg.getByRole('button', { name: 'Добавить подкатегорию' }).click();
    dlg = sheet(page, 'Новая подкатегория');
    await expect(dlg.getByRole('button', { name: 'Входит в: Коммунальные услуги' })).toBeVisible();
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Вода');
    await dlg.getByRole('button', { name: 'Вода', exact: true }).click(); // значок «Вода»
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // «Свет» — обычным «Добавить», родитель выбирается в списке «Входит в»
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    dlg = sheet(page, 'Новая категория расходов');
    await dlg.getByRole('textbox', { name: 'Название' }).fill('Свет');
    await dlg.getByRole('button', { name: /^Входит в: / }).click();
    await dlg.getByRole('option', { name: 'Коммунальные услуги' }).click();
    await dlg.getByRole('button', { name: 'Электричество', exact: true }).click();
    await dlg.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dlg).toBeHidden();
    await dismissToasts(page);

    // В списке: родитель, сразу под ним «Вода» и «Свет»
    await expect.poll(async () => (await categoryRows(page)).filter((t) => ['Коммунальные услуги', 'Вода', 'Свет'].includes(t.trim()))).toEqual(['Коммунальные услуги', 'Вода', 'Свет']);
    const all = (await categoryRows(page)).map((t) => t.trim());
    expect(all.indexOf('Вода')).toBe(all.indexOf('Коммунальные услуги') + 1);
    expect(all.indexOf('Свет')).toBe(all.indexOf('Коммунальные услуги') + 2);
    await shot(page, '64-subcategories-list', testInfo);

    // Операция в подкатегорию «Вода»: в сетке одни родители («Коммунальные услуги» с «2 ›»), подкатегории открываются по нажатию
    const add = await fillTx(page, { amount: '30' });
    const group = await openCategoryList(add);
    await expect(group.getByRole('button', { name: 'Вода', exact: true })).toHaveCount(0);
    await group.getByRole('button', { name: /^Коммунальные услуги/ }).click();
    await expect(add.getByRole('button', { name: 'Назад к категориям' })).toContainText('Коммунальные услуги');
    await shot(page, '64-subcategories-panel', testInfo);
    await group.getByRole('button', { name: 'Вода', exact: true }).click();
    await expect(add.getByRole('button', { name: 'Категория: Вода' })).toBeVisible();
    // заметку — после категории, как в хелпере: иначе плитка категории уезжает под закреплённую кнопку «Сохранить»
    await add.getByRole('button', { name: 'Заметка', exact: true }).click();
    await add.getByRole('textbox', { name: 'Заметка' }).fill('вода за октябрь');
    await saveNewTx(add);
    await expect(add).toBeHidden();
    await dismissToasts(page);

    // Поиск находит подкатегорию прямо из списка: «свет» → «Свет» с подписью родителя, выбор — одним касанием
    const found = await fillTx(page, { amount: '5' });
    const foundGroup = await openCategoryList(found);
    await found.getByRole('searchbox', { name: 'Поиск категории' }).fill('свет');
    const light = foundGroup.getByRole('button', { name: /Свет/ });
    await expect(light).toContainText('Коммунальные услуги');
    await light.click();
    await expect(found.getByRole('button', { name: 'Категория: Свет' })).toBeVisible();
    await page.keyboard.press('Escape');
    await confirmDiscard(page);
    await expect(found).toBeHidden();
    await addTx(page, { amount: '10', category: 'Еда', note: 'обед' });
    await dismissToasts(page);

    // Фильтр по родителю показывает и операции подкатегорий, по «Еде» — только еду, по подкатегории — только её
    await goSection(page, 'Операции');
    await expect(rows(page)).toHaveCount(2);
    const filterBy = async (label: string) => {
      await page.getByRole('button', { name: /^Фильтры/ }).click();
      const f = sheet(page, 'Фильтры');
      await f.getByRole('combobox', { name: 'Категория' }).selectOption({ label });
      await f.getByRole('button', { name: 'Применить' }).click();
      await expect(f).toBeHidden();
    };
    await filterBy('Коммунальные услуги');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('вода за октябрь')).toBeVisible();
    await filterBy('Коммунальные услуги › Вода');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('вода за октябрь')).toBeVisible();
    await filterBy('Коммунальные услуги › Свет');
    await expect(rows(page)).toHaveCount(0);
    await filterBy('Еда');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('обед')).toBeVisible();

    // Архив родителя уводит и подкатегории; подтверждение называет их
    await openCategories(page);
    await page.getByRole('button', { name: /^Коммунальные услуги/ }).click();
    dlg = sheet(page, 'Правка категории');
    await expect(dlg.getByRole('button', { name: /^Входит в: / })).toHaveCount(0); // у родителя с детьми этого поля нет
    await dlg.getByRole('button', { name: 'Убрать в архив' }).click();
    const confirm = page.getByRole('alertdialog', { name: /Убрать «Коммунальные услуги» в архив/ });
    await expect(confirm).toContainText('Вместе с ней в архив уйдут подкатегории (2)');
    await confirm.getByRole('button', { name: 'В архив' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: /^Коммунальные услуги/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Вода/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Архив · 3 категории/ })).toBeVisible();
  });
});
