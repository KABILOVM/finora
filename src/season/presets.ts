import type { SeasonKind } from './season';

/**
 * Описания сезонных эффектов: только числа и названия, рисует их engine.ts (картинки частиц — sprites.ts). У зимы, весны и осени
 * одно устройство: что-то падает, ложится на верхний край блоков, стряхивается нажатием, а у некоторых блоков в углу есть
 * украшение. Лето другое: жара поверх страницы и немного пуха, который только летает, ничего не ложится и не стряхивается.
 */

/** Как лежит на блоке: сплошной сугроб (снег), россыпь отдельных частиц (лепестки, листья) или никак (летний пух только летает). */
export type PileKind = 'cap' | 'scatter' | 'none';
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
  pile: PileKind;
  /** Жара: поверх страницы тёплое свечение солнца и медленно поднимающееся марево (чистый CSS, см. look.css, «Сезонные эффекты»). */
  haze: boolean;
  /** Доля частиц, которые, долетев до края блока, ложатся на него (остальные пролетают мимо). */
  stick: number;
  /** Сколько снега добавляет одна снежинка (высота столбика, px) — только для сугроба. */
  grow: number;
  accent: AccentKind;
  /** Насколько быстро падает стряхнутое, px/с²: снег тяжёлый, листья и пух планируют. */
  gravity: number;
}

export const SEASON_PRESETS: Readonly<Record<SeasonKind, SeasonPreset>> = {
  winter: { count: 42, size: [1.3, 3.4], alpha: [0.6, 0.95], vx: [-8, 8], vy: [20, 52], sway: 16, spin: 0.04, flutter: false, pile: 'cap', haze: false, stick: 0.3, grow: 2.4, accent: 'frost', gravity: 520 },
  spring: { count: 16, size: [4.5, 7.5], alpha: [0.7, 0.92], vx: [-20, 8], vy: [24, 50], sway: 28, spin: 0.22, flutter: true, pile: 'scatter', haze: false, stick: 0.35, grow: 0, accent: 'sprout', gravity: 170 },
  summer: { count: 8, size: [4.5, 7], alpha: [0.6, 0.9], vx: [8, 26], vy: [6, 16], sway: 22, spin: 0.04, flutter: false, pile: 'none', haze: true, stick: 0, grow: 0, accent: 'none', gravity: 90 },
  autumn: { count: 14, size: [6, 9.5], alpha: [0.75, 0.95], vx: [6, 30], vy: [28, 58], sway: 32, spin: 0.26, flutter: true, pile: 'scatter', haze: false, stick: 0.35, grow: 0, accent: 'leaves', gravity: 210 },
};

/** Наибольшая высота сугроба в середине блока, px. */
export const CAP_HEIGHT = 12;
/** Россыпь: одна лежащая частица на столько px ширины блока и не больше стольких на блок. */
export const SCATTER_SPACING = 15;
export const SCATTER_MAX = 26;
