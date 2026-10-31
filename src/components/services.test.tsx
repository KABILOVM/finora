import { describe, expect, it, vi } from 'vitest';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { Glyph } from './Glyph';
import { GlyphPicker } from './GlyphPicker';
import { resolveGlyph } from './glyphs';
import { LOGO_LOADERS, SERVICES, SERVICE_GROUPS, findServiceByName, loadServiceLogos, serviceById, serviceValue } from './services';
import { render, screen, user, waitFor } from './testUtils';

/** Лимит длины поля icon в хранилище и в облаке (LIMITS.short, `char_length(icon) <= 32` в supabase/schema.sql). */
const ICON_MAX = 32;

describe('каталог сервисов', () => {
  it('id уникальны и безопасны, значение «s:id» влезает в поле icon, цвет — #rrggbb', () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SERVICES) {
      expect(s.id, s.id).toMatch(/^[a-z0-9]{1,30}$/);
      expect(serviceValue(s.id).length, s.id).toBeLessThanOrEqual(ICON_MAX);
      expect(s.color, s.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.name.trim(), s.id).not.toBe('');
    }
  });

  it('у каждой группы есть сервисы и загрузчик логотипов, а у каждого сервиса — известная группа', () => {
    const groups = SERVICE_GROUPS.map((g) => g.id);
    expect(new Set(groups).size).toBe(groups.length);
    expect([...LOGO_LOADERS.keys()].sort()).toEqual([...groups].sort());
    for (const g of groups) expect(SERVICES.some((s) => s.group === g), g).toBe(true);
    for (const s of SERVICES) expect(groups, s.id).toContain(s.group);
  });

  it('логотип есть у каждого сервиса, в файле группы нет чужих и лишних, путь не пустой', async () => {
    for (const group of SERVICE_GROUPS.map((g) => g.id)) {
      const { LOGOS } = await LOGO_LOADERS.get(group)!();
      const own = SERVICES.filter((s) => s.group === group).map((s) => s.id);
      expect(Object.keys(LOGOS).sort(), group).toEqual([...own].sort());
      for (const id of own) {
        const [viewBox, path] = LOGOS[id]!;
        expect(viewBox, id).toMatch(/^0 0 \d+ \d+$/);
        expect(path.length, id).toBeGreaterThan(20);
        // путь — только команды и числа: никакой разметки, которую можно было бы вставить в страницу
        expect(path, id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
      }
    }
  });
});

describe('значение «s:id»', () => {
  it('известный сервис — логотип, неизвестный (с другого устройства) — первая буква, а не «s:abc»', () => {
    expect(resolveGlyph('s:netflix')).toEqual({ kind: 'service', id: 'netflix' });
    expect(resolveGlyph('s:newservice')).toEqual({ kind: 'text', text: 'N' });
    expect(resolveGlyph('s:')).toEqual({ kind: 'text', text: '?' });
    // служебные имена объектов не принимаются за сервисы
    expect(serviceById('__proto__')).toBeUndefined();
    expect(serviceById('constructor')).toBeUndefined();
    expect(resolveGlyph('s:__proto__')).toEqual({ kind: 'text', text: '_' });
  });
});

describe('Glyph с логотипом сервиса', () => {
  it('плитка фирменного цвета сразу, логотип — когда загрузился файл группы', async () => {
    const { container } = render(<Glyph value="s:spotify" size={40} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.style.backgroundColor).toBe('rgb(30, 215, 96)'); // #1ed760
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
    // светлая плитка — тёмный знак
    expect(tile.style.color).toBe('rgb(17, 24, 39)');
  });

  it('цвет категории логотип не перекрашивает; тёмная плитка — белый знак', async () => {
    const { container } = render(<Glyph value="s:netflix" color="#16a34a" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.backgroundColor).toBe('rgb(229, 9, 20)'); // #e50914, а не зелёный
    expect(tile.style.color).toBe('rgb(255, 255, 255)');
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
  });

  it('логотипы из разных источников (Simple Icons, CoreUI, SVG Logos) рисуются', async () => {
    for (const id of ['claude', 'microsoft', 'openai']) {
      const { container, unmount } = render(<Glyph value={serviceValue(id)} />);
      await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
      unmount();
    }
  });

  it('сбой загрузки файла не роняет экран: плитка остаётся, ошибка в консоли', async () => {
    const original = LOGO_LOADERS.get('games')!;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (LOGO_LOADERS as Map<string, unknown>).set('games', () => Promise.reject(new Error('нет сети')));
    try {
      await loadServiceLogos('games');
      expect(err).toHaveBeenCalled();
      const failed = render(<Glyph value="s:steam" />);
      await new Promise((r) => setTimeout(r, 10));
      expect(failed.container.firstElementChild).not.toBeNull();
      expect(failed.container.querySelector('svg')).toBeNull();
      failed.unmount();
    } finally {
      (LOGO_LOADERS as Map<string, unknown>).set('games', original);
      err.mockRestore();
    }
    // следующая попытка проходит
    await loadServiceLogos('games');
    const { container } = render(<Glyph value="s:steam" />);
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
  });
});

describe('GlyphPicker: вкладка «Сервисы»', () => {
  it('по умолчанию — обычные значки; на вкладке «Сервисы» выбор отдаёт «s:id»', async () => {
    const onChange = vi.fn();
    render(<GlyphPicker value="i:home" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Значки', checked: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Netflix' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Сервисы' }));
    expect(screen.queryByRole('button', { name: 'Дом' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Claude' }));
    expect(onChange).toHaveBeenCalledWith('s:claude');
    // все группы подписаны
    for (const g of SERVICE_GROUPS) expect(screen.getByRole('group', { name: g.label })).toBeInTheDocument();
    // дождаться логотипов, чтобы загрузка не закончилась уже после теста
    await waitFor(() => expect(document.querySelectorAll('svg path').length).toBe(SERVICES.length));
  });

  it('если сейчас выбран логотип — сразу открыта вкладка сервисов и он отмечен', async () => {
    render(<GlyphPicker value="s:paypal" onChange={() => undefined} />);
    expect(screen.getByRole('radio', { name: 'Сервисы', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PayPal', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visa', pressed: false })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('svg path').length).toBe(SERVICES.length));
  });

  it('services={false}: вкладок нет, только обычные значки', () => {
    render(<GlyphPicker value="i:home" onChange={() => undefined} services={false} />);
    expect(screen.queryByRole('radio', { name: 'Сервисы' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Дом' })).toBeInTheDocument();
  });
});

describe('findServiceByName и suggestGlyph', () => {
  it('узнаёт сервис по названию: латиница, кириллица, лишние слова, пары слов', () => {
    const id = (name: string) => findServiceByName(name)?.id;
    expect(id('Netflix')).toBe('netflix');
    expect(id('  NETFLIX  ')).toBe('netflix');
    expect(id('Нетфликс')).toBe('netflix');
    expect(id('Подписка Netflix')).toBe('netflix');
    expect(id('Apple Music')).toBe('applemusic');
    expect(id('Подписка Apple Music')).toBe('applemusic');
    expect(id('Apple')).toBe('apple');
    expect(id('Google Drive')).toBe('googledrive');
    expect(id('Телеграм-канал')).toBe('telegram');
    expect(id('Claude Pro')).toBe('claude');
    expect(id('ChatGPT')).toBe('openai');
    expect(id('Booking.com')).toBe('booking');
    expect(id('Майкрософт 365')).toBe('microsoft');
    expect(id('X')).toBe('x');
  });

  it('обычные слова сервисами не считаются: части слов, «виза», «киви», одиночные буквы', () => {
    for (const name of ['Кофе', 'Продукты', 'Виза', 'Киви', 'Эфир', 'Подписки', 'Applesauce', 'Netflixer', 'Икс', 'Xylophone', 'a x b', '', '   ']) {
      expect(findServiceByName(name), name).toBeUndefined();
    }
  });

  it('suggestGlyph: сервис важнее общего слова; без сервиса — прежние значки', () => {
    expect(suggestGlyph('Spotify')).toBe('s:spotify');
    expect(suggestGlyph('Подписка Netflix')).toBe('s:netflix'); // а не общий значок «подписка»
    expect(suggestGlyph('Игры Steam')).toBe('s:steam'); // а не «игры»
    expect(suggestGlyph('Кофе')).toBe('i:cup');
    expect(suggestGlyph('Подписки')).toBe('i:repeat');
    expect(suggestGlyph('')).toBe('i:tag');
  });
});
