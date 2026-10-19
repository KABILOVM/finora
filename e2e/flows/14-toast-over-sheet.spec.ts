import type { Page } from '@playwright/test';
import { addLink, confirmDiscard, createWallet, dismissToasts, expect, openApp, shot, sheet, test } from '../helpers';

/**
 * E-3. Тост «Кошелёк добавлен» оставался внизу поверх открытого шита «Новая операция» и закрывал цифры «0», «,» и кнопки
 * «Сохранить». Теперь пока окно открыто, тост уезжает наверх. Проверка настоящая: в каждой точке каждой кнопки/поля окна
 * (elementFromPoint) должен быть сам элемент, а не тост.
 */

interface Covered {
  what: string;
  by: string;
}

/** Что из кнопок и полей открытого окна закрыто тостом (по центру и по четырём углам элемента, отступив на 3 px). */
async function coveredByToast(page: Page, text: string): Promise<{ checked: number; covered: Covered[]; toast: { top: number; bottom: number } | null }> {
  return page.evaluate((text) => {
    // role="status" есть и у значков «Только на устройстве» и т. п. — нужен именно тост с этим текстом
    const toastEl = Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).find((e) => (e.textContent ?? '').includes(text));
    const dialog = document.querySelector('[role="dialog"]');
    const out: { checked: number; covered: { what: string; by: string }[]; toast: { top: number; bottom: number } | null } = {
      checked: 0,
      covered: [],
      toast: null,
    };
    if (!toastEl || !dialog) return out;
    const t = toastEl.getBoundingClientRect();
    out.toast = { top: Math.round(t.top), bottom: Math.round(t.bottom) };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // элементы, уехавшие за край экрана или прокрутку окна, человек не видит — их не проверяем
      const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      if (!inView) continue;
      const points: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 3, r.top + 3],
        [r.right - 3, r.top + 3],
        [r.left + 3, r.bottom - 3],
        [r.right - 3, r.bottom - 3],
      ];
      out.checked++;
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && toastEl.parentElement?.contains(hit)) {
          const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName;
          out.covered.push({ what: `${el.tagName.toLowerCase()} «${label}»`, by: (hit.textContent ?? '').trim().slice(0, 30) });
          break;
        }
      }
    }
    return out;
  }, text);
}

/** Шит выезжает снизу и тост «всплывает» анимацией: меряем только после её конца, иначе кнопки ещё за краем экрана. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );

const SIZES: Record<string, { width: number; height: number }[]> = {
  // телефон: самый тесный из частых (iPhone SE / 8) и «как в проекте»
  iphone: [{ width: 375, height: 667 }, { width: 390, height: 664 }],
  // ПК: планшет, граница «lg» (там тост раньше перекрывал «Сохранить») и обычный экран
  desktop: [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }],
};

test('тост поверх открытого шита «Новая операция» не закрывает ни цифры, ни кнопки, ни поля', async ({ page }, testInfo) => {
  await openApp(page);
  const sizes = SIZES[testInfo.project.name] ?? SIZES['desktop']!;
  let n = 0;
  for (const size of sizes) {
    await page.setViewportSize(size);
    await dismissToasts(page);
    n++;
    await createWallet(page, { name: `Карта ${n}` });
    const toast = page.getByRole('status').filter({ hasText: 'Кошелёк добавлен' });
    await expect(toast, 'тост «Кошелёк добавлен» должен быть на экране до открытия шита').toBeVisible();

    // сразу открываем «+»: тост ещё живёт (4 секунды)
    await addLink(page).click();
    const dlg = sheet(page, 'Новая операция');
    await expect(dlg).toBeVisible();
    await expect(toast, 'тост ещё на экране — иначе проверка ничего не проверила бы').toBeVisible();

    await settled(page);
    // тост переехал наверх: он выше середины окна, а не лежит над «Сохранить»
    const r = await coveredByToast(page, 'Кошелёк добавлен');
    expect(r.checked, `в окне нашлось слишком мало кнопок и полей (${size.width}×${size.height})`).toBeGreaterThan(8);
    expect(r.covered, `тост закрывает элементы окна на ${size.width}×${size.height}`).toEqual([]);
    const box = await dlg.boundingBox();
    expect(r.toast!.bottom, `тост должен быть наверху (${size.width}×${size.height})`).toBeLessThan((box?.y ?? 0) + (box?.height ?? 0) / 3);
    await shot(page, `14-toast-over-sheet-${size.width}x${size.height}`, testInfo);

    // кнопки реально нажимаются сразу, без ожидания, пока тост исчезнет
    const zero = dlg.getByRole('group', { name: 'Цифровая клавиатура' }).getByRole('button', { name: '0', exact: true });
    await zero.click({ timeout: 1000 });
    await expect(dlg.getByRole('textbox', { name: /^Сумма/ })).toHaveValue('0');

    // закрыли окно — тост (если ещё жив) возвращается на своё обычное место внизу, а не остаётся наверху
    // (в окне уже набрана сумма — Esc сначала спрашивает «Закрыть без сохранения?»)
    await page.keyboard.press('Escape');
    await confirmDiscard(page);
    await expect(dlg).toBeHidden();
    const left = page.getByRole('status').filter({ hasText: 'Кошелёк добавлен' });
    if ((await left.count()) > 0) {
      const b = await left.first().boundingBox();
      expect(b!.y, 'после закрытия окна тост снова внизу').toBeGreaterThan(size.height / 2);
    }
  }
});

test('ошибка при открытом окне видна и не закрывает «Сохранить»', async ({ page }, testInfo) => {
  // все внешние адреса закрыты: «Обновить курсы» гарантированно даёт красный тост на 7 секунд (в любой среде)
  const own = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1').origin;
  await page.route((url) => url.origin !== own, (route) => route.abort());
  await openApp(page);
  await page.setViewportSize(SIZES[testInfo.project.name]?.[0] ?? { width: 1024, height: 768 });
  await createWallet(page, { name: 'Доллары', currency: 'USD' });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Обновить курсы' }).click();
  const err = page.getByRole('alert').filter({ hasText: 'Не удалось обновить курсы' });
  await expect(err).toBeVisible();

  await addLink(page).click();
  const dlg = sheet(page, 'Новая операция');
  await expect(dlg).toBeVisible();
  await expect(err, 'ошибку человек обязан увидеть и при открытом окне').toBeVisible();

  await settled(page);
  const overlap = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('[role="alert"]')).find((e) => (e.textContent ?? '').includes('Не удалось обновить курсы'));
    const save = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Сохранить');
    if (!a || !save) return null;
    const x = a.getBoundingClientRect();
    const s = save.getBoundingClientRect();
    return !(x.bottom <= s.top || x.top >= s.bottom || x.right <= s.left || x.left >= s.right);
  });
  expect(overlap, 'ошибка и «Сохранить» найдены').not.toBeNull();
  expect(overlap, 'красный тост лежит поверх «Сохранить»').toBe(false);
});
