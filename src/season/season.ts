/**
 * Сезонные эффекты: что летает поверх содержимого по времени года и ложится на блоки (src/season/engine.ts). Здесь только выбор
 * сезона — чистые функции без страницы и часов; этот файл лежит в основном, поэтому он маленький, а рисование грузится отдельно.
 */

export type SeasonKind = 'winter' | 'spring' | 'summer' | 'autumn';
/** Выбор человека (Настройки → Оформление): по дате, один сезон круглый год или выключено. */
export type SeasonPref = 'auto' | SeasonKind | 'off';

export const SEASON_PREFS: readonly SeasonPref[] = ['auto', 'winter', 'spring', 'summer', 'autumn', 'off'];
export const DEFAULT_SEASON_PREF: SeasonPref = 'auto';

export const isSeasonPref = (v: string | null): v is SeasonPref => v !== null && (SEASON_PREFS as readonly string[]).includes(v);

/** Время года по дате: календарные сезоны северного полушария (декабрь–февраль — зима). Берётся местная дата устройства. */
export function seasonOf(now: Date): SeasonKind {
  const month = now.getMonth() + 1;
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

/** Живые фоны образов без своих частиц: нет фона или он целиком нарисован в CSS (src/styles/look.css). */
const NO_PARTICLES: readonly string[] = ['none', 'aurora', 'grid', 'lights'];
/** Частицы образа того же рода, что сезонные: их сезонный слой заменяет (снег образа зимой ложится на блоки, как сезонный). */
const SAME_KIND: Readonly<Record<SeasonKind, string | null>> = { winter: 'snow', spring: 'petals', summer: null, autumn: 'leaves' };

/**
 * Какой сезонный эффект показать сейчас; null — никакого. Эффектов нет, если человек выключил «Живой фон и эффекты», у устройства
 * включено «уменьшить движение» или выбрано «Выкл». «Авто» берёт сезон по дате, но не трогает образ со своими частицами другого рода
 * (звёзды, сердца, искры): их человек выбрал сам. Сезон, выбранный явно, показывается всегда.
 */
export function activeSeason(i: { pref: SeasonPref; fx: boolean; reduced: boolean; scene: string; now: Date }): SeasonKind | null {
  if (!i.fx || i.reduced || i.pref === 'off') return null;
  if (i.pref !== 'auto') return i.pref;
  const season = seasonOf(i.now);
  return NO_PARTICLES.includes(i.scene) || i.scene === SAME_KIND[season] ? season : null;
}
