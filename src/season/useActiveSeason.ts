import { useSyncExternalStore } from 'react';
import { useFxPref, useScene, useSeasonPref } from '@/theme';
import { activeSeason, weatherEffect, type SeasonKind } from './season';
import { useWeatherCode } from './useWeatherCode';

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void): (() => void) => {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
};
const readMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

/** У устройства включено «уменьшить движение»; компонент обновляется сам, когда настройку меняют. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, readMotion, () => false);
}

/**
 * Эффект (сезон или погода), который сейчас нужно показать; null — никакого (правила — в activeSeason). Одно значение для слоя сезона и для
 * живого фона образа: когда сезон показан, частицы образа не рисуются — летает что-то одно.
 */
export function useActiveSeason(): SeasonKind | null {
  const scene = useScene();
  const [fx] = useFxPref();
  const [pref] = useSeasonPref();
  const reduced = useReducedMotion();
  const code = useWeatherCode();
  // погода ещё читается: в «Авто» пока ничего не показываем, чтобы осень не мигнула перед дождём
  if (pref === 'auto' && code === undefined) return null;
  return activeSeason({ pref, fx, reduced, scene, now: new Date(), weather: weatherEffect(code ?? null) });
}
