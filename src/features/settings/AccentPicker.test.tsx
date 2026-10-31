import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fire, render, screen, user } from '@/components/testUtils';
import { PALETTE_KEYS } from '@/lib/palette';
import { ACCENTS, type AccentId } from '@/theme';
import { AccentPicker } from './AccentPicker';
import { AppearanceSection } from './AppearanceSection';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const presetNames = ACCENTS.map((a) => a.label);
const radios = () => screen.getAllByRole('radio', { name: new RegExp(`^(${[...presetNames, 'Свой цвет'].join('|')})$`) });
const checkedName = () => screen.getAllByRole('radio', { checked: true }).map((r) => r.getAttribute('aria-label'));
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const code = () => screen.getByRole('textbox', { name: 'Код цвета' });
const colorInput = () => document.querySelector<HTMLInputElement>('input[type="color"]')!;
const hueInput = () => document.querySelector<HTMLInputElement>('input[type="range"]')!;
const panel = () => document.querySelector('[data-testid="custom-accent"]');
const accentName = () => document.querySelector('[data-testid="accent-name"]');
/** Меняет значение поля так, как это делает браузер (в обход «запоминалки» React), и сообщает об этом событием input. */
function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  fire(el, new Event('input', { bubbles: true }));
}

/** Управляемая обёртка: выбор хранится в состоянии, как в настройках. */
function Harness({
  initial = 'violet',
  custom = false,
  onChange,
  onCustom,
}: {
  initial?: AccentId;
  custom?: boolean;
  onChange?: (id: AccentId) => void;
  onCustom?: (hex: string) => void;
}) {
  const [id, setId] = useState<AccentId>(initial);
  const [hex, setHex] = useState<string | null>(null);
  return (
    <AccentPicker
      value={id}
      onChange={(next) => {
        setId(next);
        onChange?.(next);
      }}
      customHex={hex}
      onCustomChange={
        custom
          ? (h) => {
              setHex(h);
              setId('custom');
              onCustom?.(h);
            }
          : undefined
      }
    />
  );
}

describe('AccentPicker', () => {
  it('группа «Цвет акцента»: все готовые цвета по порядку, отмечен выбранный, название выбранного написано словами', () => {
    render(<Harness initial="green" />);
    expect(screen.getByRole('radiogroup', { name: 'Цвет акцента' })).toBeInTheDocument();
    expect(radios().map((r) => r.getAttribute('aria-label'))).toEqual(presetNames);
    expect(checkedName()).toEqual(['Зелёный']);
    expect(accentName()?.textContent).toBe('Зелёный');
  });

  it('цветов много: больше двадцати, фиолетовый первый; «Свой цвет» — последний, когда он доступен', () => {
    render(<Harness custom />);
    const names = radios().map((r) => r.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(20);
    expect(names[0]).toBe('Фиолетовый');
    expect(names.at(-1)).toBe('Свой цвет');
  });

  it('без обработчика своего цвета его в списке нет', () => {
    render(<Harness />);
    expect(screen.queryByRole('radio', { name: 'Свой цвет' })).toBeNull();
  });

  it('клик выбирает акцент и сообщает о выборе', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Синий' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('blue');
    expect(checkedName()).toEqual(['Синий']);
  });

  it('новые цвета выбираются так же', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Изумрудный' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('emerald');
    expect(accentName()?.textContent).toBe('Изумрудный');
  });

  it('выбранный отмечен не только цветом: на образце галочка, у остальных её нет', () => {
    render(<Harness initial="orange" />);
    for (const r of radios()) {
      const hasCheck = r.querySelector('svg') !== null;
      expect(hasCheck, r.getAttribute('aria-label') ?? '').toBe(r.getAttribute('aria-checked') === 'true');
    }
  });

  it('образец каждого готового акцента помечен своим data-accent (стили образца берутся из index.css)', () => {
    render(<Harness />);
    const marks = radios()
      .map((r) => r.querySelector('[data-accent]')?.getAttribute('data-accent'))
      .filter((m) => m !== undefined);
    expect(marks).toEqual(ACCENTS.map((a) => a.id));
  });

  it('у каждой кнопки есть имя для скринридера, а область касания не меньше 44 px', () => {
    render(<Harness custom />);
    for (const r of radios()) {
      expect(r.getAttribute('aria-label') ?? '').not.toBe('');
      expect(r.className).toContain('min-h-[44px]');
    }
  });

  it('в группу заходят одним Tab: доступен только выбранный', () => {
    render(<Harness initial="teal" />);
    const tabbable = radios().filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable.map((r) => r.getAttribute('aria-label'))).toEqual(['Бирюзовый']);
  });

  it('стрелки переключают по кругу и переносят фокус на выбранный', async () => {
    render(<Harness />);
    const first = screen.getByRole('radio', { name: 'Фиолетовый' });
    act(() => first.focus());
    await user.keyboard('{ArrowRight}');
    expect(checkedName()).toEqual([presetNames[1]]);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: presetNames[1]! }));
    await user.keyboard('{ArrowLeft}{ArrowLeft}'); // назад через начало списка — на последний
    expect(checkedName()).toEqual([presetNames.at(-1)]);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: presetNames.at(-1)! }));
    await user.keyboard('{ArrowDown}'); // вниз — как «дальше»: снова с начала
    expect(checkedName()).toEqual(['Фиолетовый']);
  });

  describe('свой цвет', () => {
    it('первое нажатие выбирает стартовый цвет и открывает панель с выбором цвета, оттенком и кодом', async () => {
      const onCustom = vi.fn();
      render(<Harness custom onCustom={onCustom} />);
      expect(panel()).toBeNull();
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      expect(onCustom).toHaveBeenCalledTimes(1);
      expect(onCustom.mock.calls[0]?.[0]).toMatch(/^#[0-9a-f]{6}$/);
      expect(checkedName()).toEqual(['Свой цвет']);
      expect(panel()).not.toBeNull();
      expect(colorInput()).toBeTruthy();
      expect(hueInput()).toBeTruthy();
      expect(code()).toHaveValue(onCustom.mock.calls[0]?.[0]);
    });

    it('код цвета применяется, когда он целый; пока набирают — ничего не меняется; ошибочный код объясняется', async () => {
      const onCustom = vi.fn();
      render(<Harness custom onCustom={onCustom} />);
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      onCustom.mockClear();
      await user.clear(code());
      await user.type(code(), '#1234');
      expect(onCustom).not.toHaveBeenCalled(); // короткий и неполный код не применяется на лету
      expect(code()).toHaveValue('#1234');
      expect(screen.queryByRole('alert')).toBeNull();
      await user.type(code(), '56');
      expect(onCustom).toHaveBeenCalledExactlyOnceWith('#123456');
      await user.type(code(), 'z');
      expect(screen.getByRole('alert').textContent).toContain('#6d5ef0');
      expect(code()).toHaveAttribute('aria-invalid', 'true');
      expect(onCustom).toHaveBeenCalledTimes(1);
      await user.clear(code());
      await user.type(code(), '#FF8800');
      expect(onCustom).toHaveBeenLastCalledWith('#ff8800');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(accentName()?.textContent).toBe('Свой цвет #ff8800');
    });

    it('при уходе из поля короткий код (#f80) раскрывается и применяется, а испорченный заменяется прежним цветом', async () => {
      const onCustom = vi.fn();
      render(<Harness custom onCustom={onCustom} />);
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      await user.clear(code());
      await user.type(code(), '#f80');
      act(() => code().blur());
      expect(onCustom).toHaveBeenLastCalledWith('#ff8800');
      expect(code()).toHaveValue('#ff8800');
      await user.type(code(), '1x');
      act(() => code().blur());
      expect(code()).toHaveValue('#ff8800');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('системный выбор цвета и ползунок оттенка меняют цвет', async () => {
      const onCustom = vi.fn();
      render(<Harness custom onCustom={onCustom} />);
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      onCustom.mockClear();
      setValue(colorInput(), '#00aa55');
      expect(onCustom).toHaveBeenLastCalledWith('#00aa55');
      setValue(hueInput(), '120');
      expect(onCustom.mock.calls.at(-1)?.[0]).toMatch(/^#[0-9a-f]{6}$/);
      expect(onCustom.mock.calls.at(-1)?.[0]).not.toBe('#00aa55');
      expect(code()).toHaveValue(onCustom.mock.calls.at(-1)?.[0]);
    });

    it('выбор готового цвета закрывает панель; возврат на «Свой цвет» открывает её с прежним цветом', async () => {
      render(<Harness custom />);
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      await user.clear(code());
      await user.type(code(), '#336699');
      await user.click(screen.getByRole('radio', { name: 'Красный' }));
      expect(panel()).toBeNull();
      await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
      expect(code()).toHaveValue('#336699');
      expect(checkedName()).toEqual(['Свой цвет']);
    });
  });
});

describe('Оформление: цвет акцента', () => {
  it('выбор применяется сразу, хранится на устройстве и не мешает выбору темы', async () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Фиолетовый' })).toBeChecked();
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);

    await user.click(screen.getByRole('radio', { name: 'Розовый' }));
    expect(screen.getByRole('radio', { name: 'Розовый' })).toBeChecked();
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink');
    expect(localStorage.getItem('finora-accent')).toBe('pink');

    await user.click(screen.getByRole('radio', { name: 'Тёмная' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink'); // тема акцент не сбросила
    expect(screen.getByRole('radio', { name: 'Розовый' })).toBeChecked();
  });

  it('при открытии показывает сохранённый акцент', () => {
    localStorage.setItem('finora-accent', 'teal');
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Бирюзовый' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Фиолетовый' })).not.toBeChecked();
  });

  it('возврат к фиолетовому убирает атрибут (прежняя палитра)', async () => {
    localStorage.setItem('finora-accent', 'green');
    document.documentElement.setAttribute('data-accent', 'green');
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: 'Фиолетовый' }));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  it('свой цвет: ставит палитру на <html>, хранится на устройстве; готовый цвет её снимает', async () => {
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
    await user.clear(code());
    await user.type(code(), '#0a8f4a');

    const html = document.documentElement;
    expect(html.getAttribute('data-accent')).toBe('custom');
    expect(localStorage.getItem('finora-accent')).toBe('custom');
    expect(localStorage.getItem('finora-accent-custom')).toBe('#0a8f4a');
    for (const key of PALETTE_KEYS) expect(rootVar(`--ac-${key}`), key).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(screen.getByRole('radio', { name: 'Свой цвет' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Красный' }));
    expect(html.getAttribute('data-accent')).toBe('red');
    for (const key of PALETTE_KEYS) expect(rootVar(`--ac-${key}`), key).toBe('');
    // сам цвет не потерян: к нему можно вернуться одним нажатием
    expect(localStorage.getItem('finora-accent-custom')).toBe('#0a8f4a');
    await user.click(screen.getByRole('radio', { name: 'Свой цвет' }));
    expect(html.getAttribute('data-accent')).toBe('custom');
    expect(code()).toHaveValue('#0a8f4a');
  });

  it('при открытии показывает сохранённый свой цвет', () => {
    localStorage.setItem('finora-accent', 'custom');
    localStorage.setItem('finora-accent-custom', '#aa3377');
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Свой цвет' })).toBeChecked();
    expect(code()).toHaveValue('#aa3377');
  });
});
