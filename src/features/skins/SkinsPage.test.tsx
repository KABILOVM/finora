import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { ToastProvider } from '@/components/Toast';
import { readCustomSkins } from '@/customSkin';
import { resolveSkin, skinTraits } from '@/skinCore';
import { SKIN_GROUPS, SKINS } from '@/skins';
import { SKIN_THUMBS } from '@/skinThumbs';
import SkinsPage from './SkinsPage';

const TRAIT_ATTRS = ['data-skin', 'data-look', 'data-shape', 'data-material', 'data-nav', 'data-hero', 'data-motion', 'data-scene', 'data-accent', 'data-theme', 'data-photo', 'data-hero-photo', 'style'];
const reset = () => {
  vi.useRealTimers();
  localStorage.clear();
  for (const a of TRAIT_ATTRS) document.documentElement.removeAttribute(a);
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const html = document.documentElement;
const open = () =>
  render(
    <MemoryRouter initialEntries={['/settings/skins']}>
      <ToastProvider>
        <SkinsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-skin-option]'));
const card = (id: string) => document.querySelector<HTMLElement>(`[data-skin-option="${id}"]`) as HTMLElement;
const current = () => cards().filter((c) => c.getAttribute('aria-current') === 'true').map((c) => c.getAttribute('data-skin-option'));
const chip = (name: string) => screen.getByRole('button', { name });

describe('витрина образов', () => {
  it('показывает все образы из SKINS разделами; у карточки в имени название и пояснение; выбрана «Классика»', () => {
    open();
    // карточки идут разделами в порядке SKIN_GROUPS, внутри раздела — как в SKINS
    expect(cards().map((c) => c.getAttribute('data-skin-option'))).toEqual(SKIN_GROUPS.flatMap((g) => SKINS.filter((s) => s.group === g.id).map((s) => s.id)));
    expect(cards()).toHaveLength(SKINS.length);
    expect(SKINS.length).toBeGreaterThan(60);
    for (const skin of SKINS) expect(card(skin.id).getAttribute('aria-label'), skin.id).toContain(`${skin.label}. ${skin.hint}`);
    expect(current()).toEqual(['classic']);
    expect(card('classic').getAttribute('aria-label')).toContain('Выбран');
    // разделы идут в порядке SKIN_GROUPS, у каждого свой заголовок и хотя бы один образ
    const sections = Array.from(document.querySelectorAll('[data-skin-group]'));
    expect(sections.map((s) => s.getAttribute('data-skin-group'))).toEqual(SKIN_GROUPS.map((g) => g.id));
    for (const g of SKIN_GROUPS) expect(screen.getByRole('heading', { level: 2, name: g.label })).toBeInTheDocument();
  });

  it('у каждой карточки маленький «экран» в цветах образа и свой значок', () => {
    open();
    for (const skin of SKINS) {
      const pv = card(skin.id).querySelector('.pv');
      expect(pv, skin.id).not.toBeNull();
      // палитра приходит через data-skin-scope; у «Классики» и «Классики (прежней)» — через акцент
      if (skin.base) expect(pv?.getAttribute('data-accent'), skin.id).toBe('violet');
      else expect(pv?.getAttribute('data-skin-scope'), skin.id).toBe(resolveSkin(skin.id));
      const traits = skinTraits(skin.id);
      expect(pv?.getAttribute('data-pv-shape'), skin.id).toBe(traits.shape);
      expect(pv?.getAttribute('data-pv-nav'), skin.id).toBe(traits.nav);
      expect(card(skin.id).querySelector('img')?.getAttribute('src'), skin.id).toBe(SKIN_THUMBS[skin.id]);
    }
  });

  it('нажатие на карточку открывает предпросмотр с шестью чертами, а образ приложения не меняется, пока не нажали «Применить»', async () => {
    open();
    await user.click(card('cyber'));
    const dlg = await findByRole('dialog', { name: 'Киберпанк' });
    expect(html.hasAttribute('data-skin')).toBe(false);
    expect(localStorage.getItem('finora-skin')).toBeNull();
    const rows = Array.from(dlg.querySelectorAll('[data-testid="skin-traits"] dd')).map((d) => d.textContent);
    expect(rows).toEqual(['Срезанный угол', 'Неон', 'Вкладки', 'Терминал', 'Резко', 'Неоновая сетка']);
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    expect(html.getAttribute('data-skin')).toBe('cyber');
    expect(localStorage.getItem('finora-skin')).toBe('cyber');
    expect([html.getAttribute('data-shape'), html.getAttribute('data-material'), html.getAttribute('data-nav'), html.getAttribute('data-hero'), html.getAttribute('data-motion'), html.getAttribute('data-scene')]).toEqual(['cut', 'neon', 'tabs', 'terminal', 'snappy', 'grid']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Киберпанк' })).toBeNull());
    expect(current()).toEqual(['cyber']);
  });

  it('у выбранного образа в предпросмотре кнопка «Уже выбран» и она не нажимается', async () => {
    localStorage.setItem('finora-skin', 'barca');
    open();
    expect(current()).toEqual(['barca']);
    await user.click(card('barca'));
    await findByRole('dialog', { name: 'Барселона' });
    expect(screen.getByRole('button', { name: 'Уже выбран' })).toBeDisabled();
  });

  it('каждый образ из списка можно применить: атрибут data-skin и сохранённое значение совпадают', async () => {
    open();
    for (const skin of SKINS.slice(1)) {
      await user.click(card(skin.id));
      await user.click(await findByRole('button', { name: 'Применить' }));
      // «Классика (прежняя)» — это вид без своей палитры: data-skin нет, стоит data-look; у «Сезонных» на странице праздничный образ по дате
      if (skin.base) {
        expect(html.hasAttribute('data-skin'), skin.id).toBe(false);
        expect(html.getAttribute('data-look'), skin.id).toBe('legacy');
      } else {
        expect(html.getAttribute('data-skin'), skin.id).toBe(resolveSkin(skin.id));
        expect(html.hasAttribute('data-look'), skin.id).toBe(false);
      }
      expect(localStorage.getItem('finora-skin'), skin.id).toBe(skin.id);
    }
  });

  it('«Сезонные»: предпросмотр называет сегодняшний праздник', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 31, 12));
    open();
    await user.click(card('seasonal'));
    const dlg = await findByRole('dialog', { name: 'Сезонные' });
    expect(dlg.textContent).toContain('Сегодня это «Хэллоуин»');
    expect(dlg.querySelector('.pv')?.getAttribute('data-skin-scope')).toBe('halloween');
  });

  it('поиск по названию и пояснению: без регистра, «ё» как «е»; ничего не нашлось — подсказка', async () => {
    open();
    const field = screen.getByRole('textbox', { name: 'Поиск образа' });
    await user.type(field, 'КИБЕР');
    expect(cards().map((c) => c.getAttribute('data-skin-option'))).toEqual(['cyber']);
    await user.clear(field);
    await user.type(field, 'елка');
    expect(cards().map((c) => c.getAttribute('data-skin-option'))).toEqual(['christmas']); // «Ёлка, снежинки и подарки»
    await user.clear(field);
    await user.type(field, 'такогообразанет');
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
  });

  it('раздел: кнопка-фильтр оставляет только свои образы раздела', async () => {
    open();
    await user.click(chip('Праздники'));
    expect(chip('Праздники').getAttribute('aria-pressed')).toBe('true');
    expect(cards().map((c) => c.getAttribute('data-skin-option'))).toEqual(SKINS.filter((s) => s.group === 'holiday').map((s) => s.id));
    await user.click(chip('Все'));
    expect(cards()).toHaveLength(SKINS.length);
  });

  it('избранное: звёздочка добавляет и убирает образ, выбор хранится на устройстве', async () => {
    open();
    await user.click(chip('Избранное'));
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('В избранном пока пусто')).toBeInTheDocument();
    await user.click(chip('Все'));
    await user.click(screen.getByRole('button', { name: 'В избранное: Гонки' }));
    await user.click(screen.getByRole('button', { name: 'В избранное: Океан' }));
    expect(JSON.parse(localStorage.getItem('finora-skin-favs') ?? '[]')).toEqual(['racing', 'ocean']);
    await user.click(chip('Избранное'));
    expect(cards().map((c) => c.getAttribute('data-skin-option')).sort()).toEqual(['ocean', 'racing']);
    await user.click(screen.getByRole('button', { name: 'Убрать из избранного: Гонки' }));
    expect(cards().map((c) => c.getAttribute('data-skin-option'))).toEqual(['ocean']);
  });
});

describe('свой образ', () => {
  const build = async () => {
    open();
    await user.click(document.querySelector('[data-testid="skin-create"]') as HTMLElement);
    return findByRole('dialog', { name: 'Свой образ' });
  };

  it('конструктор: цвет, черты и название; «Сохранить и применить» записывает образ на устройство и ставит его', async () => {
    const dlg = await build();
    const name = screen.getByRole('textbox', { name: 'Название' });
    await user.clear(name);
    await user.type(name, 'Моя зелень');
    await user.click(screen.getByRole('button', { name: 'Зелёный' }));
    await user.click(screen.getByRole('button', { name: 'Круглые формы' }));
    await user.click(screen.getByRole('button', { name: 'Меню-остров' }));
    await user.click(screen.getByRole('button', { name: 'Билет' }));
    await user.click(screen.getByRole('button', { name: 'Пузыри' }));
    await user.click(screen.getByRole('button', { name: 'Точки' }));
    await user.click(screen.getByRole('button', { name: 'Oswald' }));
    // маленький «экран» в окне меняется по ходу
    expect(dlg.querySelector('.pv')?.getAttribute('data-pv-nav')).toBe('island');
    expect(html.hasAttribute('data-skin')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Сохранить и применить' }));
    await waitFor(() => expect(html.getAttribute('data-skin')).toBe('custom'));
    expect(localStorage.getItem('finora-skin')).toBe('custom');
    const saved = readCustomSkins();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Моя зелень', hex: '#059669', hex2: null, traits: 'round solid island ticket smooth bubbles', icons: null, bgPhoto: false, heroPhoto: false });
    expect(saved[0]?.head).toContain("'Oswald'");
    expect(saved[0]?.pattern).toContain('radial-gradient');
    // палитра и черты стоят на странице
    expect(html.style.getPropertyValue('--cs-brand-l')).toMatch(/^\d+ \d+ \d+$/);
    expect(html.style.getPropertyValue('--skin-head')).toContain("'Oswald'");
    expect([html.getAttribute('data-shape'), html.getAttribute('data-nav'), html.getAttribute('data-hero'), html.getAttribute('data-scene')]).toEqual(['round', 'island', 'ticket', 'bubbles']);
    // в витрине появился раздел «Свои образы», образ выбран
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Свои образы' })).toBeInTheDocument());
    expect(current()).toEqual([`my:${saved[0]?.id}`]);
  });

  it('пустое название не сохраняется: конструктор просит его дать', async () => {
    await build();
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить и применить' }));
    expect(screen.getByRole('alert').textContent).toContain('Дайте образу название');
    expect(readCustomSkins()).toHaveLength(0);
  });

  it('удаление выбранного своего образа возвращает «Классику» и убирает его переменные со страницы', async () => {
    await build();
    await user.click(screen.getByRole('button', { name: 'Сохранить и применить' }));
    await waitFor(() => expect(html.getAttribute('data-skin')).toBe('custom'));
    const id = readCustomSkins()[0]?.id;
    await user.click(card(`my:${id}`));
    await user.click(await findByRole('button', { name: 'Удалить' }));
    expect(readCustomSkins()).toHaveLength(0);
    expect(html.hasAttribute('data-skin')).toBe(false);
    expect(html.style.getPropertyValue('--cs-brand-l')).toBe('');
    expect(localStorage.getItem('finora-skin')).toBe('classic');
    expect(current()).toEqual(['classic']);
  });

  it('сохранённый свой образ применяется при запуске и переживает перезагрузку', async () => {
    await build();
    await user.click(screen.getByRole('button', { name: 'Красный' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить и применить' }));
    await waitFor(() => expect(html.getAttribute('data-skin')).toBe('custom'));
    const brand = html.style.getPropertyValue('--cs-brand-l');
    // «перезагрузка»: со страницы всё снято, приложение стартует заново
    for (const a of TRAIT_ATTRS) html.removeAttribute(a);
    const { applySkin, readSkinPref } = await import('@/theme');
    act(() => applySkin(readSkinPref()));
    expect(html.getAttribute('data-skin')).toBe('custom');
    expect(html.style.getPropertyValue('--cs-brand-l')).toBe(brand);
  });
});
