import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { DUO } from '@/components/iconData';
import { EXTRA_ICONS } from '@/components/iconExtraData';
import { setSkinIconPack, skinIconMarkup, type SkinIconPack } from '@/components/skinIconStore';
import { act, render, waitFor } from '@/components/testUtils';
import { SKIN_BARS, SKIN_ICON_PACKS, type SkinId } from '../skinCore';
import { createExtras, ICON_GEOMETRY, loadSkinIconPack, PIXEL_BITMAPS } from '../skinIcons';
import { applySkin } from '../theme';
import { ICON_PACK_CREDITS, PACK_CREDITS_TEXT } from './credits';
import meta from './meta.json';
import { loadPackGroup, PACK_FILES, SKIN_ICONIFY, type IconPackId } from './registry';
import fs from 'node:fs';
import path from 'node:path';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  document.documentElement.removeAttribute('data-theme');
  setSkinIconPack(null, null);
};
beforeEach(reset);
afterEach(reset);

/** Значки-органы управления остаются обычными: «плюс», корзина, замок, облако и так далее не должны меняться вместе с образом. */
const CONTROLS = ['more', 'trash', 'edit', 'cloud', 'refresh', 'lock', 'download', 'upload', 'transfer', 'alert', 'info', 'backspace', 'income', 'expense', 'logout', 'settings', 'sliders', 'eye', 'eye-off', 'mic', 'search'];

/** Теги, которые бывают в рисунках наборов: фигуры и градиенты (без filter, mask, use, image, style, script). */
const DRAWING_TAGS = ['<svg', '<g', '<path', '<circle', '<rect', '<ellipse', '<defs', '<linearGradient', '<radialGradient', '<stop', '<use'];

const FILES = import.meta.glob<{ ICONS: Readonly<Record<string, string>> }>('./*/*.ts', { eager: true });
const PACKS = Object.keys(ICON_PACK_CREDITS) as IconPackId[];
const sectionOf = new Map(EXTRA_ICONS.map((e) => [e.name, e.section]));
const filesOf = (pack: string) => Object.entries(FILES).filter(([file]) => file.startsWith(`./${pack}/`)).map(([file, m]) => ({ group: path.basename(file, '.ts'), icons: m.ICONS }));

describe('наборы значков из Iconify: файлы', () => {
  it('набор для каждого образа, кроме «Классики»; названы в списке авторов; для каждого есть папка с основными значками', () => {
    expect(Object.keys(SKIN_ICONIFY).every((id) => id in SKIN_BARS)).toBe(true);
    for (const pack of Object.values(SKIN_ICONIFY)) expect(PACKS, pack).toContain(pack);
    expect(new Set(Object.values(SKIN_ICONIFY)).size, 'у каждого образа свой набор').toBe(Object.values(SKIN_ICONIFY).length);
    for (const pack of PACKS) expect(PACK_FILES, pack).toContain(`./${pack}/base.ts`);
    expect(meta.map((m) => m.id).sort()).toEqual([...PACKS].sort());
    // папки наборов — только те, что в списке (иначе скрипт оставил бы лишнее)
    const dirs = fs.readdirSync(__dirname, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.sort()).toEqual([...PACKS].sort());
  });

  it('у наборов с лицензией CC BY указан автор, у остальных — MIT', () => {
    for (const [id, c] of Object.entries(ICON_PACK_CREDITS)) {
      expect(c.author.length, id).toBeGreaterThan(2);
      expect(['MIT', 'CC BY 4.0', 'CC BY 3.0'], id).toContain(c.license);
    }
    expect(ICON_PACK_CREDITS['sl-cyber'].license).toBe('CC BY 4.0');
    // подпись в «Настройках» называет каждый набор и автора набора с лицензией CC BY
    for (const c of Object.values(ICON_PACK_CREDITS)) expect(PACK_CREDITS_TEXT, c.title).toContain(c.title.replace(/^with icons /, '').split(' ')[0]!);
    expect(PACK_CREDITS_TEXT).toContain('Streamline Cyber (Streamline, CC BY 4.0)');
  });

  it.each(PACKS)('%s: имена значков есть в приложении, управление не заменено, разделы совпадают, в наборе не меньше 100 значков', (pack) => {
    const files = filesOf(pack);
    let total = 0;
    for (const { group, icons } of files) {
      for (const name of Object.keys(icons)) {
        total += 1;
        if (group === 'base') {
          expect(name in DUO, `${pack}: «${name}» нет среди основных значков`).toBe(true);
          expect(CONTROLS, `${pack}: «${name}» — орган управления, его заменять нельзя`).not.toContain(name);
        } else {
          expect(sectionOf.get(name), `${pack}/${group}: «${name}»`).toBe(group);
        }
      }
    }
    expect(total, pack).toBeGreaterThanOrEqual(100);
    expect(total, pack).toBe(meta.find((m) => m.id === pack)?.count);
    expect(files.map((f) => f.group).sort(), pack).toEqual([...(meta.find((m) => m.id === pack)?.groups ?? [])].sort());
  });

  it.each(PACKS)('%s: разметка — только рисунок (фигуры и градиенты), без скриптов, стилей, фильтров и внешних ссылок; id внутри значков не повторяются между значками', (pack) => {
    const ids = new Map<string, string>();
    for (const { group, icons } of filesOf(pack)) {
      for (const [name, markup] of Object.entries(icons)) {
        const at = `${pack}/${group}/${name}`;
        expect(markup, at).toMatch(/^<svg viewBox="0 0 \d+ \d+">.*<\/svg>$/s);
        expect(markup, at).not.toMatch(/<script|<style|<image|<foreignObject|\sstyle=|\son[a-z]+=|javascript:|href="(?!#)|xlink:|data:/i);
        for (const tag of markup.match(/<[a-zA-Z][a-zA-Z0-9]*/g) ?? []) expect(DRAWING_TAGS, `${at}: ${tag}`).toContain(tag);
        // каждый значок стоит на странице вместе с остальными: одинаковые id у разных значков склеили бы их градиенты и маски
        for (const id of markup.match(/\bid="([^"]+)"/g) ?? []) {
          expect(ids.has(id), `${at}: ${id} уже есть у ${ids.get(id)}`).toBe(false);
          ids.set(id, at);
        }
        for (const ref of markup.match(/url\(#([^)]+)\)/g) ?? []) expect(markup, `${at}: ${ref}`).toContain(`id="${ref.slice(5, -1)}"`);
        for (const ref of markup.match(/href="#([^"]+)"/g) ?? []) expect(markup, `${at}: ${ref}`).toContain(`id="${ref.slice(7, -1)}"`); // <use> ссылается только на фигуру из того же значка
      }
    }
  });

  it('значок рисуется в обычном размере: <svg viewBox> внутри <svg>, с рисунком, помечен для подсветки образа', () => {
    const icons = FILES['./wi-anime/base.ts']!.ICONS;
    setSkinIconPack({ home: icons.home! }, 'wi-anime');
    const { container } = render(<Icon name="home" size={32} />);
    const outer = container.querySelector('svg');
    expect(outer).toHaveAttribute('width', '32');
    expect(outer).toHaveAttribute('data-skin-icon');
    const inner = outer?.querySelector('svg');
    expect(inner).toHaveAttribute('viewBox', '0 0 24 24');
    expect(inner?.querySelectorAll('path').length).toBeGreaterThan(2);
    act(() => setSkinIconPack(null, null));
    expect(container.querySelector('svg svg')).toBeNull();
    expect(container.querySelector('svg')).not.toHaveAttribute('data-skin-icon');
  });
});

describe('градиенты в значках наборов', () => {
  it('linearGradient и radialGradient попадают в страницу с прежним регистром имени, а заливка ссылается на них (иначе значки «Глины» и «Стекла» были бы прозрачными)', () => {
    const markup =
      '<svg viewBox="0 0 24 24"><defs><linearGradient id="t-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f00" stop-opacity=".5"/></linearGradient><radialGradient id="t-b" cx=".5" cy=".5" r=".5"><stop offset="1" stop-color="#00f"/></radialGradient></defs><rect x="2" y="2" width="20" height="20" rx="4" fill="url(#t-a)"/><circle cx="12" cy="12" r="5" fill="url(#t-b)"/></svg>';
    setSkinIconPack({ home: markup }, 'test');
    const { container } = render(<Icon name="home" />);
    expect(container.getElementsByTagName('linearGradient')).toHaveLength(1);
    expect(container.getElementsByTagName('radialGradient')).toHaveLength(1);
    expect(container.getElementsByTagName('stop')[0]).toHaveAttribute('stop-color', '#f00');
    expect(container.getElementsByTagName('stop')[0]).toHaveAttribute('stop-opacity', '.5');
    const rect = container.querySelector('rect');
    expect(rect).toHaveAttribute('width', '20'); // размеры у rect остаются: без них фигура не рисуется
    const ref = /^url\(#(t-a\w+)\)$/.exec(rect?.getAttribute('fill') ?? '')?.[1]; // id получил суффикс экземпляра
    expect(ref).toBeDefined();
    expect(container.getElementsByTagName('linearGradient')[0]).toHaveAttribute('id', ref);
  });
});

describe('одинаковые значки с градиентами на одной странице', () => {
  it('у каждого экземпляра свои id, и заливка каждого ссылается на свой градиент (первый может быть в скрытом блоке и не рисоваться)', () => {
    const markup = '<svg viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0" stop-color="#f00"/></linearGradient><path id="p1" d="M0 0h4v4z"/></defs><rect width="20" height="20" fill="url(#g1)"/><use href="#p1"/></svg>';
    setSkinIconPack({ home: markup }, 'test');
    const { container } = render(
      <div>
        <Icon name="home" />
        <Icon name="home" />
        <Glyph value="i:wife" />
      </div>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids).toHaveLength(4); // у каждого из двух значков градиент и фигура для <use>
    expect(new Set(ids).size).toBe(4);
    for (const rect of container.querySelectorAll('rect')) {
      const ref = /url\(#([^)]+)\)/.exec(rect.getAttribute('fill') ?? '')?.[1] ?? '';
      expect(ids, `заливка ${rect.getAttribute('fill')}`).toContain(ref);
    }
    for (const use of container.querySelectorAll('use')) expect(ids, 'ссылка <use>').toContain((use.getAttribute('href') ?? '').slice(1));
    // перерисовка не меняет id: градиент не мигает
    const before = container.innerHTML;
    act(() => setSkinIconPack({ home: markup }, 'test'));
    expect(container.innerHTML).toBe(before);
  });
});

describe('loadSkinIconPack', () => {
  it('образ с набором из Iconify получает его основные значки; остальные значки берутся из набора его стиля', async () => {
    for (const [skin, pack] of Object.entries(SKIN_ICONIFY) as [SkinId, IconPackId][]) {
      const got = await loadSkinIconPack(skin);
      const base = FILES[`./${pack}/base.ts`]!.ICONS;
      expect(got?.extras, skin).toBeDefined();
      for (const [name, markup] of Object.entries(base)) expect(got?.pack[name], `${skin}/${name}`).toBe(markup);
      // даже если у набора нет какого-то значка, он рисуется линией или пикселями образа, а не остаётся обычным
      for (const name of Object.keys(skin === 'pixel' ? PIXEL_BITMAPS : ICON_GEOMETRY)) expect(got?.pack[name], `${skin}/${name}`).toBeTruthy();
    }
  });

  it('у образов без набора из Iconify — прежний линейный набор без дополнительных значков; у «Классики» набора нет', async () => {
    const barca = await loadSkinIconPack('barca');
    expect(barca?.extras).toBeUndefined();
    expect(barca?.pack.home).toContain('stroke-linecap');
    expect(await loadSkinIconPack('classic')).toBeUndefined();
    for (const id of SKIN_ICON_PACKS) expect(await loadSkinIconPack(id), id).toBeDefined();
  });

  it('значок «Эстетики» теперь из набора Luxe, а «Шиноби» — из Anime (разные рисунки)', async () => {
    const [shinobi, aesthetic] = await Promise.all([loadSkinIconPack('shinobi'), loadSkinIconPack('aesthetic')]);
    expect(shinobi?.pack.home).toBe(FILES['./wi-anime/base.ts']!.ICONS.home);
    expect(aesthetic?.pack.home).toBe(FILES['./wi-luxe/base.ts']!.ICONS.home);
    expect(shinobi?.pack.home).not.toBe(aesthetic?.pack.home);
  });

  it('loadPackGroup: раздела нет в наборе — пустой объект, а не ошибка', async () => {
    expect(await loadPackGroup('pixelarticons', 'нет-такого')).toEqual({});
    expect(Object.keys(await loadPackGroup('wi-kawaii', 'family')).length).toBeGreaterThan(5);
  });
});

describe('выбор образа ставит набор и дополнительные значки', () => {
  it('«Шиноби»: значок «Главная» из набора, дополнительные догружаются по разделу; «Классика» всё убирает', async () => {
    applySkin('shinobi');
    await waitFor(() => expect(skinIconMarkup('home')).toMatch(/^<svg viewBox/));
    const { container } = render(<Glyph value="i:wife" color="#db2777" size={40} />);
    expect(container.querySelector('svg')).toBeNull(); // раздел ещё не просили: сначала пустая плитка
    await waitFor(() => expect(container.querySelector('svg svg path')).not.toBeNull());
    expect(container.querySelector('svg')).toHaveAttribute('data-skin-icon');
    applySkin('classic');
    await waitFor(() => expect(skinIconMarkup('home')).toBeNull());
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull()); // на экране — снова обычный значок (его файл догружается)
    expect(container.querySelector('svg svg')).toBeNull();
  });

  it('у образа без набора из Iconify дополнительные значки обычные (Solar): без вложенного <svg>', async () => {
    applySkin('barca');
    await waitFor(() => expect(skinIconMarkup('home')).toContain('stroke-linecap'));
    const { container } = render(<Glyph value="i:wife" size={40} />);
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
    expect(container.querySelector('svg svg')).toBeNull();
  });

  it('если у набора нет такого значка или файл раздела не загрузился — рисуется обычный значок', async () => {
    const empty: SkinIconPack = {};
    setSkinIconPack(empty, 'test', createExtras(() => Promise.resolve({})));
    const a = render(<Glyph value="i:wife" size={40} />);
    await waitFor(() => expect(a.container.querySelector('svg path')).not.toBeNull());
    expect(a.container.querySelector('svg svg')).toBeNull();
    a.unmount();
    setSkinIconPack(empty, 'test2', createExtras(() => Promise.reject(new Error('нет сети'))));
    const b = render(<Glyph value="i:wife" size={40} />);
    await waitFor(() => expect(b.container.querySelector('svg path')).not.toBeNull());
    expect(b.container.querySelector('svg svg')).toBeNull();
  });
});

describe('createExtras', () => {
  it('раздел грузится один раз, пока грузится — null, потом значки; о загрузке сообщается значкам на экране', async () => {
    let calls = 0;
    let done: (icons: SkinIconPack) => void = () => undefined;
    const extras = createExtras(() => {
      calls += 1;
      return new Promise((resolve) => {
        done = resolve;
      });
    });
    expect(extras.get('wife', 'family')).toBeNull();
    extras.ensure('family');
    extras.ensure('family');
    expect(calls).toBe(1);
    expect(extras.get('wife', 'family')).toBeNull();
    await act(async () => {
      done({ wife: '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>' });
      await Promise.resolve();
    });
    expect(extras.get('wife', 'family')).toContain('<path');
    expect(extras.get('husband', 'family')).toBeUndefined(); // раздел загружен, но такого значка в наборе нет
  });
});

describe('сборка: файлы наборов не в основном файле и не в офлайн-кэше', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

  it('vite.config.ts называет файлы наборов pack-…, исключает их из офлайн-кэша; в check-bundle.mjs для них свой порог', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("globIgnores: ['**/assets/pack-*.js']");
    expect(vite).toContain('assets/pack-${pack[1]}-${pack[2]}-[hash].js');
    const bundle = read('scripts/check-bundle.mjs');
    expect(bundle).toMatch(/match: \/\^pack-\.\*\\\.js\$\//);
    // правило для наборов стоит раньше общего правила для ленивых файлов, иначе действовал бы порог в 40 КБ
    expect(bundle.indexOf('^pack-')).toBeLessThan(bundle.indexOf("match: /\\.js$/"));
  });

  it('основной файл приложения не обращается к файлам наборов напрямую: только registry.ts (грузится вместе с src/skinIcons.ts)', () => {
    const importers = ['src/theme.ts', 'src/skinCore.ts', 'src/components/Icon.tsx', 'src/components/Glyph.tsx', 'src/components/skinIconStore.ts'];
    for (const file of importers) expect(read(file), file).not.toMatch(/skinIconPacks\//);
  });
});
