import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { SKINS } from '@/skins';
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

  it('у каждого образа есть название и пояснение', () => {
    render(<SkinPicker value="classic" onChange={() => undefined} />);
    for (const skin of SKINS) {
      expect(screen.getByText(skin.label)).toBeInTheDocument();
      expect(screen.getByText(skin.hint)).toBeInTheDocument();
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
    expect(options().map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    options()[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(seen).toEqual(['barca']);
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(seen).toEqual(['barca', 'classic', 'real']); // назад с первого — на последний
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
});
