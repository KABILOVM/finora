import type { SeasonKind } from './season';

/**
 * Описания сезонных эффектов: только числа и названия, рисует их engine.ts (картинки частиц — sprites.ts). У зимы, весны и осени
 * одно устройство: что-то падает, ложится на верхний край блоков, стряхивается нажатием, а у некоторых блоков в углу есть
 * украшение. Лето другое: жара поверх страницы и немного пуха, который только летает, ничего не ложится и не стряхивается.
 */

/**
 * Как ложится на блок: сплошной сугроб (снег), россыпь отдельных частиц (лепестки, листья), брызги (дождь: капля разбивается о край
 * блока и исчезает) или никак (летний пух только летает).
 */
export type PileKind = 'cap' | 'scatter' | 'splash' | 'none';
/**
 * Настроение поверх страницы (чистый CSS, см. look.css): жара (свечение солнца и марево), пелена дождя, порывы метели; null — нет.
 */
export type MoodKind = 'heat' | 'mist' | 'blow';
/** Украшение «в некоторых местах»: иней в углу, росток на краю, горсть опавших листьев; 'none' — у сезона его нет. */
export type AccentKind = 'frost' | 'sprout' | 'leaves' | 'none';

export interface SeasonPreset {
  /** Сколько частиц на экране телефона (390×844); на большом экране больше (particleCount). */
  count: number;
  /** Радиус частицы, px (от и до). */
  size: readonly [number, number];
  /** Непрозрачность (от и до). */
  alpha: readonly [number, number];
  /** Скорость по горизонтали и вертикали, px/с (от и до). Положительная вертикаль — вниз. */
  vx: readonly [number, number];
  vy: readonly [number, number];
  /** Покачивание из стороны в сторону, px. */
  sway: number;
  /** Вращение, оборотов в секунду (в обе стороны). */
  spin: number;
  /** Кувыркание: частица поворачивается к зрителю то плашмя, то ребром (лепестки, листья). */
  flutter: boolean;
  /** Частица вытянута по направлению полёта (капля дождя), а не крутится сама по себе. */
  along: boolean;
  pile: PileKind;
  /** Настроение страницы: у лета жара, у дождя пелена, у метели порывы ветра. */
  mood: MoodKind | null;
  /** Доля частиц, которые, долетев до края блока, ложатся на него (остальные пролетают мимо). */
  stick: number;
  /** Сколько снега добавляет одна снежинка (высота столбика, px) — только для сугроба. */
  grow: number;
  accent: AccentKind;
  /** Насколько быстро падает стряхнутое, px/с²: снег тяжёлый, листья и пух планируют. */
  gravity: number;
}

export const SEASON_PRESETS: Readonly<Record<SeasonKind, SeasonPreset>> = {
  winter: { count: 42, size: [1.3, 3.4], alpha: [0.6, 0.95], vx: [-8, 8], vy: [20, 52], sway: 16, spin: 0.04, flutter: false, along: false, pile: 'cap', mood: null, stick: 0.3, grow: 2.4, accent: 'frost', gravity: 520 },
  spring: { count: 16, size: [4.5, 7.5], alpha: [0.7, 0.92], vx: [-20, 8], vy: [24, 50], sway: 28, spin: 0.22, flutter: true, along: false, pile: 'scatter', mood: null, stick: 0.35, grow: 0, accent: 'sprout', gravity: 170 },
  summer: { count: 8, size: [4.5, 7], alpha: [0.6, 0.9], vx: [8, 26], vy: [6, 16], sway: 22, spin: 0.04, flutter: false, along: false, pile: 'none', mood: 'heat', stick: 0, grow: 0, accent: 'none', gravity: 90 },
  autumn: { count: 14, size: [6, 9.5], alpha: [0.75, 0.95], vx: [6, 30], vy: [28, 58], sway: 32, spin: 0.26, flutter: true, along: false, pile: 'scatter', mood: null, stick: 0.35, grow: 0, accent: 'leaves', gravity: 210 },
  // Погода: показывается в режиме «Авто» по сохранённому прогнозу (weatherEffect в season.ts). Ветер дует вправо: капли и снег косые.
  rain: { count: 44, size: [8, 13], alpha: [0.5, 0.85], vx: [36, 64], vy: [520, 760], sway: 0, spin: 0, flutter: false, along: true, pile: 'splash', mood: 'mist', stick: 0.5, grow: 0, accent: 'none', gravity: 400 },
  downpour: { count: 66, size: [10, 16], alpha: [0.55, 0.9], vx: [70, 120], vy: [760, 1050], sway: 0, spin: 0, flutter: false, along: true, pile: 'splash', mood: 'mist', stick: 0.55, grow: 0, accent: 'none', gravity: 400 },
  blizzard: { count: 70, size: [0.9, 2.1], alpha: [0.7, 1], vx: [110, 230], vy: [140, 300], sway: 22, spin: 0, flutter: false, along: true, pile: 'cap', mood: 'blow', stick: 0.55, grow: 3.4, accent: 'frost', gravity: 520 },
};

/** Наибольшая высота сугроба в середине блока, px. */
export const CAP_HEIGHT = 12;
/** Россыпь: одна лежащая частица на столько px ширины блока и не больше стольких на блок. */
export const SCATTER_SPACING = 15;
export const SCATTER_MAX = 26;
