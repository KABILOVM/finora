/**
 * Сезонные эффекты: что летает поверх содержимого по времени года и погоде и как ложится на блоки (src/season/engine.ts). Здесь
 * только выбор эффекта — чистые функции без страницы и часов; этот файл лежит в основном, поэтому он маленький, а рисование
 * грузится отдельно.
 */

/** Время года. */
export type CalendarSeason = 'winter' | 'spring' | 'summer' | 'autumn';
/** Эффект: время года или погода (дождь, ливень, метель). Погода показывается только в режиме «Авто» и по сохранённому прогнозу. */
export type SeasonKind = CalendarSeason | 'rain' | 'downpour' | 'blizzard';
/** Выбор человека (Настройки → Оформление): по дате и погоде, один сезон круглый год или выключено. */
export type SeasonPref = 'auto' | CalendarSeason | 'off';

export const SEASON_PREFS: readonly SeasonPref[] = ['auto', 'winter', 'spring', 'summer', 'autumn', 'off'];
export const DEFAULT_SEASON_PREF: SeasonPref = 'auto';

export const isSeasonPref = (v: string | null): v is SeasonPref => v !== null && (SEASON_PREFS as readonly string[]).includes(v);

/** Время года по дате: календарные сезоны северного полушария (декабрь–февраль — зима). Берётся местная дата устройства. */
export function seasonOf(now: Date): CalendarSeason {
  const month = now.getMonth() + 1;
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

/**
 * Эффект по коду погоды WMO (так отвечает Open-Meteo, см. features/weather/conditions.ts); null — погода эффекта не даёт.
 * Дождь любой силы — дождь, ливень и гроза — ливень. Слабый снег — обычный снегопад, снег и снегопад — метель.
 */
export function weatherEffect(code: number | null): SeasonKind | null {
  if (code === null || !Number.isFinite(code)) return null;
  if (code === 65 || code === 81 || code === 82 || code === 95 || code === 96 || code === 99) return 'downpour';
  if ((code >= 51 && code <= 57) || code === 61 || code === 63 || code === 66 || code === 67 || code === 80) return 'rain';
  if (code === 71 || code === 77) return 'winter';
  if (code === 73 || code === 75 || code === 85 || code === 86) return 'blizzard';
  return null;
}

/** Живые фоны образов без своих частиц: нет фона или он целиком нарисован в CSS (src/styles/look.css). */
const NO_PARTICLES: readonly string[] = ['none', 'aurora', 'grid', 'lights'];
/** Частицы образа того же рода, что у эффекта: их эффект заменяет (снег образа зимой ложится на блоки, как сезонный). */
const SAME_KIND: Readonly<Record<SeasonKind, string | null>> = {
  winter: 'snow',
  spring: 'petals',
  summer: null,
  autumn: 'leaves',
  rain: 'rain',
  downpour: 'rain',
  blizzard: 'snow',
};

/**
 * Какой эффект показать сейчас; null — никакого. Эффектов нет, если человек выключил «Живой фон и эффекты», у устройства включено
 * «уменьшить движение» или выбрано «Выкл». «Авто» берёт погоду (`weather`, если она даёт эффект), иначе сезон по дате, но не трогает
 * образ со своими частицами другого рода (звёзды, сердца, искры): их человек выбрал сам. Сезон, выбранный явно, показывается всегда
 * и погодой не перебивается.
 */
export function activeSeason(i: { pref: SeasonPref; fx: boolean; reduced: boolean; scene: string; now: Date; weather: SeasonKind | null }): SeasonKind | null {
  if (!i.fx || i.reduced || i.pref === 'off') return null;
  if (i.pref !== 'auto') return i.pref;
  const want = i.weather ?? seasonOf(i.now);
  return NO_PARTICLES.includes(i.scene) || i.scene === SAME_KIND[want] ? want : null;
}
