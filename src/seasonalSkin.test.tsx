import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSkinId, resolveSkin, SEASONAL_SKIN, SKIN_BARS, SKIN_ICON_PACKS, seasonFor, skinBar } from './skinCore';
import { SKIN_GROUPS, SKINS } from './skins';
import { applySkin, readSkinPref, saveSkinPref } from './theme';

const reset = () => {
  vi.useRealTimers();
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
};
beforeEach(reset);
afterEach(reset);

const at = (month: number, day: number, year = 2026) => new Date(year, month - 1, day, 12);

describe('«Сезонные»: праздничный образ по дате', () => {
  it('ближайший праздник по кругу года: Новый год, 14 февраля, 8 марта, Навруз, День независимости, Хэллоуин', () => {
    expect(seasonFor(at(12, 25))).toBe('christmas');
    expect(seasonFor(at(1, 1))).toBe('christmas'); // через границу года
    expect(seasonFor(at(1, 10))).toBe('christmas');
    expect(seasonFor(at(1, 19))).toBe('christmas'); // 26 дней до 14 февраля, 25 после Нового года
    expect(seasonFor(at(1, 20))).toBe('valentine');
    expect(seasonFor(at(2, 14))).toBe('valentine');
    expect(seasonFor(at(3, 21))).toBe('nowruz');
    expect(seasonFor(at(3, 31))).toBe('nowruz');
    expect(seasonFor(at(9, 9))).toBe('independence');
    expect(seasonFor(at(8, 1))).toBe('independence');
    expect(seasonFor(at(10, 5))).toBe('independence'); // поровну до Дня независимости и Хэллоуина: остаётся прежний
    expect(seasonFor(at(10, 6))).toBe('halloween');
    expect(seasonFor(at(10, 31))).toBe('halloween');
    expect(seasonFor(at(11, 20))).toBe('halloween');
    expect(seasonFor(at(11, 27))).toBe('halloween'); // 27 дней после Хэллоуина, 28 до Нового года
    expect(seasonFor(at(11, 28))).toBe('christmas');
    expect(seasonFor(at(12, 1))).toBe('christmas');
  });

  it('праздники по лунному календарю: Рамазан — весь месяц, Курбан — день; даты берутся из таблицы года', () => {
    // 2026: Рамазан с 18 февраля по 19 марта, Курбан 27 мая
    expect(seasonFor(at(2, 16))).toBe('valentine'); // два дня и до 14 февраля, и до Рамазана: остаётся прежний
    expect(seasonFor(at(2, 17))).toBe('ramadan');
    expect(seasonFor(at(2, 18))).toBe('ramadan');
    expect(seasonFor(at(3, 7))).toBe('ramadan');
    expect(seasonFor(at(3, 8))).toBe('march8'); // однодневный праздник внутри Рамазана главнее
    expect(seasonFor(at(3, 9))).toBe('ramadan');
    expect(seasonFor(at(3, 19))).toBe('ramadan');
    expect(seasonFor(at(3, 20))).toBe('nowruz'); // день после Рамазана и день до Навруза
    expect(seasonFor(at(4, 23))).toBe('nowruz');
    expect(seasonFor(at(4, 24))).toBe('kurban');
    expect(seasonFor(at(5, 27))).toBe('kurban');
    expect(seasonFor(at(6, 1))).toBe('kurban');
    expect(seasonFor(at(7, 18))).toBe('kurban');
    expect(seasonFor(at(7, 19))).toBe('independence');
    // 2027: Рамазан с 8 февраля, Курбан 16 мая
    expect(seasonFor(at(2, 8, 2027))).toBe('ramadan');
    expect(seasonFor(at(2, 14, 2027))).toBe('valentine');
    expect(seasonFor(at(5, 16, 2027))).toBe('kurban');
  });

  it('вне таблицы лунных дат (после 2035 года) остаются праздники с постоянной датой', () => {
    const seen = new Set<string>();
    for (let d = new Date(2040, 0, 1); d.getFullYear() === 2040; d.setDate(d.getDate() + 1)) seen.add(seasonFor(d));
    expect([...seen].sort()).toEqual(['christmas', 'halloween', 'independence', 'march8', 'nowruz', 'valentine']);
  });

  it('високосный год ничего не ломает: 29 февраля и 31 декабря', () => {
    expect(seasonFor(at(2, 29, 2028))).toBe('ramadan'); // в 2028 году Рамазан кончается 26 февраля: до него три дня, до 8 марта восемь
    expect(seasonFor(at(2, 29, 2040))).toBe('march8');
    expect(seasonFor(at(12, 31, 2028))).toBe('christmas');
    expect(seasonFor(at(10, 31, 2028))).toBe('halloween');
  });

  it('любая дата года даёт один из восьми праздников, у каждого есть цвета строки состояния и свой набор значков', () => {
    const seen = new Set<string>();
    for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) seen.add(seasonFor(d));
    expect([...seen].sort()).toEqual(['christmas', 'halloween', 'independence', 'kurban', 'march8', 'nowruz', 'ramadan', 'valentine']);
    for (const id of seen) {
      expect(id in SKIN_BARS, id).toBe(true);
      expect(SKIN_ICON_PACKS, id).toContain(id);
    }
  });

  it('resolveSkin: «Сезонные» превращаются в праздник по дате, остальные образы остаются как есть', () => {
    expect(resolveSkin(SEASONAL_SKIN, at(10, 31))).toBe('halloween');
    expect(resolveSkin(SEASONAL_SKIN, at(2, 14))).toBe('valentine');
    expect(resolveSkin('barca', at(10, 31))).toBe('barca');
    expect(resolveSkin('classic', at(12, 25))).toBe('classic');
  });

  it('«Сезонные» — допустимое значение, но своих цветов строки состояния у них нет (берутся у образа на странице)', () => {
    expect(isSkinId('seasonal')).toBe(true);
    expect(skinBar('seasonal')).toBeNull();
    expect(skinBar('halloween')).toEqual(SKIN_BARS.halloween);
    expect('seasonal' in SKIN_BARS).toBe(false);
  });

  it('выбор: в хранилище остаётся «Сезонные», на странице — праздничный образ; с наступлением другой даты образ меняется при запуске', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(10, 31));
    saveSkinPref('seasonal');
    expect(localStorage.getItem('finora-skin')).toBe('seasonal');
    expect(readSkinPref()).toBe('seasonal');
    expect(document.documentElement.getAttribute('data-skin')).toBe('halloween');
    vi.setSystemTime(at(12, 24));
    applySkin(readSkinPref()); // так приложение стартует
    expect(document.documentElement.getAttribute('data-skin')).toBe('christmas');
    saveSkinPref('classic');
    expect(document.documentElement.hasAttribute('data-skin')).toBe(false);
  });

  it('в списке образов: раздел «Праздники» с «Сезонными» (переключатель) и праздниками; у переключателя нет цветов, у праздников есть', () => {
    expect(SKIN_GROUPS.map((g) => g.id)).toContain('holiday');
    const holiday = SKINS.filter((s) => s.group === 'holiday');
    expect(holiday.map((s) => s.id)).toEqual(['seasonal', 'christmas', 'halloween', 'valentine', 'ramadan', 'kurban', 'independence', 'march8', 'birthday']);
    expect(holiday[0]?.resolves).toBe(true);
    expect(holiday[0]?.bar).toBeNull();
    for (const s of holiday.slice(1)) {
      expect(s.resolves, s.id).toBeUndefined();
      expect(s.bar, s.id).toEqual(SKIN_BARS[s.id as keyof typeof SKIN_BARS]);
    }
  });
});

describe('«Бенто»: раскладка главной', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

  it('главная помечает контейнер, а шесть компактных карточек — data-bento="half"', () => {
    expect(read('src/features/home/HomePage.tsx')).toContain('<div data-home-grid ');
    for (const file of [
      'src/features/home/WeeklyCard.tsx',
      'src/features/home/SaveRemainderCard.tsx',
      'src/features/home/TripCard.tsx',
      'src/features/daily/DailyHomeCard.tsx',
      'src/features/budgets/BudgetsWidget.tsx',
      'src/features/recurring/UpcomingWidget.tsx',
    ]) {
      expect(read(file), file).toContain('data-bento="half"');
    }
  });

  it('две колонки включаются только у образа «Бенто» и только от 560 px: на телефоне карточки остаются в один столбец', () => {
    const css = read('src/index.css');
    const m = /@media \(min-width: 560px\) \{([\s\S]*?)\n\}\n/.exec(css.slice(css.indexOf("Бенто: на экране от 560 px")));
    expect(m, 'блок раскладки').not.toBeNull();
    const block = m?.[1] ?? '';
    expect(block).toContain("html[data-skin='bento'] [data-home-grid]");
    expect(block).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(block).toContain("> [data-bento='half']");
    expect(block).not.toMatch(/html\[data-skin='(?!bento)/); // других образов раскладка не касается
  });
});
