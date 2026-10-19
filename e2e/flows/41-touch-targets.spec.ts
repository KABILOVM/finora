import type { Locator } from '@playwright/test';
import { addLink, expect, goSection, openApp, sheet, test } from '../helpers';

/**
 * Область касания не меньше 44×44 px: проверяем не размер картинки, а то, куда «попадает» палец. Берём точки в 21 px от центра
 * элемента по горизонтали и вертикали и смотрим, что нажатие в них достаётся самому элементу (значки с невидимой областью .tap-44
 * меньше 44 px на вид, но принимают касание шире).
 */
async function hitMisses(loc: Locator): Promise<string[]> {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const misses: string[] = [];
    for (const dx of [-21, 0, 21]) {
      for (const dy of [-21, 0, 21]) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) misses.push(`${dx},${dy}`);
      }
    }
    return misses;
  });
}

const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
];

async function expectTapTarget(loc: Locator, what: string, size: { width: number; height: number }) {
  await loc.scrollIntoViewIfNeeded();
  expect(await hitMisses(loc), `${what} на ${size.width}×${size.height}: касание в 21 px от центра достаётся не ему`).toEqual([]);
}

test.describe('41. Области касания ≥ 44 px', () => {
  test('«Главная»: глаз «Скрыть суммы» и «Как посчитан итог» принимают касание в 44×44', async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openApp(page);
      await goSection(page, 'Главная');
      const eye = page.getByRole('button', { name: /^(Скрыть|Показать) суммы$/ });
      await expectTapTarget(eye, 'глаз', size);
      const info = page.getByRole('button', { name: 'Как посчитан итог' });
      if ((await info.count()) > 0) await expectTapTarget(info, 'значок ⓘ', size);
    }
  });

  test('«Новая операция»: «Комиссия», «Заметка», дата и знаки калькулятора', async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openApp(page);
      await addLink(page).click();
      const dlg = sheet(page, 'Новая операция');
      await expect(dlg).toBeVisible();
      await expectTapTarget(dlg.getByRole('button', { name: 'Заметка', exact: true }), '«Заметка»', size);
      await expectTapTarget(dlg.getByRole('button', { name: 'Комиссия', exact: true }), '«Комиссия» (%)', size);
      await expectTapTarget(dlg.getByRole('button', { name: /^Дата:/ }), 'дата', size);

      // знаки калькулятора: на высоких экранах 44 px, в низких окнах (≤ 700 px) не ниже 40
      const ops = dlg.locator('[data-op]');
      const count = await ops.count();
      expect(count, 'знаки калькулятора не найдены').toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await ops.nth(i).boundingBox();
        expect(box?.height ?? 0, `знак №${i + 1} на ${size.width}×${size.height}`).toBeGreaterThanOrEqual(size.height <= 700 ? 40 : 44);
      }
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
    }
  });
});
