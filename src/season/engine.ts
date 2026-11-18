import { accentCorner, capClear, capFill, capLand, capVolume, COLUMN, cornerDrop, makeCap, makeScatter, particleCount, scatterLand, usableLedge, type Cap, type Scatter } from './pile';
import { CAP_HEIGHT, SCATTER_MAX, SCATTER_SPACING, SEASON_PRESETS } from './presets';
import type { SeasonKind } from './season';
import { ACCENT_SIZE, accentSprite, paintSprout, particleSprites, type Sprite } from './sprites';

/**
 * Сезонные эффекты: частицы падают поверх страницы, ложатся на верхний край блоков и стряхиваются нажатием, а у некоторых блоков
 * в углу — украшение сезона (иней, росток, горсть листьев). Летом ничего не ложится: только пух летает. Обычный код без React: запускается на двух элементах и возвращает остановку.
 *
 * Как устроено, чтобы не нагружать телефон:
 *  — каждая частица — маленькая картинка, которую двигает САМ браузер (Web Animations: путь задан заранее и повторяется по кругу,
 *    движение идёт в потоке отрисовки). Нашего кода в каждом кадре нет, полноэкранного холста тоже: на слабом телефоне без ускорения
 *    графики именно он стоил дороже всего;
 *  — несколько раз в секунду (а не каждый кадр) код смотрит, где сейчас частицы, и кладёт долетевшие до блока на его край;
 *  — то, что лежит на блоках, — маленькие холсты в слое, который прокручивается вместе со страницей. При прокрутке их двигает сам
 *    браузер; перерисовываются они только когда на блок что-то легло;
 *  — блоки за экраном не измеряются (IntersectionObserver), скрытая вкладка останавливает всё.
 */

/** Что считается блоком: карточки и карточка «Всего». */
const LEDGE_SELECTOR = '.card, .skin-hero';
/** Поля холста с лежащим: по бокам, над верхним краем блока и под ним (снег чуть свисает и огибает скруглённые углы), px. */
const PAD = 8;
const RISE = 18;
const SINK = 12;
/** Как часто код смотрит на частицы и блоки, мс (не каждый кадр: падение рисует браузер). */
const TICK_MS = 110;
const MAX_LEDGES = 48;
const MAX_DEBRIS = 120;
/** Перерисовка лежащего на одном блоке — не чаще, мс. */
const PILE_REDRAW_MS = 450;
/** Откуда частица появляется и где исчезает: чуть выше и ниже экрана, px. */
const EDGE = 30;

/** Падающая частица: картинка и её путь. Где она сейчас, считается по времени анимации — спрашивать страницу не нужно. */
interface Flake {
  el: HTMLCanvasElement;
  fall: Animation | null;
  sprite: number;
  /** Радиус, px, и половина стороны картинки (с полями под свечение). */
  size: number;
  half: number;
  alpha: number;
  /** Скорость падения, px/с: у частицы своя на всё время (крупные падают быстрее). */
  vy: number;
  vx: number;
  x0: number;
  /** Фаза покачивания и кувыркания, чтобы частицы не двигались одинаково. */
  phase: number;
  angle: number;
  /** Вращение, рад/с (0 — не вращается: у круглой точки поворот не виден). */
  spin: number;
  /** Сколько длится путь сверху донизу, с. */
  time: number;
  /** Когда частица была бы на самом верху пути (по часам страницы, мс): по нему считается, где она сейчас. */
  startedAt: number;
  /** Высота при прошлой проверке: по ней видно, что частица пересекла край блока. */
  lastY: number;
}

interface Ledge {
  el: Element;
  /** Номер блока по порядку на странице: по нему выбирается, у кого есть украшение. */
  index: number;
  /** Рядом с экраном (IntersectionObserver). */
  near: boolean;
  /** Обрезан по ширине прокручиваемой лентой: лежащее вылезло бы за её край. */
  clipped: boolean;
  /** Положение на странице (в координатах документа) при последнем измерении: при прокрутке оно не меняется. */
  docLeft: number;
  docTop: number;
  width: number;
  height: number;
  /** Положение на экране: считается из положения на странице и прокрутки, без обращения к странице. */
  left: number;
  top: number;
  /** Верхний край на экране: на блок может лечь частица. */
  usable: boolean;
  radius: number;
  cap: Cap | null;
  scatter: Scatter | null;
  /** Ширина, под которую построено лежащее (блок изменил ширину — строим заново). */
  builtWidth: number;
  /** Неровность нижнего края сугроба: у каждого блока своя. */
  seed: number;
  corner: 'left' | 'right' | null;
  pile: HTMLCanvasElement | null;
  accent: HTMLCanvasElement | null;
  accentKey: string;
  dirty: boolean;
  drawnAt: number;
  /** Когда на блок «само» легло ещё немного снега (см. ambient). */
  fedAt: number;
  /** Последние выставленные сдвиги холстов, чтобы не трогать стили без нужды. */
  px: number;
  py: number;
  ax: number;
  ay: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Тёмный ли сейчас фон страницы: по яркости цвета --bg (у образов свои палитры, одного атрибута темы мало). */
function isDark(): boolean {
  const parts = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]! < 128;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/**
 * Запускает сезон `season`: `sky` — слой во весь экран для падающих частиц, `ground` — пустой слой в координатах страницы для
 * лежащего на блоках. Возвращает функцию остановки, которая убирает за собой всё созданное.
 */
export function startSeason(sky: HTMLElement, ground: HTMLElement, season: SeasonKind): () => void {
  // без Web Animations (очень старый браузер, тестовая среда) эффекта нет: это украшение, а не функция
  if (typeof sky.animate !== 'function') return () => undefined;
  const preset = SEASON_PRESETS[season];
  /** Ничего не ложится на блоки (лето): блоки не отслеживаются, слоёв с лежащим нет, нажатие ничего не стряхивает. */
  const ledgeless = preset.pile === 'none';

  let w = window.innerWidth;
  let h = window.innerHeight;
  let dpr = 1;
  let dark = isDark();
  let sprites: Sprite[] = [];
  let weights = 0;
  const accents = new Map<number, HTMLCanvasElement | null>();
  const flakes: Flake[] = [];
  let debris = 0;
  const ledges = new Map<Element, Ledge>();
  /** Блоки, чей верхний край сейчас на экране: на них ложатся частицы. */
  const live: Ledge[] = [];
  /** Прокрутка страницы и начало слоя с лежащим (в координатах документа), как при последнем измерении или событии прокрутки. */
  let scrollX = 0;
  let scrollY = 0;
  let originX = 0;
  let originY = 0;
  /** Пора заново измерить блоки (что-то появилось, изменило размер, окно изменилось). */
  let needSurvey = true;
  /** Страницу прокрутили с прошлой проверки частиц. */
  let scrolled = false;

  const snap = (v: number): number => Math.round(v * dpr) / dpr;

  const pickSprite = (): number => {
    let t = Math.random() * weights;
    for (let i = 0; i < sprites.length; i++) {
      t -= sprites[i]!.weight;
      if (t <= 0) return i;
    }
    return 0;
  };

  /* ───────────── Падающие частицы ───────────── */

  /**
   * Положение, поворот и «кувыркание» частицы одной строкой transform. На частицу — ОДНА анимация: такую браузер целиком ведёт в
   * потоке отрисовки. Две анимации на одном элементе (путь и отдельно вращение) он туда не отдаёт и пересчитывает страницу каждый кадр.
   */
  const pose = (x: number, y: number, half: number, angle: number, flip: number): string =>
    `translate3d(${(x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px, 0) rotate(${angle.toFixed(2)}rad) scaleY(${flip.toFixed(2)})`;

  /** Рисует картинку частицы в её холст (при создании и при смене темы). */
  const paintFlake = (f: Flake) => {
    const s = sprites[f.sprite];
    if (!s) return;
    const side = (s.half * 2 * f.size) / s.r;
    f.half = side / 2;
    f.el.width = Math.max(1, Math.round(side * dpr));
    f.el.height = f.el.width;
    f.el.style.width = `${side}px`;
    f.el.style.height = `${side}px`;
    f.el.style.opacity = String(f.alpha);
    f.el.getContext('2d')?.drawImage(s.img, 0, 0, f.el.width, f.el.height);
  };

  const xOf = (f: Flake, t: number): number => f.x0 + f.vx * t + Math.sin(t * 0.9 + f.phase) * preset.sway;
  const yOf = (f: Flake, t: number): number => -EDGE + (h + EDGE * 2) * (t / f.time);
  /** Кувыркание: частица поворачивается к зрителю то плашмя, то ребром. */
  const flipOf = (f: Flake, t: number): number => (preset.flutter ? Math.cos(t * 2.1 + f.phase * 3) : 1);
  /** Сколько секунд частица летит от верхнего края (путь повторяется по кругу). Считается по часам, анимацию не спрашиваем. */
  const clock = (f: Flake): number => (Math.max(0, performance.now() - f.startedAt) / 1000) % f.time;

  /**
   * Запускает частицу по новому пути сверху вниз; путь потом повторяется сам, без нашего кода. `anywhere` — с случайного места пути
   * (при запуске и возврате на вкладку), иначе с самого верха (после приземления).
   */
  const fall = (f: Flake, anywhere: boolean) => {
    f.x0 = rand(-40, w + 40);
    f.vx = rand(preset.vx[0], preset.vx[1]);
    f.phase = Math.random() * Math.PI * 2;
    f.time = (h + EDGE * 2) / f.vy;
    // путь — ломаная: покачивание задано точками примерно раз в секунду, кувыркание — вдвое чаще
    const steps = Math.min(80, Math.max(3, Math.ceil(f.time / (preset.flutter ? 0.45 : 1.1))));
    const frames: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (f.time * i) / steps;
      frames.push({ transform: pose(xOf(f, t), yOf(f, t), f.half, f.angle + f.spin * t, flipOf(f, t)) });
    }
    const offset = anywhere ? Math.random() * f.time * 1000 : 0;
    f.fall?.cancel();
    f.fall = f.el.animate(frames, { duration: f.time * 1000, easing: 'linear', iterations: Infinity, delay: -offset });
    f.startedAt = performance.now() - offset;
    f.lastY = yOf(f, clock(f));
  };

  const addFlake = () => {
    const el = document.createElement('canvas');
    el.className = 'season-flake';
    sky.appendChild(el);
    const depth = Math.random();
    const sprite = pickSprite();
    const f: Flake = {
      el,
      fall: null,
      sprite,
      size: (preset.size[0] + (preset.size[1] - preset.size[0]) * depth) * (sprites[sprite]?.boost ?? 1),
      half: 0,
      // крупные ближе к зрителю: падают быстрее и видны ярче
      alpha: preset.alpha[0] + (preset.alpha[1] - preset.alpha[0]) * (depth * 0.6 + Math.random() * 0.4),
      vy: preset.vy[0] + (preset.vy[1] - preset.vy[0]) * (depth * 0.7 + Math.random() * 0.3),
      vx: 0,
      x0: 0,
      phase: 0,
      angle: Math.random() * Math.PI * 2,
      spin: sprites[sprite]?.turn ? rand(-preset.spin, preset.spin) * Math.PI * 2 : 0,
      time: 1,
      startedAt: 0,
      lastY: -EDGE,
    };
    paintFlake(f);
    flakes.push(f);
    fall(f, true);
  };

  const fitFlakes = () => {
    const wanted = particleCount(preset.count, w, h);
    while (flakes.length < wanted) addFlake();
    while (flakes.length > wanted) {
      const f = flakes.pop()!;
      f.fall?.cancel();
      f.el.remove();
    }
  };

  const rebuildSprites = () => {
    sprites = particleSprites(season, dark, dpr);
    weights = sprites.reduce((sum, s) => sum + s.weight, 0);
    accents.clear();
    for (const f of flakes) paintFlake(f);
    for (const l of ledges.values()) {
      l.dirty = true;
      l.drawnAt = 0;
      l.accentKey = '';
    }
  };

  const resize = () => {
    // телефон прячет адресную строку при прокрутке — высота окна чуть меняется. Из-за этого частицы заново не запускаем
    const minor = sprites.length > 0 && window.innerWidth === w && Math.abs(window.innerHeight - h) <= 120;
    needSurvey = true;
    if (minor) return;
    w = window.innerWidth;
    h = window.innerHeight;
    // выше двух точек на пиксель рисовать незачем: частицы мелкие и движутся
    const next = Math.min(window.devicePixelRatio || 1, 2);
    if (next !== dpr || sprites.length === 0) {
      dpr = next;
      rebuildSprites();
    }
    fitFlakes();
    for (const f of flakes) fall(f, true);
    needSurvey = true;
    follow(300);
  };

  /* ───────────── Блоки ───────────── */

  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const l = ledges.get(e.target);
              if (!l) continue;
              l.near = e.isIntersecting;
              l.clipped = e.isIntersecting && e.intersectionRect.width < e.boundingClientRect.width - 2;
            }
            needSurvey = true;
          },
          // с запасом по высоте: сугроб готов раньше, чем блок въедет на экран при прокрутке
          { rootMargin: '240px 0px', threshold: [0, 0.5, 0.98] },
        )
      : null;

  /** Блок или вся страница изменили размер — положения могли сдвинуться. */
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (needSurvey = true)) : null;

  const removeCanvases = (l: Ledge) => {
    l.pile?.remove();
    l.accent?.remove();
    l.pile = null;
    l.accent = null;
    l.accentKey = '';
  };

  const drop = (l: Ledge) => {
    io?.unobserve(l.el);
    ro?.unobserve(l.el);
    removeCanvases(l);
    ledges.delete(l.el);
  };

  /** Заново находит блоки на странице: новые начинает отслеживать, исчезнувшие забывает. */
  const collect = () => {
    if (ledgeless) return;
    const root = document.getElementById('main') ?? document.body;
    const seen = new Set<Element>();
    let index = 0;
    for (const el of root.querySelectorAll(LEDGE_SELECTOR)) {
      if (index >= MAX_LEDGES) break;
      if (el.parentElement?.closest(LEDGE_SELECTOR)) continue; // блок внутри блока — не отдельный
      seen.add(el);
      let l = ledges.get(el);
      if (!l) {
        l = { el, index, near: io === null, clipped: false, docLeft: 0, docTop: 0, left: 0, top: 0, width: 0, height: 0, usable: false, radius: 0, cap: null, scatter: null, builtWidth: 0, seed: Math.random() * 10, corner: null, pile: null, accent: null, accentKey: '', dirty: true, drawnAt: 0, fedAt: 0, px: NaN, py: NaN, ax: NaN, ay: NaN };
        ledges.set(el, l);
        io?.observe(el);
        ro?.observe(el);
        needSurvey = true;
        follow(700); // новые блоки обычно «всплывают» с новой страницей: пока едут, ставим лежащее на место каждый кадр
      }
      l.index = index++;
      l.corner = accentCorner(l.index);
    }
    for (const [el, l] of ledges) if (!seen.has(el)) drop(l);
  };

  /** Сколько лежит на блоке, доля от полного (0…1). */
  const share = (l: Ledge): number => {
    if (l.cap) {
      let full = 0;
      for (let i = 0; i < l.cap.limit.length; i++) full += l.cap.limit[i]!;
      return full > 0 ? Math.min(1, capVolume(l.cap) / (full * COLUMN)) : 0;
    }
    if (l.scatter) return l.scatter.max > 0 ? l.scatter.items.length / l.scatter.max : 0;
    return 0;
  };

  const restItem = (x: number, sprite: number, size: number) => ({ x, sprite, angle: rand(-0.55, 0.55) + (Math.random() < 0.5 ? Math.PI : 0), scale: size });

  /** Строит лежащее под нынешнюю ширину блока. Новому блоку сразу достаётся немного: снег лежит уже при открытии страницы. */
  const buildPile = (l: Ledge) => {
    const first = l.builtWidth === 0;
    const filled = first ? rand(0.4, 0.85) : share(l);
    const style = getComputedStyle(l.el);
    l.radius = Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, l.width / 2, l.height / 2, 40));
    l.builtWidth = l.width;
    if (preset.pile === 'cap') {
      l.cap = makeCap(l.width, CAP_HEIGHT, l.radius);
      capFill(l.cap, filled, Math.random);
    } else {
      l.scatter = makeScatter(l.width - l.radius, SCATTER_SPACING, SCATTER_MAX);
      const n = Math.round(l.scatter.max * filled * (first ? 0.8 : 1));
      for (let i = 0; i < n; i++) scatterLand(l.scatter, restItem(rand(l.radius * 0.6, l.width - l.radius * 0.6), pickSprite(), rand(preset.size[0], preset.size[1])));
    }
    if (l.pile) {
      l.pile.remove();
      l.pile = null;
    }
    l.dirty = true;
    l.drawnAt = 0;
  };

  const pileCss = (l: Ledge): [number, number] => [Math.ceil(l.width) + PAD * 2, RISE + SINK];

  const makeCanvas = (className: string, cssW: number, cssH: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.className = className;
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    ground.appendChild(c);
    return c;
  };

  /** Линия, на которой лежит снег в точке `x` от левого края блока: у скруглённых углов она ниже верхнего края. */
  const baseAt = (l: Ledge, x: number): number => RISE + Math.min(SINK - 3, cornerDrop(Math.min(x, l.width - x), l.radius));

  const drawCap = (g: CanvasRenderingContext2D, l: Ledge, cap: Cap) => {
    const n = cap.h.length;
    const xAt = (i: number): number => Math.min(l.width, (i + 0.5) * COLUMN);
    const lip = (i: number): number => Math.min(3.4, cap.h[i]! * 0.4) * (0.55 + 0.45 * Math.sin(i * 0.9 + l.seed));
    g.beginPath();
    let any = false;
    // сугроб — один или несколько кусков: там, где снега нет (у скруглённых углов, после стряхивания), контур не ведём
    for (let from = 0; from < n; from++) {
      if (cap.h[from]! < 0.3) continue;
      let to = from;
      while (to + 1 < n && cap.h[to + 1]! >= 0.3) to++;
      any = true;
      // верхний контур слева направо
      const startX = PAD + Math.max(0, xAt(from) - COLUMN / 2);
      const startY = baseAt(l, xAt(from));
      let px = startX;
      let py = startY;
      g.moveTo(px, py);
      for (let i = from; i <= to; i++) {
        const nx = PAD + xAt(i);
        const ny = baseAt(l, xAt(i)) - cap.h[i]!;
        g.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
        px = nx;
        py = ny;
      }
      const endX = PAD + Math.min(l.width, xAt(to) + COLUMN / 2);
      const endY = baseAt(l, xAt(to));
      g.quadraticCurveTo(px, py, endX, endY);
      // нижний край справа налево: снег чуть свисает с края блока, неровно
      px = endX;
      py = endY;
      for (let i = to; i >= from; i--) {
        const nx = PAD + xAt(i);
        const ny = baseAt(l, xAt(i)) + lip(i);
        g.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
        px = nx;
        py = ny;
      }
      g.quadraticCurveTo(px, py, startX, startY);
      g.closePath();
      from = to;
    }
    if (!any) return;
    const fill = g.createLinearGradient(0, RISE - CAP_HEIGHT, 0, RISE + SINK);
    fill.addColorStop(0, dark ? 'rgb(252 253 255)' : 'rgb(255 255 255)');
    fill.addColorStop(1, dark ? 'rgb(196 214 244)' : 'rgb(204 221 246)');
    g.fillStyle = fill;
    // тень отделяет белый снег от светлой карточки и от фона
    g.shadowColor = dark ? 'rgb(0 0 0 / 0.4)' : 'rgb(56 92 150 / 0.45)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    g.fill();
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    if (!dark) {
      g.strokeStyle = 'rgb(120 156 210 / 0.45)';
      g.lineWidth = 0.8;
      g.stroke();
    }
  };

  const drawScatter = (g: CanvasRenderingContext2D, l: Ledge, scatter: Scatter) => {
    for (const item of scatter.items) {
      const s = sprites[item.sprite];
      if (!s) continue;
      const base = baseAt(l, item.x);
      const x = PAD + item.x;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1;
      g.fillStyle = dark ? 'rgb(0 0 0 / 0.28)' : 'rgb(40 50 80 / 0.14)';
      g.beginPath();
      g.ellipse(x, base + 0.8, item.scale * 0.85, 1.5, 0, 0, Math.PI * 2);
      g.fill();
      // лежит плашмя: сплющена по вертикали
      const k = item.scale / s.r;
      const cos = Math.cos(item.angle) * k * dpr;
      const sin = Math.sin(item.angle) * k * dpr;
      g.setTransform(cos, sin * 0.55, -sin, cos * 0.55, x * dpr, (base - item.scale * 0.3) * dpr);
      g.globalAlpha = 0.97;
      g.drawImage(s.img, -s.half, -s.half, s.half * 2, s.half * 2);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
  };

  const drawPile = (l: Ledge, now: number) => {
    const g = l.pile?.getContext('2d');
    l.dirty = false;
    l.drawnAt = now;
    if (!g) return;
    const [cssW, cssH] = pileCss(l);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    if (preset.accent === 'sprout' && l.corner !== null && l.width >= 180) {
      const at = l.corner === 'left' ? 0.2 : 0.8;
      paintSprout(g, PAD + l.width * at, RISE + 0.5, 13, dark);
      paintSprout(g, PAD + l.width * at + (l.corner === 'left' ? 11 : -11), RISE + 0.5, 8.5, dark);
    }
    if (l.cap) drawCap(g, l, l.cap);
    else if (l.scatter) drawScatter(g, l, l.scatter);
  };

  /** Ставит холсты блока на место (в координатах слоя) и заводит их, если ещё нет. */
  const place = (l: Ledge) => {
    if (!l.pile) {
      const [cssW, cssH] = pileCss(l);
      l.pile = makeCanvas('season-pile', cssW, cssH);
      l.px = NaN;
      l.dirty = true;
      l.drawnAt = 0;
    }
    const x = snap(l.docLeft - originX - PAD);
    const y = snap(l.docTop - originY - RISE);
    if (x !== l.px || y !== l.py) {
      l.pile.style.transform = `translate(${x}px, ${y}px)`;
      l.px = x;
      l.py = y;
    }

    if (l.corner === null || preset.accent === 'sprout' || preset.accent === 'none' || l.width < 180 || l.height < 44) {
      if (l.accent) {
        l.accent.remove();
        l.accent = null;
        l.accentKey = '';
      }
      return;
    }
    const aw = Math.round(Math.min(ACCENT_SIZE, l.width * 0.5));
    const ah = Math.round(Math.min(ACCENT_SIZE, l.height));
    const radius = Math.round(l.radius);
    const key = `${l.corner}|${aw}|${ah}|${radius}`;
    if (l.accentKey !== key) {
      l.accent?.remove();
      l.accent = makeCanvas('season-accent', aw, ah);
      l.accentKey = key;
      l.ax = NaN;
      if (!accents.has(radius)) accents.set(radius, accentSprite(preset.accent, radius, dark, dpr));
      const img = accents.get(radius);
      const g = l.accent.getContext('2d');
      if (img && g) {
        // картинка нарисована для левого угла; для правого — отражаем
        if (l.corner === 'right') g.setTransform(-dpr, 0, 0, dpr, aw * dpr, 0);
        else g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.drawImage(img, 0, 0, ACCENT_SIZE, ACCENT_SIZE);
      }
    }
    if (!l.accent) return;
    const ax = snap((l.corner === 'left' ? l.docLeft : l.docLeft + l.width - aw) - originX);
    const ay = snap(l.docTop - originY);
    if (ax !== l.ax || ay !== l.ay) {
      l.accent.style.transform = `translate(${ax}px, ${ay}px)`;
      l.ax = ax;
      l.ay = ay;
    }
  };

  /**
   * Без обращения к странице: по запомненным положениям блоков и прокрутке решает, какие блоки сейчас на экране, и держит их
   * холсты на месте. Вызывается несколько раз в секунду и ничего не стоит, пока ничего не меняется.
   */
  const arrange = () => {
    live.length = 0;
    for (const l of ledges.values()) {
      l.left = l.docLeft - scrollX;
      l.top = l.docTop - scrollY;
      // холсты держим у блоков рядом с экраном; у ушедших далеко — нет (снег в памяти остаётся)
      const shown = l.near && !l.clipped && l.width >= 96 && l.height >= 28;
      l.usable = shown && usableLedge(l, w, h);
      if (l.usable) live.push(l);
      if (!shown) {
        if (l.pile || l.accent) removeCanvases(l);
        continue;
      }
      if (Math.abs(l.width - l.builtWidth) > 3) buildPile(l);
      place(l);
    }
  };

  /**
   * Измеряет блоки рядом с экраном. Это чтение страницы (браузер пересчитывает стили), поэтому делается только когда что-то
   * изменилось — появились блоки, изменился размер, — и изредка для страховки, а не постоянно.
   */
  const survey = () => {
    needSurvey = false;
    lastSurvey = performance.now();
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    const origin = ground.getBoundingClientRect();
    originX = origin.left + scrollX;
    originY = origin.top + scrollY;
    for (const l of ledges.values()) {
      if (!l.el.isConnected) {
        drop(l);
        continue;
      }
      if (!l.near) continue;
      const r = l.el.getBoundingClientRect();
      l.docLeft = r.left + scrollX;
      l.docTop = r.top + scrollY;
      l.width = r.width;
      l.height = r.height;
    }
    arrange();
  };

  /* ───────────── Падение, приземление, стряхивание ───────────── */

  /** Частица долетела до блока в точке `x` от его левого края. false — не легла (места нет), летит дальше. */
  const settle = (l: Ledge, x: number, p: Flake): boolean => {
    if (l.cap) {
      if (!capLand(l.cap, x, preset.grow * (0.7 + 0.6 * Math.min(1, p.size / preset.size[1])))) return false;
    } else if (l.scatter) {
      if (x < l.radius * 0.6 || x > l.width - l.radius * 0.6) return false;
      if (!scatterLand(l.scatter, restItem(x, p.sprite, p.size))) return false;
    } else return false;
    l.dirty = true;
    return true;
  };

  /**
   * Верхние блоки заслоняют нижние, и до тех долетает мало. Поэтому на каждый видимый блок изредка «само» ложится ещё немного
   * снега (мелкие снежинки, которых не видно): сугроб растёт на всех блоках, а не только на верхнем.
   */
  const ambient = (now: number) => {
    if (preset.pile !== 'cap') return;
    for (const l of live) {
      if (!l.cap || now - l.fedAt < 2200) continue;
      l.fedAt = now + rand(0, 800);
      if (capLand(l.cap, rand(0, l.width), preset.grow * 1.2)) l.dirty = true;
    }
  };

  /**
   * Стряхнутая частица: летит по дуге и гаснет. Тоже готовая анимация, которую ведёт браузер; по окончании картинка удаляется.
   * (x, y) — откуда на экране, (vx, vy) — начальная скорость, px/с.
   */
  const fling = (x: number, y: number, vx: number, vy: number, sprite: number, size: number, angle: number, alpha: number, ttl: number) => {
    const s = sprites[sprite];
    if (!s || debris >= MAX_DEBRIS) return;
    const side = (s.half * 2 * size) / s.r;
    const el = document.createElement('canvas');
    el.className = 'season-flake';
    el.width = Math.max(1, Math.round(side * dpr));
    el.height = el.width;
    el.style.width = `${side}px`;
    el.style.height = `${side}px`;
    el.getContext('2d')?.drawImage(s.img, 0, 0, el.width, el.height);
    const heavy = preset.pile === 'cap';
    const phase = Math.random() * Math.PI * 2;
    const spin = s.turn ? rand(-1, 1) * Math.PI * 3 : 0;
    const steps = 10;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const t = ttl * k;
      // по горизонтали воздух тормозит; лёгкое (лепестки, листья) ещё и покачивается, а падает не быстрее предела
      const dx = vx * t * (1 - 0.4 * k) + (heavy ? 0 : Math.sin(t * 3 + phase) * 12 * k);
      const dy = heavy ? vy * t + 0.5 * preset.gravity * t * t : Math.min(vy * t + 0.5 * preset.gravity * t * t, vy * t + 150 * t);
      frames.push({ transform: pose(x + dx, y + dy, side / 2, angle + spin * k, 1), opacity: alpha * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1) });
    }
    sky.appendChild(el);
    debris++;
    const done = () => {
      if (!el.isConnected) return;
      el.remove();
      debris--;
    };
    const anim = el.animate(frames, { duration: ttl * 1000, easing: 'linear', fill: 'both' });
    anim.onfinish = done;
    anim.oncancel = done;
  };

  /** Стряхивает всё, что лежит на блоке: оно осыпается вниз, блок слегка вздрагивает. */
  const shake = (l: Ledge) => {
    let any = false;
    if (l.cap) {
      const cap = l.cap;
      let columns = 0;
      for (let i = 0; i < cap.h.length; i++) if (cap.h[i]! > 0.6) columns++;
      const stride = Math.max(1, Math.ceil(columns / 40));
      let k = 0;
      for (let i = 0; i < cap.h.length; i++) {
        const height = cap.h[i]!;
        if (height <= 0.6 || k++ % stride !== 0) continue;
        any = true;
        const x = (i + 0.5) * COLUMN;
        for (let j = 0; j < (height > 5 ? 2 : 1); j++) {
          fling(l.left + x + rand(-2, 2), l.top + baseAt(l, x) - RISE - Math.random() * height, rand(-60, 60), rand(-120, -20), Math.random() < 0.7 ? 0 : 1, rand(1.2, 3.2), 0, rand(0.75, 1), rand(0.9, 1.5));
        }
      }
      capClear(cap);
    } else if (l.scatter && l.scatter.items.length > 0) {
      any = true;
      for (const item of l.scatter.items) {
        fling(l.left + item.x, l.top + baseAt(l, item.x) - RISE - item.scale * 0.3, rand(-70, 70), rand(-150, -40), item.sprite, item.scale, item.angle, 0.95, rand(1.6, 2.4));
      }
      l.scatter.items.length = 0;
    }
    if (!any) return;
    l.dirty = true;
    l.drawnAt = 0;
    l.fedAt = performance.now() + 1500;
    if (l.pile) drawPile(l, performance.now());
    // блок вздрагивает. Свойство translate не спорит с transform, которым блок может двигаться сам (нажатие, появление)
    try {
      (l.el as HTMLElement).animate?.([{ translate: '0 0' }, { translate: '-2px 1px' }, { translate: '2px 0' }, { translate: '-1px 1px' }, { translate: '0 0' }], { duration: 300, easing: 'ease-out' });
    } catch {
      /* старый браузер не умеет — снег всё равно осыпался */
    }
  };

  /**
   * Смотрит, какие частицы с прошлой проверки пересекли верхний край блока, и кладёт их на него. `collide` — проверять ли: если
   * страницу за это время прокрутили, блоки «прыгнули», и проверка врала бы.
   */
  const land = (collide: boolean) => {
    for (const f of flakes) {
      const t = clock(f);
      const y = yOf(f, t);
      const before = f.lastY;
      f.lastY = y;
      // y меньше прежнего — частица долетела до низа и начала путь заново
      if (!collide || y <= before) continue;
      const x = xOf(f, t);
      for (const l of live) {
        const edge = l.top - 2;
        if (before > edge || y <= edge || x <= l.left + 2 || x >= l.left + l.width - 2) continue;
        if (Math.random() < preset.stick && settle(l, x - l.left, f)) fall(f, false);
        break;
      }
    }
  };

  /* ───────────── Ход времени ───────────── */

  let timer = 0;
  let lastCollect = -Infinity;
  let lastSurvey = -Infinity;
  let needCollect = true;

  const tick = () => {
    const now = performance.now();
    if ((needCollect && now - lastCollect > 150) || now - lastCollect > 2000) {
      needCollect = false;
      lastCollect = now;
      collect();
      // тема могла смениться вместе с системной, без события приложения
      if (isDark() !== dark) {
        dark = !dark;
        rebuildSprites();
      }
    }
    if (needSurvey || now - lastSurvey > 2500) survey();
    else arrange();
    // если страницу за это время прокрутили, блоки «прыгнули» — приземление в этот раз не проверяем
    land(!scrolled);
    scrolled = false;
    ambient(now);
    for (const l of ledges.values()) if (l.dirty && l.pile && now - l.drawnAt > PILE_REDRAW_MS) drawPile(l, now);
  };

  /* Пока блоки едут (новая страница всплывает, окно меняет размер), лежащее ставится на место каждый кадр — недолго. */
  let followUntil = 0;
  let followFrame = 0;
  const track = () => {
    followFrame = 0;
    if (performance.now() > followUntil || document.hidden) return;
    survey();
    followFrame = requestAnimationFrame(track);
  };
  function follow(ms: number): void {
    if (ledgeless) return;
    followUntil = Math.max(followUntil, performance.now() + ms);
    if (followFrame === 0) followFrame = requestAnimationFrame(track);
  }

  const start = () => {
    // без блоков смотреть не на что: ни таймера, ни измерений — пух летит сам, его ведёт браузер
    if (ledgeless || timer !== 0 || document.hidden) return;
    needSurvey = true;
    timer = window.setInterval(tick, TICK_MS);
    tick();
  };
  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
  };
  const onVisibility = () => {
    if (document.hidden) {
      stop();
      return;
    }
    // пока вкладка была скрыта, все частицы долетели до низа: раскидываем заново, чтобы не пошли одной волной
    for (const f of flakes) fall(f, true);
    start();
  };
  const onTheme = () => {
    dark = isDark();
    rebuildSprites();
  };

  /* Нажатие (не прокрутка): палец почти не сдвинулся и быстро поднялся. При прокрутке браузер шлёт pointercancel, а не pointerup. */
  let down: { id: number; x: number; y: number; at: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || e.timeStamp - d.at > 700 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    let el = e.target instanceof Element ? e.target.closest(LEDGE_SELECTOR) : null;
    while (el && !ledges.has(el)) el = el.parentElement?.closest(LEDGE_SELECTOR) ?? null;
    const l = el ? ledges.get(el) : undefined;
    if (!l) return;
    survey(); // точное положение блока в момент нажатия
    if (l.usable) shake(l);
  };
  const onScroll = () => {
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    scrolled = true;
  };

  const mo = !ledgeless && typeof MutationObserver === 'function' ? new MutationObserver(() => (needCollect = true)) : null;
  mo?.observe(document.getElementById('main') ?? document.body, { childList: true, subtree: true });
  if (!ledgeless) ro?.observe(document.getElementById('main') ?? document.body);

  resize();
  start();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('finora-theme-change', onTheme);
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  document.addEventListener('pointerup', onUp, { capture: true, passive: true });

  return () => {
    stop();
    cancelAnimationFrame(followFrame);
    followUntil = 0;
    mo?.disconnect();
    io?.disconnect();
    ro?.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('finora-theme-change', onTheme);
    document.removeEventListener('pointerdown', onDown, { capture: true });
    document.removeEventListener('pointerup', onUp, { capture: true });
    for (const f of flakes) f.fall?.cancel();
    flakes.length = 0;
    ledges.clear();
    live.length = 0;
    sky.replaceChildren();
    ground.replaceChildren();
  };
}
