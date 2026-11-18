import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@/components/testUtils';
import { SceneHost } from '@/scene/SceneHost';
import { readSeasonPref, saveFxPref, saveSeasonPref, saveSkinPref } from '@/theme';
import { SeasonHost } from './SeasonHost';

// погода берётся из хранилища города; здесь её подставляет тест
const weather = vi.hoisted(() => ({ code: null as number | null | undefined }));
vi.mock('./useWeatherCode', () => ({ useWeatherCode: () => weather.code }));

const html = document.documentElement;
const reset = () => {
  weather.code = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  for (const a of ['data-skin', 'data-look', 'data-fx', 'data-scene', 'data-shape', 'data-material', 'data-nav', 'data-hero', 'data-motion', 'style']) html.removeAttribute(a);
  document.head.innerHTML = '';
};
/** «Сегодня» — 18 ноября 2026: осень. */
beforeEach(() => {
  reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00'));
});
afterEach(reset);

const layer = () => document.querySelector('[data-season-layer]');
const sceneLayer = () => document.querySelector('[data-scene-layer]');

describe('выбор сезонных эффектов хранится на устройстве', () => {
  it('по умолчанию «Авто»; выбор запоминается; испорченное значение — снова «Авто»', () => {
    expect(readSeasonPref()).toBe('auto');
    act(() => saveSeasonPref('winter'));
    expect(readSeasonPref()).toBe('winter');
    expect(localStorage.getItem('finora-season')).toBe('winter');
    act(() => saveSeasonPref('off'));
    expect(readSeasonPref()).toBe('off');
    act(() => saveSeasonPref('auto'));
    expect(localStorage.getItem('finora-season')).toBeNull();
    localStorage.setItem('finora-season', 'метель');
    expect(readSeasonPref()).toBe('auto');
  });
});

describe('слой сезонных эффектов', () => {
  it('у «Классики» слой есть, сезон — по дате; он украшение (aria-hidden)', () => {
    act(() => saveSkinPref('classic'));
    render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('autumn');
    expect(layer()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('человек выбрал сезон — слой меняется сразу; «Выкл» — слоя нет', () => {
    act(() => saveSkinPref('classic'));
    render(<SeasonHost />);
    act(() => saveSeasonPref('winter'));
    expect(layer()?.getAttribute('data-season-layer')).toBe('winter');
    act(() => saveSeasonPref('off'));
    expect(layer()).toBeNull();
    act(() => saveSeasonPref('auto'));
    expect(layer()?.getAttribute('data-season-layer')).toBe('autumn');
  });

  it('эффекты выключены или у устройства «уменьшить движение» — слоя нет', () => {
    act(() => saveSkinPref('classic'));
    const view = render(<SeasonHost />);
    act(() => saveFxPref(false));
    expect(layer()).toBeNull();
    act(() => saveFxPref(true));
    expect(layer()).not.toBeNull();
    view.unmount();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<SeasonHost />);
    expect(layer()).toBeNull();
  });

  it('образ со своими частицами другого рода: при «Авто» сезонного слоя нет, частицы образа остаются', () => {
    act(() => saveSkinPref('christmas')); // у «Нового года» свой снег, а на дворе осень
    render(
      <>
        <SceneHost />
        <SeasonHost />
      </>,
    );
    expect(layer()).toBeNull();
    expect(sceneLayer()?.getAttribute('data-scene-layer')).toBe('snow');
  });

  it('сезон заменяет частицы образа: летает что-то одно', () => {
    act(() => saveSkinPref('christmas'));
    render(
      <>
        <SceneHost />
        <SeasonHost />
      </>,
    );
    act(() => saveSeasonPref('winter'));
    expect(layer()?.getAttribute('data-season-layer')).toBe('winter');
    expect(sceneLayer()).toBeNull();
    act(() => saveSeasonPref('auto'));
    expect(layer()).toBeNull();
    expect(sceneLayer()).not.toBeNull();
  });

  it('зимой «Авто» сам заменяет снег образа сезонным: он ложится на блоки', () => {
    vi.setSystemTime(new Date('2027-01-10T12:00:00'));
    act(() => saveSkinPref('christmas'));
    render(
      <>
        <SceneHost />
        <SeasonHost />
      </>,
    );
    expect(layer()?.getAttribute('data-season-layer')).toBe('winter');
    expect(sceneLayer()).toBeNull();
  });

  it('летом поверх страницы жара: свечение солнца и волны марева; в другие сезоны её нет', async () => {
    act(() => saveSkinPref('classic'));
    act(() => saveSeasonPref('summer'));
    render(<SeasonHost />);
    // код слоя грузится отдельным файлом
    await waitFor(() => expect(document.querySelector('.season-heat')).not.toBeNull());
    expect(document.querySelector('.season-heat-sun')).not.toBeNull();
    expect(document.querySelectorAll('.season-heat-wave').length).toBeGreaterThanOrEqual(2);
    act(() => saveSeasonPref('winter'));
    expect(document.querySelector('.season-heat')).toBeNull();
    act(() => saveSeasonPref('summer'));
    expect(document.querySelector('.season-heat')).not.toBeNull();
  });

  it('«Авто»: дождливая погода — дождь с пеленой, метель — метель с порывами; ясно — снова сезон по дате', async () => {
    act(() => saveSkinPref('classic'));
    weather.code = 63; // дождь
    const view = render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('rain');
    await waitFor(() => expect(document.querySelector('.season-mist')).not.toBeNull());
    expect(document.querySelector('.season-heat')).toBeNull();
    view.unmount();

    weather.code = 75; // сильный снег
    const second = render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('blizzard');
    await waitFor(() => expect(document.querySelectorAll('.season-gust').length).toBeGreaterThanOrEqual(2));
    second.unmount();

    weather.code = 0; // ясно
    render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('autumn');
  });

  it('«Авто»: пока погода читается, ничего не мигает; выбранный вручную сезон ждать не нужно', () => {
    act(() => saveSkinPref('classic'));
    weather.code = undefined; // ещё читается
    const view = render(<SeasonHost />);
    expect(layer()).toBeNull();
    view.unmount();
    act(() => saveSeasonPref('winter'));
    render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('winter');
  });

  it('сезон, выбранный вручную, погодой не перебивается', () => {
    act(() => saveSkinPref('classic'));
    act(() => saveSeasonPref('summer'));
    weather.code = 65;
    render(<SeasonHost />);
    expect(layer()?.getAttribute('data-season-layer')).toBe('summer');
  });

  it('фон образа, нарисованный в CSS (сетка, огни), остаётся вместе с сезоном', () => {
    act(() => saveSkinPref('cyber'));
    render(
      <>
        <SceneHost />
        <SeasonHost />
      </>,
    );
    expect(sceneLayer()?.getAttribute('data-scene-layer')).toBe('grid');
    expect(layer()?.getAttribute('data-season-layer')).toBe('autumn');
  });
});
