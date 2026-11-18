import type { AccentKind } from './presets';
import type { SeasonKind } from './season';

/**
 * Картинки сезонных частиц и украшений. Каждая рисуется ОДИН раз в маленький холст в памяти, а потом только копируется на экран
 * (drawImage): это намного дешевле, чем каждый кадр заново строить градиенты и контуры. Цвета зависят от темы: белый снег на белой
 * карточке не виден, поэтому на светлой теме у него голубой край.
 */

export interface Sprite {
  img: HTMLCanvasElement;
  /** Половина стороны картинки, px (вместе с полями под свечение). */
  half: number;
  /** Радиус самой частицы внутри картинки, px: частица радиуса s рисуется в масштабе s / r. */
  r: number;
  /** Во сколько раз эта частица крупнее обычной (кристалл-снежинка заметнее точки). */
  boost: number;
  /** Как часто встречается среди частиц (вес). */
  weight: number;
  /** Есть ли смысл вращать: у круглой точки поворот не виден, у кристалла, лепестка и листа — виден. */
  turn: boolean;
}

type Ctx = CanvasRenderingContext2D;

function sprite(half: number, r: number, dpr: number, weight: number, boost: number, turn: boolean, paint: (ctx: Ctx) => void): Sprite | null {
  const img = document.createElement('canvas');
  const px = Math.ceil(half * 2 * dpr);
  img.width = px;
  img.height = px;
  const ctx = img.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.translate(half, half);
  paint(ctx);
  return { img, half, r, boost, weight, turn };
}

const rgb = (color: string, alpha: number): string => `rgb(${color} / ${alpha})`;

/** Мягкий шарик: яркая середина, цветной край, дальше — прозрачно. */
function softDot(ctx: Ctx, r: number, core: string, rim: string, rimAlpha: number): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
  g.addColorStop(0, rgb(core, 1));
  g.addColorStop(0.42, rgb(core, 0.95));
  g.addColorStop(0.68, rgb(rim, rimAlpha));
  g.addColorStop(1, rgb(rim, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Снежинка-кристалл: шесть лучей с веточками. */
function crystal(ctx: Ctx, r: number, color: string): void {
  ctx.strokeStyle = rgb(color, 0.95);
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    for (const at of [0.45, 0.72]) {
      const len = r * (at < 0.6 ? 0.3 : 0.2);
      ctx.moveTo(0, -r * at);
      ctx.lineTo(len * 0.8, -r * at - len * 0.6);
      ctx.moveTo(0, -r * at);
      ctx.lineTo(-len * 0.8, -r * at - len * 0.6);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Капля дождя в полёте: тонкая линия, у хвоста прозрачная, у головы плотная. Голова — справа (по ней частицу поворачивают по ходу полёта). */
function streak(ctx: Ctx, r: number, color: string): void {
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  g.addColorStop(0, rgb(color, 0));
  g.addColorStop(0.6, rgb(color, 0.55));
  g.addColorStop(1, rgb(color, 1));
  ctx.strokeStyle = g;
  ctx.lineWidth = r * 0.23;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();
}

/** Снег в метели: мягкая точка, растянутая вдоль ветра (след от быстрого движения). Длинная ось — по +x, частицу поворачивают по полёту. */
function windDot(ctx: Ctx, r: number, core: string, rim: string, rimAlpha: number): void {
  ctx.save();
  ctx.scale(3.4, 1);
  softDot(ctx, r, core, rim, rimAlpha);
  ctx.restore();
}

/** Лепесток с выемкой на конце (как у цветка абрикоса или сакуры): тёмное основание, светлый край. */
function petal(ctx: Ctx, r: number, base: string, tip: string): void {
  const g = ctx.createLinearGradient(0, r, 0, -r);
  g.addColorStop(0, rgb(base, 0.98));
  g.addColorStop(1, rgb(tip, 0.98));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.bezierCurveTo(-r * 0.95, r * 0.35, -r * 0.8, -r * 0.75, -r * 0.22, -r * 0.92);
  ctx.quadraticCurveTo(0, -r * 0.62, r * 0.22, -r * 0.92);
  ctx.bezierCurveTo(r * 0.8, -r * 0.75, r * 0.95, r * 0.35, 0, r);
  ctx.fill();
  ctx.strokeStyle = rgb(base, 0.5);
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.85);
  ctx.quadraticCurveTo(r * 0.08, 0, 0, -r * 0.55);
  ctx.stroke();
}

/** Пушинка одуванчика: семечко и венчик тонких нитей с точками на концах. */
function fluff(ctx: Ctx, r: number, thread: string, glow: string, glowAlpha: number): void {
  softDot(ctx, r * 0.62, glow, glow, glowAlpha);
  ctx.strokeStyle = rgb(thread, 0.8);
  ctx.fillStyle = rgb(thread, 0.9);
  ctx.lineWidth = r * 0.06;
  ctx.lineCap = 'round';
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.09;
    const len = r * (i % 3 === 0 ? 0.98 : 0.82);
    const x = Math.cos(a) * len;
    const y = Math.sin(a) * len;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

/** Лист: заострённый овал с черешком и жилками; одна половина светлее — видно, как он поворачивается. */
function leaf(ctx: Ctx, r: number, color: string, shade: string): void {
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.bezierCurveTo(-r * 0.5, -r * 0.72, r * 0.45, -r * 0.62, r, 0);
    ctx.bezierCurveTo(r * 0.45, r * 0.62, -r * 0.5, r * 0.72, -r, 0);
  };
  ctx.fillStyle = rgb(color, 0.97);
  body();
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = rgb(shade, 0.55);
  ctx.fillRect(-r, 0, r * 2, r);
  ctx.restore();
  ctx.strokeStyle = rgb(shade, 0.9);
  ctx.lineWidth = r * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 1.28, 0);
  ctx.lineTo(r * 0.9, 0);
  for (const x of [-0.45, -0.05, 0.35]) {
    ctx.moveTo(r * x, 0);
    ctx.lineTo(r * (x + 0.26), -r * 0.3);
    ctx.moveTo(r * x, 0);
    ctx.lineTo(r * (x + 0.26), r * 0.3);
  }
  ctx.stroke();
}

/** Картинки падающих частиц сезона. `dark` — тёмная тема; `dpr` — плотность точек экрана. */
export function particleSprites(season: SeasonKind, dark: boolean, dpr: number): Sprite[] {
  const list: (Sprite | null)[] = [];
  if (season === 'winter' || season === 'blizzard') {
    // на светлой теме белая снежинка на белой карточке не видна: она вся голубая, без белой середины (иначе выходит «колечко»)
    const core = dark ? '255 255 255' : '158 190 238';
    const rim = dark ? '214 230 255' : '158 190 238';
    const line = dark ? '236 244 255' : '120 160 220';
    if (season === 'blizzard') {
      // метель: быстрые вытянутые по ветру штрихи и крупные снежинки среди них
      list.push(sprite(14, 4, dpr, 6, 1, false, (c) => windDot(c, 2.6, core, rim, dark ? 0.75 : 0.6)));
      list.push(sprite(14, 4, dpr, 3, 0.8, false, (c) => windDot(c, 2.6, dark ? core : '140 176 232', rim, dark ? 1 : 0.65)));
      list.push(sprite(9, 8, dpr, 1, 2.2, true, (c) => crystal(c, 8, line)));
    } else {
      list.push(sprite(7, 4, dpr, 6, 1, false, (c) => softDot(c, 4, core, rim, dark ? 0.75 : 0.55)));
      list.push(sprite(6, 4, dpr, 3, 0.75, false, (c) => softDot(c, 3.6, dark ? core : '140 176 232', rim, dark ? 1 : 0.6)));
      list.push(sprite(9, 8, dpr, 2, 2.1, true, (c) => crystal(c, 8, line)));
    }
  } else if (season === 'rain' || season === 'downpour') {
    // светлая тема: капля тёмно-голубая; тёмная: светло-голубая
    const color = dark ? '178 206 246' : '62 100 170';
    list.push(sprite(12, 10, dpr, 1, 1, false, (c) => streak(c, 10, color)));
  } else if (season === 'spring') {
    const tones: readonly (readonly [string, string])[] = dark
      ? [['246 138 176', '255 206 222'], ['255 176 200', '255 232 240'], ['236 118 164', '255 190 212']]
      : [['236 110 158', '255 184 208'], ['248 150 186', '255 214 228'], ['222 92 146', '250 166 196']];
    for (const [base, tip] of tones) list.push(sprite(10, 8, dpr, 1, 1, true, (c) => petal(c, 8, base, tip)));
  } else if (season === 'summer') {
    const thread = dark ? '255 250 232' : '148 132 98';
    const glow = dark ? '255 246 214' : '255 240 196';
    // только пух одуванчика (без «точек»): его мало, и он должен читаться как пух
    list.push(sprite(11, 9, dpr, 1, 1, true, (c) => fluff(c, 9, thread, glow, dark ? 0.5 : 0.75)));
  } else {
    const tones: readonly (readonly [string, string])[] = [
      ['236 158 44', '178 96 22'],
      ['222 102 38', '150 58 22'],
      ['186 62 48', '118 34 30'],
      ['204 168 56', '140 110 30'],
      ['150 104 58', '96 64 36'],
    ];
    for (const [color, shade] of tones) list.push(sprite(14, 10, dpr, 1, 1, true, (c) => leaf(c, 10, color, shade)));
  }
  return list.filter((s): s is Sprite => s !== null);
}

/** Предсказуемые «случайные» числа: украшение на каждом блоке выглядит одинаково от кадра к кадру и после перерисовки. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Сторона картинки углового украшения, px. */
export const ACCENT_SIZE = 92;

/** Контур угла блока со скруглением `r`: украшение не вылезает за скруглённый угол карточки. */
function cornerClip(ctx: Ctx, r: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, size);
  ctx.closePath();
  ctx.clip();
}

/** Иней: перистые кристаллы растут от краёв блока внутрь и тают к середине. */
function frost(ctx: Ctx, r: number, dark: boolean): void {
  const S = ACCENT_SIZE;
  const ice = dark ? '176 212 255' : '150 192 240';
  const line = dark ? '232 243 255' : '104 152 218';
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, S);
  haze.addColorStop(0, rgb(ice, dark ? 0.42 : 0.5));
  haze.addColorStop(0.5, rgb(ice, dark ? 0.16 : 0.2));
  haze.addColorStop(1, rgb(ice, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, S, S);

  const rnd = seeded(20261218);
  ctx.strokeStyle = rgb(line, dark ? 0.8 : 0.72);
  ctx.lineCap = 'round';
  const feather = (x: number, y: number, angle: number, length: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(length * 0.5, length * 0.06 * (rnd() - 0.5) * 6, length, 0);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let d = 4; d < length - 2; d += 3.6) {
      const barb = (1 - d / length) * (length * 0.24) + 1.4;
      for (const side of [-1, 1]) {
        ctx.moveTo(d, 0);
        ctx.lineTo(d + barb * 0.62, side * barb * 0.78);
      }
    }
    ctx.stroke();
    ctx.restore();
  };
  // от верхнего края вниз, от бокового — вбок, из самого угла — по диагонали
  for (let i = 0; i < 5; i++) feather(r * 0.6 + 6 + i * 13 + rnd() * 5, 0.5, Math.PI / 2 - 0.5 + rnd() * 0.5, 16 + rnd() * 20 - i * 2);
  for (let i = 0; i < 5; i++) feather(0.5, r * 0.6 + 6 + i * 13 + rnd() * 5, 0.5 - rnd() * 0.5, 16 + rnd() * 20 - i * 2);
  feather(r * 0.3, r * 0.3, Math.PI / 4, 44);
  feather(r * 0.3, r * 0.3, Math.PI / 4 - 0.42, 30);
  feather(r * 0.3, r * 0.3, Math.PI / 4 + 0.42, 30);

  ctx.fillStyle = rgb(dark ? '255 255 255' : line, dark ? 0.85 : 0.6);
  for (let i = 0; i < 34; i++) {
    const a = rnd() * (Math.PI / 2);
    const d = 6 + rnd() * rnd() * (S - 14);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 0.35 + rnd() * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // к середине блока иней тает
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.98);
  fade.addColorStop(0, 'rgb(0 0 0 / 1)');
  fade.addColorStop(0.55, 'rgb(0 0 0 / 0.75)');
  fade.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Опавшие листья: горсть из пяти листьев, прижатых к верхнему краю блока в углу и обрезанных его скруглённым краем, как будто они
 * лежат на карточке. Цвета те же, что у листьев в воздухе. Занимает только полоску у края (около 48×23 px): заголовок и подписи
 * карточки, которые начинаются от отступа в 16–20 px, остаются чистыми.
 */
function leaves(ctx: Ctx, dark: boolean): void {
  // (x, y, радиус, поворот, цвет, тень цвета) — от дальнего к ближнему
  const pile: readonly (readonly [number, number, number, number, string, string])[] = [
    [38, 7, 7, 0.2, '204 168 56', '140 110 30'],
    [8, 11, 6.5, 2.35, '150 104 58', '96 64 36'],
    [17, 19, 7.5, -0.35, '186 62 48', '118 34 30'],
    [25, 9, 9, 0.42, '236 158 44', '178 96 22'],
    [11, 3, 7, 0.95, '222 102 38', '150 58 22'],
  ];
  const lift = dark ? 1.08 : 1;
  for (const [x, y, r, angle, color, shade] of pile) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.shadowColor = dark ? 'rgb(0 0 0 / 0.5)' : 'rgb(60 36 20 / 0.34)';
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetX = 0.6;
    ctx.shadowOffsetY = 1.4;
    leaf(ctx, r * lift, color, shade);
    ctx.restore();
  }
}

/**
 * Картинка углового украшения для ЛЕВОГО верхнего угла блока со скруглением `radius` (для правого её отражают). null — у этого
 * украшения нет угловой картинки (росток рисуется на краю блока вместе с лежащими лепестками) или холст недоступен.
 */
export function accentSprite(kind: AccentKind, radius: number, dark: boolean, dpr: number): HTMLCanvasElement | null {
  if (kind === 'sprout' || kind === 'none') return null;
  const img = document.createElement('canvas');
  img.width = Math.ceil(ACCENT_SIZE * dpr);
  img.height = Math.ceil(ACCENT_SIZE * dpr);
  const ctx = img.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  cornerClip(ctx, radius, ACCENT_SIZE);
  if (kind === 'frost') frost(ctx, radius, dark);
  else leaves(ctx, dark);
  return img;
}

/** Росток на краю блока: стебель и два листка. (x, y) — точка, из которой он растёт. */
export function paintSprout(ctx: Ctx, x: number, y: number, size: number, dark: boolean): void {
  const stem = dark ? '96 196 120' : '52 150 84';
  const blade = dark ? '134 220 150' : '86 184 110';
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = rgb(stem, 1);
  ctx.lineWidth = size * 0.11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.quadraticCurveTo(size * 0.1, -size * 0.45, 0, -size * 0.8);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(0, -size * (side < 0 ? 0.5 : 0.72));
    ctx.rotate(side * 0.95 - Math.PI / 2);
    ctx.fillStyle = rgb(side < 0 ? blade : stem, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.3, -size * 0.26, size * 0.62, 0);
    ctx.quadraticCurveTo(size * 0.3, size * 0.2, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
