import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { SKIN_GROUPS, SKINS } from '@/skins';
import { AppearanceSection } from './AppearanceSection';
import { SkinPicker } from './SkinPicker';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('data-skin');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const options = () => screen.getAllByRole('radio').filter((r) => r.hasAttribute('data-skin-option'));
const note = () => document.querySelector('[data-testid="skin-colors-note"]');
const checked = () => options().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('data-skin-option'));

describe('выбор образа', () => {
  it('показывает все образы из SKINS, выбран переданный', () => {
    render(<SkinPicker value="barca" onChange={() => undefined} />);
    expect(options().map((o) => o.getAttribute('data-skin-option'))).toEqual(SKINS.map((s) => s.id));
    expect(checked()).toEqual(['barca']);
    expect(screen.getByRole('radiogroup', { name: 'Образ' })).toBeInTheDocument();
  });

  it('у каждого образа есть название и пояснение (внутри его карточки: название «Футбол» есть и у раздела)', () => {
    render(<SkinPicker value="classic" onChange={() => undefined} />);
    for (const skin of SKINS) {
      const card = document.querySelector(`[data-skin-option="${skin.id}"]`);
      expect(card?.textContent, skin.id).toContain(skin.label);
      expect(card?.textContent, skin.id).toContain(skin.hint);
    }
  });

  it('образов много, они разложены по разделам: «Футбол», «Кино и аниме», «Национальные», «Стили»; у каждого образа своя группа', () => {
    render(<SkinPicker value="classic" onChange={() => undefined} />);
    expect(SKINS.length).toBeGreaterThan(15);
    for (const group of SKIN_GROUPS) {
      const box = document.querySelector(`[data-skin-group="${group.id}"]`);
      expect(box, group.id).not.toBeNull();
      if (group.id !== 'classic') expect(box?.textContent).toContain(group.label);
      const inside = [...(box?.querySelectorAll('[data-skin-option]') ?? [])].map((b) => b.getAttribute('data-skin-option'));
      expect(inside, group.id).toEqual(SKINS.filter((s) => s.group === group.id).map((s) => s.id));
    }
    // в списке все нужные образы
    for (const id of ['barca', 'real', 'argentina', 'messi', 'spain', 'cr7', 'football', 'shinobi', 'akatsuki', 'spider', 'comic', 'tajik', 'pamir', 'kawaii', 'aesthetic', 'racing', 'cyber', 'pixel']) {
      expect(SKINS.map((s) => s.id), id).toContain(id);
    }
  });

  it('нажатие выбирает образ', async () => {
    const seen: string[] = [];
    render(<SkinPicker value="classic" onChange={(id) => seen.push(id)} />);
    await user.click(screen.getByRole('radio', { name: /Реал Мадрид/ }));
    expect(seen).toEqual(['real']);
  });

  it('в группу заходят одним Tab (выбранный образ), внутри — стрелками, по кругу', async () => {
    const seen: string[] = [];
    render(<SkinPicker value="classic" onChange={(id) => seen.push(id)} />);
    expect(options().map((o) => o.tabIndex)).toEqual([0, ...SKINS.slice(1).map(() => -1)]);
    options()[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(seen).toEqual(['barca']);
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(seen).toEqual(['barca', 'classic', SKINS[SKINS.length - 1]?.id]); // назад с первого — на последний (по всему списку, через разделы)
  });
});

describe('«Оформление»: образ и цвет акцента', () => {
  it('по умолчанию «Классика»: цвет акцента виден, пояснения про образ нет', () => {
    render(<AppearanceSection />);
    expect(checked()).toEqual(['classic']);
    expect(screen.getByText('Цвет акцента')).toBeInTheDocument();
    expect(note()).toBeNull();
  });

  it('выбор клубного образа ставит data-skin, прячет выбор цвета и объясняет почему', async () => {
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: /Барселона/ }));
    expect(document.documentElement.getAttribute('data-skin')).toBe('barca');
    expect(localStorage.getItem('finora-skin')).toBe('barca');
    expect(screen.queryByText('Цвет акцента')).toBeNull();
    expect(note()?.textContent).toContain('Цвета задаёт образ «Барселона»');
  });

  it('возврат к «Классике» убирает атрибут и снова показывает выбор цвета; выбранный раньше акцент сохранён', async () => {
    localStorage.setItem('finora-accent', 'teal');
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: /Реал Мадрид/ }));
    await user.click(screen.getByRole('radio', { name: /Классика/ }));
    expect(document.documentElement.hasAttribute('data-skin')).toBe(false);
    expect(screen.getByText('Цвет акцента')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Бирюзовый', checked: true })).toBeInTheDocument();
  });

  it('сохранённый образ показывается выбранным при открытии настроек', () => {
    localStorage.setItem('finora-skin', 'real');
    render(<AppearanceSection />);
    expect(checked()).toEqual(['real']);
    expect(note()?.textContent).toContain('«Реал Мадрид»');
  });

  it('каждый образ из списка можно выбрать в настройках: атрибут data-skin и сохранённое значение совпадают', async () => {
    render(<AppearanceSection />);
    for (const skin of SKINS.slice(1)) {
      await user.click(screen.getByRole('radio', { name: new RegExp(`^${skin.label}`) }));
      expect(document.documentElement.getAttribute('data-skin'), skin.id).toBe(skin.id);
      expect(localStorage.getItem('finora-skin'), skin.id).toBe(skin.id);
    }
  });
});
