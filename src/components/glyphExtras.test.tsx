import { describe, expect, it } from 'vitest';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { Glyph } from './Glyph';
import { GlyphPicker } from './GlyphPicker';
import { EXTRA_LOADERS, extraIconByName, loadExtraIcons } from './glyphExtras';
import { GLYPH_CHOICES, GLYPH_SECTIONS, glyphLabel, glyphValue, resolveGlyph } from './glyphs';
import { DUO } from './iconData';
import { EXTRA_ICONS } from './iconExtraData';
import { render, screen, user, waitFor } from './testUtils';

/** Лимит длины поля icon в хранилище и в облаке (LIMITS.short, `char_length(icon) <= 32` в supabase/schema.sql). */
const ICON_MAX = 32;

/** Значки, которые были в выборе до появления разделов: ни один не должен пропасть (у людей они уже выбраны в категориях и кошельках). */
const ORIGINAL_CHOICES = [
  'cart', 'food', 'cup', 'donut', 'wine', 'bus', 'car', 'fuel', 'plane', 'scooter', 'home', 'sofa', 'bulb', 'washing', 'tool', 'key', 'bolt', 'water',
  'wifi', 'phone', 'laptop', 'heart', 'pills', 'hospital', 'gym', 'bag', 'shirt', 'scissors', 'paw', 'game', 'music', 'tv', 'video', 'ball', 'party',
  'book', 'diploma', 'gift', 'briefcase', 'salary', 'cash', 'card', 'safe', 'money', 'invest', 'debt', 'star', 'fire', 'repeat', 'box', 'tag', 'sale',
  'target', 'stars',
];

describe('дополнительные значки: каталог и файлы', () => {
  it('значков стало заметно больше (было 54), в сетке нет повторов, ни один прежний не пропал', () => {
    expect(GLYPH_CHOICES.length).toBeGreaterThan(140);
    expect(new Set(GLYPH_CHOICES).size).toBe(GLYPH_CHOICES.length);
    for (const name of ORIGINAL_CHOICES) expect(GLYPH_CHOICES, name).toContain(name);
  });

  it('имена безопасны, «i:имя» влезает в поле icon, у каждого значка есть название, дополнительные не повторяют основные', () => {
    for (const e of EXTRA_ICONS) {
      expect(e.name, e.name).toMatch(/^[a-z0-9]{1,20}$/);
      expect(glyphValue(e.name).length, e.name).toBeLessThanOrEqual(ICON_MAX);
      expect(Object.hasOwn(DUO, e.name), `${e.name} уже есть среди основных`).toBe(false);
    }
    for (const name of GLYPH_CHOICES) expect(glyphLabel(name).trim(), name).not.toBe('');
    // название не равно имени: значит, оно подписано по-русски, а не осталось запасным
    for (const name of GLYPH_CHOICES) expect(glyphLabel(name), name).not.toBe(name);
  });

  it('у каждого раздела с новыми значками есть загрузчик, а в файле — ровно его значки с непустой разметкой', async () => {
    const sections = new Set(EXTRA_ICONS.map((e) => e.section));
    expect([...EXTRA_LOADERS.keys()].sort()).toEqual([...sections].sort());
    for (const section of sections) {
      const { ICONS } = await EXTRA_LOADERS.get(section)!();
      const own = EXTRA_ICONS.filter((e) => e.section === section).map((e) => e.name);
      expect(Object.keys(ICONS).sort(), section).toEqual([...own].sort());
      for (const name of own) {
        expect(ICONS[name]!.length, name).toBeGreaterThan(40);
        // только рисунок: никаких скриптов, обработчиков событий и внешних ссылок
        expect(ICONS[name], name).not.toMatch(/<script|\son[a-z]+=|href|javascript:/i);
      }
    }
  });

  it('все разделы выбора непустые и называются по-русски; «Семья и дети» и «Дом и коммунальные услуги» есть', () => {
    for (const s of GLYPH_SECTIONS) expect(s.names.length, s.id).toBeGreaterThan(3);
    const labels = GLYPH_SECTIONS.map((s) => s.label);
    expect(labels).toContain('Семья и дети');
    expect(labels).toContain('Дом и коммунальные услуги');
    for (const name of ['wife', 'husband', 'kids', 'baby', 'heating', 'trash', 'bolt', 'water', 'fire', 'wifi']) expect(GLYPH_CHOICES, name).toContain(name);
  });
});

describe('значение «i:имя» для дополнительных значков', () => {
  it('дополнительный значок — отдельный вид; служебные имена объектов значками не считаются', () => {
    expect(resolveGlyph('i:wife')).toEqual({ kind: 'extra', name: 'wife' });
    expect(resolveGlyph('i:home')).toEqual({ kind: 'icon', name: 'home' });
    expect(extraIconByName('constructor')).toBeUndefined();
    expect(extraIconByName('home')).toBeUndefined();
    for (const bad of ['i:constructor', 'i:__proto__', 'i:toString', 'i:nope', 'i:']) expect(resolveGlyph(bad).kind, bad).toBe('text');
  });
});

describe('Glyph с дополнительным значком', () => {
  it('плитка сразу, рисунок — когда загрузился файл раздела; цвет категории применяется как у обычных значков', async () => {
    const { container } = render(<Glyph value="i:wife" color="#db2777" size={40} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.style.backgroundColor).toContain('color-mix');
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('без цвета — нейтральная плитка, как у обычных значков', async () => {
    const { container } = render(<Glyph value="i:heating" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-surface-2');
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
  });

  it('все дополнительные значки рисуются (по разделам)', async () => {
    for (const section of new Set(EXTRA_ICONS.map((e) => e.section))) {
      await loadExtraIcons(section);
      for (const e of EXTRA_ICONS.filter((x) => x.section === section)) {
        const { container, unmount } = render(<Glyph value={glyphValue(e.name)} />);
        await waitFor(() => expect(container.querySelector('svg path'), e.name).not.toBeNull());
        unmount();
      }
    }
  });
});

describe('GlyphPicker: разделы значков', () => {
  it('значки разложены по разделам; «Жена», «Дети», «Отопление», «Вывоз мусора» выбираются и отдают «i:имя»', async () => {
    const calls: string[] = [];
    render(<GlyphPicker value="i:home" onChange={(v) => calls.push(v)} />);
    for (const label of ['Семья и дети', 'Дом и коммунальные услуги', 'Еда и напитки', 'Транспорт и поездки', 'Здоровье и красота', 'Работа, учёба, деньги']) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
    for (const [label, value] of [['Жена', 'i:wife'], ['Муж', 'i:husband'], ['Дети', 'i:kids'], ['Отопление', 'i:heating'], ['Вывоз мусора', 'i:trash'], ['Электричество', 'i:bolt']] as const) {
      await user.click(screen.getByRole('button', { name: label }));
      expect(calls.at(-1), label).toBe(value);
    }
    await waitFor(() => expect(document.querySelectorAll('svg path').length).toBeGreaterThan(100));
  });

  it('выбранный дополнительный значок отмечен, как и основной', async () => {
    render(<GlyphPicker value="i:wife" onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Жена', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Муж', pressed: false })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('svg path').length).toBeGreaterThan(100));
  });
});

describe('suggestGlyph: семья, дети, коммунальные услуги', () => {
  it('новая категория сама получает подходящий значок', () => {
    expect(suggestGlyph('Жена')).toBe('i:wife');
    expect(suggestGlyph('Дети')).toBe('i:kids');
    expect(suggestGlyph('Детская одежда')).toBe('i:kids'); // дети важнее одежды
    expect(suggestGlyph('Школа')).toBe('i:school');
    expect(suggestGlyph('Семья')).toBe('i:family');
    expect(suggestGlyph('Отопление')).toBe('i:heating');
    expect(suggestGlyph('Вывоз мусора')).toBe('i:trash');
    expect(suggestGlyph('Коммунальные услуги')).toBe('i:bulb');
    expect(suggestGlyph('Свадьба')).toBe('i:wedding');
    // прежнее и сервисы не сломаны
    expect(suggestGlyph('Кофе')).toBe('i:cup');
    expect(suggestGlyph('Подписки')).toBe('i:repeat');
    expect(suggestGlyph('Подписка Netflix')).toBe('s:netflix');
    expect(suggestGlyph('Неведомое')).toBe('i:tag');
  });

  it('всё, что подсказывается, существует: каждое значение — значок из набора', () => {
    for (const name of ['Жена', 'Дети', 'Школа', 'Отопление', 'Мусор', 'Йога', 'Бассейн', 'Паспорт', 'Рамадан', 'Евро', 'Тетради', 'Почта', 'Велосипед']) {
      const v = suggestGlyph(name);
      expect(v.startsWith('i:'), name).toBe(true);
      expect(GLYPH_CHOICES, name).toContain(v.slice(2));
    }
  });
});
