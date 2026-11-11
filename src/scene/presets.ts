import type { SkinScene } from '@/skinCore';

/**
 * Живые фоны образов: что летает позади содержимого. Здесь только описания (числа и названия фигур), рисует их SceneCanvas.tsx.
 * Частиц немного (десятки), они полупрозрачные и лежат под содержимым: фон создаёт настроение и не мешает читать цифры.
 */

/** Фигура частицы. */
export type Shape = 'dot' | 'flake' | 'petal' | 'leaf' | 'heart' | 'star' | 'streak' | 'square' | 'bubble' | 'spark' | 'bokeh' | 'chip' | 'candle';

/**
 * Откуда берётся цвет частицы: переменная темы (brand, accent, line — цвет рамки образа, text, income, expense) или готовый цвет «R G B».
 * Переменные читаются со страницы, поэтому фон сам подстраивается под образ, акцент и тёмную тему.
 */
export type Tint = 'brand' | 'accent' | 'line' | 'text' | 'income' | 'expense' | `${number} ${number} ${number}`;

export interface ScenePreset {
  shape: Shape;
  /** Сколько частиц на экране телефона (390×844); на большом экране их больше, но не больше 90. */
  count: number;
  tints: readonly Tint[];
  /** Размер, px (от и до). */
  size: readonly [number, number];
  /** Непрозрачность (от и до). */
  alpha: readonly [number, number];
  /** Скорость по горизонтали и вертикали, px/с (от и до). Положительная вертикаль — вниз. */
  vx: readonly [number, number];
  vy: readonly [number, number];
  /** Покачивание из стороны в сторону, px. */
  sway?: number;
  /** Вращение, оборотов в секунду (в обе стороны). */
  spin?: number;
  /** Мерцание: частица плавно гаснет и загорается. */
  twinkle?: boolean;
  /** Свечение: цвета складываются, как у огней. */
  glow?: boolean;
  /** Движение рывками (пиксельные образы): кадр рисуется столько раз в секунду. */
  fps?: number;
}

/** Фоны, которые рисуются частицами на холсте. Остальные (aurora, grid, lights, none) — это CSS в src/styles/look.css. */
export const PRESETS: Readonly<Partial<Record<SkinScene, ScenePreset>>> = {
  snow: { shape: 'flake', count: 46, tints: ['255 255 255', 'line'], size: [2, 6], alpha: [0.35, 0.9], vx: [-8, 8], vy: [18, 46], sway: 18 },
  rain: { shape: 'streak', count: 54, tints: ['brand', 'line'], size: [10, 22], alpha: [0.14, 0.42], vx: [-34, -22], vy: [420, 640] },
  petals: { shape: 'petal', count: 22, tints: ['brand', 'accent', 'line'], size: [7, 13], alpha: [0.35, 0.75], vx: [-18, 10], vy: [22, 48], sway: 30, spin: 0.25 },
  leaves: { shape: 'leaf', count: 16, tints: ['brand', 'accent', 'line'], size: [9, 16], alpha: [0.3, 0.65], vx: [10, 34], vy: [24, 52], sway: 36, spin: 0.3 },
  stars: { shape: 'star', count: 60, tints: ['255 255 255', 'line', 'accent'], size: [1, 3.2], alpha: [0.25, 0.95], vx: [-1.5, 1.5], vy: [-1, 1], twinkle: true, glow: true },
  bubbles: { shape: 'bubble', count: 20, tints: ['brand', 'accent', '255 255 255'], size: [8, 30], alpha: [0.16, 0.42], vx: [-6, 6], vy: [-40, -14], sway: 14 },
  confetti: { shape: 'chip', count: 26, tints: ['brand', 'accent', 'line', 'income', 'expense'], size: [5, 10], alpha: [0.4, 0.8], vx: [-14, 14], vy: [26, 62], sway: 20, spin: 0.7 },
  embers: { shape: 'spark', count: 30, tints: ['line', 'accent', '255 190 90'], size: [1.2, 3.4], alpha: [0.3, 0.9], vx: [-10, 10], vy: [-56, -18], sway: 12, twinkle: true, glow: true },
  hearts: { shape: 'heart', count: 16, tints: ['brand', 'accent', 'line'], size: [8, 16], alpha: [0.28, 0.62], vx: [-6, 6], vy: [-34, -12], sway: 18, spin: 0.06 },
  dust: { shape: 'dot', count: 40, tints: ['line', 'accent', '255 255 255'], size: [0.8, 2.4], alpha: [0.25, 0.85], vx: [-5, 5], vy: [-8, 4], twinkle: true, glow: true },
  fireflies: { shape: 'bokeh', count: 18, tints: ['line', 'accent', 'brand'], size: [10, 30], alpha: [0.1, 0.34], vx: [-9, 9], vy: [-8, 8], sway: 10, twinkle: true, glow: true },
  speed: { shape: 'streak', count: 26, tints: ['line', 'brand', '255 255 255'], size: [40, 120], alpha: [0.1, 0.36], vx: [520, 980], vy: [0, 0] },
  ticker: { shape: 'candle', count: 22, tints: ['income', 'expense'], size: [10, 34], alpha: [0.16, 0.36], vx: [-26, -14], vy: [0, 0] },
  sand: { shape: 'dot', count: 60, tints: ['line', 'accent'], size: [0.8, 2], alpha: [0.2, 0.6], vx: [40, 110], vy: [-4, 10], sway: 6 },
  pixels: { shape: 'square', count: 26, tints: ['brand', 'line', 'accent'], size: [4, 8], alpha: [0.2, 0.55], vx: [0, 0], vy: [24, 64], fps: 8 },
};

/** Рисуется ли этот фон на холсте (иначе он целиком в CSS и код холста не грузится). */
export const isCanvasScene = (scene: string): scene is SkinScene => Object.prototype.hasOwnProperty.call(PRESETS, scene);
