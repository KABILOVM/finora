/**
 * Что лежит на блоке: сугроб (зима) или россыпь лепестков, пуха, листьев (остальные сезоны). ЧИСТЫЕ функции без страницы и холста:
 * рисует всё это src/season/engine.ts. Отдельно от рисования, чтобы правила накопления проверялись тестами.
 */

/** Ширина столбика сугроба, px: сугроб — это ряд высот вдоль верхнего края блока. */
export const COLUMN = 4;

export interface Cap {
  /** Высота снега в каждом столбике, px. */
  h: Float32Array;
  /** Предел высоты в столбике: у скруглённых углов блока он сходит на нет, иначе снег висел бы в воздухе. */
  limit: Float32Array;
}

/** На скруглённом углу снег не лежит там, где контур блока ушёл вниз от верхнего края больше чем на столько px: он висел бы в воздухе. */
export const CORNER_DROP_MAX = 5;

/** Пустой сугроб для блока шириной `width` со скруглением углов `radius`. */
export function makeCap(width: number, maxHeight: number, radius: number): Cap {
  const n = Math.max(1, Math.ceil(width / COLUMN));
  const limit = new Float32Array(n);
  // от боковой стороны до места, где скругление поднялось почти до верхнего края: ближе снега нет
  const k = Math.max(0, radius - CORNER_DROP_MAX);
  const inset = radius > CORNER_DROP_MAX ? radius - Math.sqrt(radius * radius - k * k) : 0;
  // дальше сугроб плавно набирает высоту
  const taper = Math.max(8, radius * 0.6);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * COLUMN;
    const d = Math.min(x, width - x);
    if (d < inset) continue;
    const t = Math.min(1, (d - inset) / taper);
    limit[i] = maxHeight * t * (2 - t);
  }
  return { h: new Float32Array(n), limit };
}

/** Доли снежинки, которые достаются соседним столбикам: сугроб получается покатым, а не зубчатым. */
const SPREAD = [1, 0.6, 0.25] as const;

/**
 * Снежинка легла в точке `x` (px от левого края блока): столбик под ней и соседние подрастают, но не выше предела.
 * false — мимо блока или столбик уже полон: снежинка летит дальше.
 */
export function capLand(cap: Cap, x: number, amount: number): boolean {
  const i = Math.floor(x / COLUMN);
  if (x < 0 || i >= cap.h.length || cap.h[i]! >= cap.limit[i]! - 0.05) return false;
  for (let d = -2; d <= 2; d++) {
    const j = i + d;
    if (j < 0 || j >= cap.h.length) continue;
    cap.h[j] = Math.min(cap.limit[j]!, cap.h[j]! + amount * SPREAD[Math.abs(d)]!);
  }
  return true;
}

/** Сколько снега лежит, px². */
export function capVolume(cap: Cap): number {
  let sum = 0;
  for (let i = 0; i < cap.h.length; i++) sum += cap.h[i]!;
  return sum * COLUMN;
}

/** Стряхнуть: снега на блоке больше нет. */
export function capClear(cap: Cap): void {
  cap.h.fill(0);
}

/** Начальный снег: около доли `fraction` от полного, неровно (`rnd` — случайное число 0…1), чтобы блоки не были одинаковыми. */
export function capFill(cap: Cap, fraction: number, rnd: () => number): void {
  let wave = rnd();
  for (let i = 0; i < cap.h.length; i++) {
    // соседние столбики похожи: неровность плавная
    wave = wave * 0.7 + rnd() * 0.3;
    cap.h[i] = Math.min(cap.limit[i]!, cap.limit[i]! * fraction * (0.5 + wave));
  }
}

/** Насколько контур скруглённого угла радиуса `r` ниже верхнего края блока на расстоянии `d` от боковой стороны, px. */
export function cornerDrop(d: number, r: number): number {
  if (r <= 0 || d >= r) return 0;
  const k = r - Math.max(0, d);
  return r - Math.sqrt(r * r - k * k);
}

/** Лежащая частица (лепесток, пушинка, лист): где, какая картинка и как повёрнута. */
export interface Resting {
  /** px от левого края блока. */
  x: number;
  sprite: number;
  angle: number;
  scale: number;
}

export interface Scatter {
  items: Resting[];
  max: number;
}

/** Пустая россыпь: помещается одна частица на каждые `spacing` px ширины, но не больше `most`. */
export function makeScatter(width: number, spacing: number, most: number): Scatter {
  return { items: [], max: Math.max(0, Math.min(most, Math.floor(width / spacing))) };
}

/** Частица легла на блок; false — места нет, летит дальше. */
export function scatterLand(s: Scatter, item: Resting): boolean {
  if (s.items.length >= s.max) return false;
  s.items.push(item);
  return true;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Ложится ли что-нибудь на этот блок: он на экране, не узкий и не низкий (чипсы и строки блоками не считаются). */
export function usableLedge(b: Box, vw: number, vh: number): boolean {
  return b.width >= 96 && b.height >= 28 && b.top > 4 && b.top < vh && b.left < vw && b.left + b.width > 0;
}

/** Украшение «в некоторых местах» (иней, ростки, листья): у каждого третьего блока по порядку на странице, углы чередуются. */
export function accentCorner(index: number): 'left' | 'right' | null {
  if (index % 3 !== 0) return null;
  return (index / 3) % 2 === 0 ? 'left' : 'right';
}

/** Сколько частиц летает: `base` — для телефона (390×844); на большом экране больше, но не больше 70 и не больше base + 34. */
export function particleCount(base: number, w: number, h: number): number {
  const wanted = Math.round((base * (w * h)) / (390 * 844));
  return Math.max(8, Math.min(70, base + 34, wanted));
}

/**
 * Частица движется вместе со скроллом: страницу прокрутили вниз на `dy` px — частица поднимается на `dy × k` px (k < 1: дальние,
 * мелкие частицы отстают от страницы, получается глубина). Путь частицы — время, а она падает со скоростью `vy` px/с, поэтому сдвиг
 * по экрану равен сдвигу по времени назад на `dy × k / vy` с. `cur` — сколько мс частица летит от верха пути, `duration` — длина
 * пути, мс. Путь повторяется по кругу, поэтому время остаётся в пределах [0, duration): частица, которую подняло выше начала пути,
 * появляется у его конца (внизу экрана), и густота частиц не редеет.
 */
export function shiftClock(cur: number, duration: number, dy: number, k: number, vy: number): number {
  if (!(vy > 0) || !(duration > 0) || !Number.isFinite(dy)) return cur;
  const next = cur - ((dy * k) / vy) * 1000;
  return ((next % duration) + duration) % duration;
}
