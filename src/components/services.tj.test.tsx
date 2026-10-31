import { describe, expect, it, vi } from 'vitest';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { Glyph } from './Glyph';
import { GlyphPicker } from './GlyphPicker';
import { resolveGlyph } from './glyphs';
import { SERVICES, SERVICE_GROUPS, findServiceByName, serviceImageUrl } from './services';
import { render, screen, user } from './testUtils';

// Настоящих иконок в репозитории может не быть (их кладут в public/tj/), поэтому каталог таджикских сервисов подменён двумя записями.
vi.mock('./tjData', () => ({
  TJ_GROUPS: [
    { id: 'tjbank', label: 'Банки Таджикистана' },
    { id: 'tjpay', label: 'Связь и платежи Таджикистана' },
  ],
  TJ_SERVICES: [
    { id: 'eskhata', name: 'Эсхата', group: 'tjbank', color: '#ffffff', img: 'tj/eskhata.png', keys: ['eskhata', 'эсхата банк'] },
    { id: 'fmfb', name: 'Первый микрофинансовый банк', group: 'tjbank', color: '#ffffff', img: 'tj/fmfb.png', keys: ['пмфб'] },
  ],
}));

describe('таджикские банки и сервисы: значки-картинки', () => {
  it('идут в каталоге первыми; группа без иконок (связь и платежи) не показывается', () => {
    expect(SERVICES.slice(0, 2).map((s) => s.id)).toEqual(['eskhata', 'fmfb']);
    expect(SERVICE_GROUPS[0]).toEqual({ id: 'tjbank', label: 'Банки Таджикистана' });
    expect(SERVICE_GROUPS.some((g) => g.id === 'tjpay')).toBe(false);
  });

  it('значение «s:eskhata» — сервис; плитка — картинка из public/tj, а не логотип-вектор', () => {
    expect(resolveGlyph('s:eskhata')).toEqual({ kind: 'service', id: 'eskhata' });
    const { container } = render(<Glyph value="s:eskhata" size={40} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', serviceImageUrl({ img: 'tj/eskhata.png' }));
    expect(img?.getAttribute('src')).toMatch(/tj\/eskhata\.png$/);
    expect(img).toHaveAttribute('alt', '');
    expect(container.querySelector('svg')).toBeNull();
    expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('в выборе значка: группа таджикских банков первая, выбор отдаёт «s:id»', async () => {
    const onChange = vi.fn();
    render(<GlyphPicker value="i:home" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Сервисы' }));
    const groups = SERVICE_GROUPS.map((g) => g.label);
    expect(groups[0]).toBe('Банки Таджикистана');
    expect(screen.getByRole('group', { name: 'Банки Таджикистана' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Связь и платежи Таджикистана' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Эсхата' }));
    expect(onChange).toHaveBeenCalledWith('s:eskhata');
  });

  it('подсказка по названию: по названию, слову и сокращению', () => {
    expect(findServiceByName('Эсхата')?.id).toBe('eskhata');
    expect(findServiceByName('Эсхата банк')?.id).toBe('eskhata');
    expect(findServiceByName('Перевод Eskhata')?.id).toBe('eskhata');
    expect(findServiceByName('ПМФБ')?.id).toBe('fmfb');
    expect(suggestGlyph('Кредит ПМФБ')).toBe('s:fmfb'); // сервис важнее слова «кредит»
    expect(findServiceByName('Банк')).toBeUndefined();
  });
});
