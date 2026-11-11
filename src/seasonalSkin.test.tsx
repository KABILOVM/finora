import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSkinId, resolveSkin, SEASONAL_SKIN, SKIN_BARS, SKIN_ICON_PACKS, seasonFor, skinBar } from './skinCore';
import { SKIN_GROUPS, SKINS } from './skins';
import { HOME_BLOCKS } from './features/home/layout/blocks';
import { widthOf } from './features/home/layout/layout';
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
  it('ближайший праздник: Новый год (25 декабря), Хэллоуин (31 октября) или 14 февраля, по кругу года', () => {
    expect(seasonFor(at(12, 25))).toBe('christmas');
    expect(seasonFor(at(1, 1))).toBe('christmas'); // через границу года
    expect(seasonFor(at(1, 10))).toBe('christmas');
    expect(seasonFor(at(1, 19))).toBe('christmas'); // 26 дней до 14 февраля, 25 после Нового года
    expect(seasonFor(at(1, 20))).toBe('valentine');
    expect(seasonFor(at(2, 14))).toBe('valentine');
    expect(seasonFor(at(3, 31))).toBe('valentine');
    expect(seasonFor(at(6, 1))).toBe('valentine');
    expect(seasonFor(at(7, 15))).toBe('halloween');
    expect(seasonFor(at(10, 31))).toBe('halloween');
    expect(seasonFor(at(11, 20))).toBe('halloween');
    expect(seasonFor(at(11, 30))).toBe('christmas'); // 25 дней до Нового года, 30 после Хэллоуина
    expect(seasonFor(at(12, 1))).toBe('christmas');
    // границы, как они описаны в README: 20 января, 23/24 июня и 27/28 ноября
    expect(seasonFor(at(6, 23))).toBe('valentine');
    expect(seasonFor(at(6, 24))).toBe('halloween');
    expect(seasonFor(at(11, 27))).toBe('halloween');
    expect(seasonFor(at(11, 28))).toBe('christmas');
  });

  it('високосный год ничего не ломает: 29 февраля и 31 декабря', () => {
    expect(seasonFor(at(2, 29, 2028))).toBe('valentine');
    expect(seasonFor(at(12, 31, 2028))).toBe('christmas');
    expect(seasonFor(at(10, 31, 2028))).toBe('halloween');
  });

  it('любая дата года даёт один из трёх праздников, у каждого есть цвета строки состояния и свой набор значков', () => {
    const seen = new Set<string>();
    for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) seen.add(seasonFor(d));
    expect([...seen].sort()).toEqual(['christmas', 'halloween', 'valentine']);
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

  it('в списке образов: раздел «Праздники» с «Сезонными» (переключатель) и тремя праздниками; у переключателя нет цветов, у праздников есть', () => {
    expect(SKIN_GROUPS.map((g) => g.id)).toContain('holiday');
    const holiday = SKINS.filter((s) => s.group === 'holiday');
    expect(holiday.map((s) => s.id)).toEqual(['seasonal', 'christmas', 'halloween', 'valentine']);
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

  it('главная помечает контейнер, а шести компактным блокам обёртка ставит data-bento="half", пока человек не выбрал ширину сам', () => {
    expect(read('src/features/home/HomePage.tsx')).toContain('<div data-home-grid ');
    expect(read('src/features/home/HomePage.tsx')).toContain("bento: { 'data-bento': 'half' }");
    // какие блоки компактные, решает реестр (half: 'wide')
    const wide = HOME_BLOCKS.filter((b) => b.half === 'wide');
    expect(wide.map((b) => b.id)).toEqual(['weekly', 'save', 'trip', 'daily', 'budgets', 'upcoming']);
    for (const block of HOME_BLOCKS) expect(widthOf({ block }) === 'bento', block.id).toBe(block.half === 'wide');
    // выбранная человеком ширина сильнее образа
    expect(widthOf({ block: wide[0]!, size: 'full' })).toBe('full');
    expect(widthOf({ block: wide[0]!, size: 'half' })).toBe('half-wide');
  });

  it('пары включаются только у образа «Бенто» и только от 560 px: на телефоне карточки остаются в один столбец', () => {
    const css = read('src/index.css');
    const m = /@media \(min-width: 560px\) \{([\s\S]*?)\n\}\n/.exec(css.slice(css.indexOf('Компактные карточки бывают половиной только от 560 px')));
    expect(m, 'блок раскладки').not.toBeNull();
    const block = m?.[1] ?? '';
    expect(block).toContain("html[data-skin='bento'] [data-home-grid] > [data-bento='half']");
    expect(block).toContain('flex: 1 1 calc(50% - 0.75rem)');
    expect(block).not.toMatch(/html\[data-skin='(?!bento)/); // других образов раскладка не касается
  });
});
