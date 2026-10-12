import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';
import { render } from './testUtils';

const stops = (svg: Element) => [...svg.querySelectorAll('stop')];

describe('Logo', () => {
  it('знак — декоративная картинка: скрыт от скринридера и не берёт фокус', () => {
    const { container } = render(<Logo size={40} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('width')).toBe('40');
  });

  it('цвета плитки и низа значка берутся из палитры акцента: на нужных остановках градиента классы logo-*', () => {
    const { container } = render(<Logo />);
    const classes = stops(container).map((s) => s.getAttribute('class'));
    // 2 остановки градиента плитки, 2 — блика (белый), 2 — градиента самого значка: белый сверху и цвет акцента снизу
    expect(classes).toEqual(['logo-from', 'logo-to', null, null, null, 'logo-glyph']);
  });

  it('если стили не подключились, знак остаётся прежним фиолетовым (значения в атрибутах — как в public/icon.svg)', () => {
    const { container } = render(<Logo />);
    const fallback = (cls: string) => container.querySelector(`stop.${cls}`)?.getAttribute('stop-color');
    expect(fallback('logo-from')).toBe('#6a6cff');
    expect(fallback('logo-to')).toBe('#9a5cf7');
    expect(fallback('logo-glyph')).toBe('#e4defd');
  });

  it('у каждого экземпляра свои id градиентов, и рисунок ссылается именно на них', () => {
    const { container } = render(
      <>
        <Logo />
        <Logo />
      </>,
    );
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(2);
    const ids = svgs.map((svg) => [...svg.querySelectorAll('linearGradient, radialGradient')].map((g) => g.id));
    expect(ids[0]).toHaveLength(3);
    expect(new Set(ids.flat()).size).toBe(6); // ни один id не повторяется между знаками
    for (const [i, svg] of svgs.entries()) {
      const used = [...svg.querySelectorAll('[fill^="url(#"], [stroke^="url(#"]')].map((el) => (el.getAttribute('fill') ?? el.getAttribute('stroke') ?? '').replace(/^url\(#(.+)\)$/, '$1'));
      expect(used.every((id) => ids[i]?.includes(id))).toBe(true);
    }
  });
});
