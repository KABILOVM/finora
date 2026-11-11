import { useEffect, useRef } from 'react';
import type { SkinScene } from '@/skinCore';
import { PRESETS, type ScenePreset, type Shape, type Tint } from './presets';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  /** Фаза покачивания и мерцания, чтобы частицы не двигались одинаково. */
  phase: number;
  angle: number;
  spin: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Цвет частицы «R G B»: значение переменной темы со страницы или готовый цвет из описания фона. */
function resolveTint(tint: Tint, style: CSSStyleDeclaration): string {
  if (/^\d/.test(tint)) return tint;
  const name = tint === 'line' ? '--skin-line' : `--${tint}`;
  const value = style.getPropertyValue(name).trim();
  // у образа без своей рамки (--skin-line не задан) берём главный цвет
  return /^\d{1,3} \d{1,3} \d{1,3}$/.test(value) ? value : style.getPropertyValue('--brand').trim() || '128 128 128';
}

function spawn(p: ScenePreset, colors: readonly string[], w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: rand(p.vx[0], p.vx[1]),
    vy: rand(p.vy[0], p.vy[1]),
    size: rand(p.size[0], p.size[1]),
    alpha: rand(p.alpha[0], p.alpha[1]),
    color: colors[Math.floor(Math.random() * colors.length)] ?? '128 128 128',
    phase: Math.random() * Math.PI * 2,
    angle: Math.random() * Math.PI * 2,
    spin: p.spin ? rand(-p.spin, p.spin) * Math.PI * 2 : 0,
  };
}

/** Рисует одну частицу в начале координат (холст уже сдвинут и повёрнут). */
function draw(ctx: CanvasRenderingContext2D, shape: Shape, s: number, color: string, alpha: number): void {
  const fill = `rgb(${color} / ${alpha})`;
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  switch (shape) {
    case 'dot':
    case 'spark':
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flake':
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(-s / 2, -s / 2, s, s);
      break;
    case 'chip':
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      break;
    case 'streak':
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-s, 0);
      ctx.stroke();
      break;
    case 'petal':
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s * 0.75, s, 0);
      ctx.quadraticCurveTo(0, s * 0.75, -s, 0);
      ctx.fill();
      break;
    case 'heart': {
      const k = s / 2;
      ctx.beginPath();
      ctx.moveTo(0, k * 0.9);
      ctx.bezierCurveTo(-k * 2.2, -k * 0.6, -k * 0.9, -k * 2, 0, -k * 0.7);
      ctx.bezierCurveTo(k * 0.9, -k * 2, k * 2.2, -k * 0.6, 0, k * 0.9);
      ctx.fill();
      break;
    }
    case 'star': {
      // четырёхлучевая искра: два тонких ромба крест-накрест
      const r = s * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
      break;
    }
    case 'bubble':
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgb(${color} / ${alpha * 0.22})`;
      ctx.fill();
      ctx.fillStyle = `rgb(255 255 255 / ${alpha})`;
      ctx.beginPath();
      ctx.arc(-s * 0.35, -s * 0.35, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bokeh': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
      g.addColorStop(0, `rgb(${color} / ${alpha})`);
      g.addColorStop(1, `rgb(${color} / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'candle':
      // биржевая «свеча»: тело и тонкий фитиль
      ctx.fillRect(-3, -s / 2, 6, s);
      ctx.fillRect(-0.5, -s * 0.85, 1, s * 1.7);
      break;
  }
}

/**
 * Живой фон образа: частицы на холсте позади содержимого. Холст не принимает касаний и скрыт от скринридера.
 * Рисование останавливается, когда вкладка скрыта; на ярких экранах плотность точек ограничена двумя, чтобы не греть телефон.
 */
export default function SceneCanvas({ scene }: { scene: SkinScene }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const preset = PRESETS[scene];
    const ctx = canvas?.getContext('2d');
    if (!canvas || !preset || !ctx) return;

    let w = 0;
    let h = 0;
    let particles: Particle[] = [];
    let colors: string[] = [];
    let frame = 0;
    let last = 0;
    let acc = 0;

    const readColors = () => {
      const style = getComputedStyle(document.documentElement);
      colors = preset.tints.map((t) => resolveTint(t, style));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // частиц — по площади экрана, от числа для телефона
      const wanted = Math.min(90, Math.round((preset.count * (w * h)) / (390 * 844)));
      particles = Array.from({ length: Math.max(6, wanted) }, () => spawn(preset, colors, w, h));
    };

    const step = (dt: number, time: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = preset.glow ? 'lighter' : 'source-over';
      const margin = 40;
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        // ушла за край — появляется с противоположной стороны
        if (p.y > h + margin) p.y = -margin;
        else if (p.y < -margin) p.y = h + margin;
        if (p.x > w + margin) p.x = -margin;
        else if (p.x < -margin) p.x = w + margin;
        const sway = preset.sway ? Math.sin(time * 0.9 + p.phase) * preset.sway : 0;
        const alpha = preset.twinkle ? p.alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 1.6 + p.phase))) : p.alpha;
        ctx.save();
        ctx.translate(p.x + sway, p.y);
        if (preset.shape === 'streak') ctx.rotate(Math.atan2(p.vy, p.vx));
        else if (p.spin !== 0) ctx.rotate(p.angle);
        draw(ctx, preset.shape, p.size, p.color, alpha);
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      if (preset.fps) {
        // рывками: копим время и рисуем кадр редко
        acc += dt;
        if (acc < 1 / preset.fps) return;
        step(acc, now / 1000);
        acc = 0;
      } else step(dt, now / 1000);
    };

    const start = () => {
      if (frame !== 0 || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    // образ, акцент или тема сменились — берём цвета заново (событие шлёт src/theme.ts)
    const onTheme = () => {
      readColors();
      for (const p of particles) p.color = colors[Math.floor(Math.random() * colors.length)] ?? p.color;
    };

    readColors();
    resize();
    start();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('finora-theme-change', onTheme);
    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('finora-theme-change', onTheme);
    };
  }, [scene]);

  return <canvas ref={ref} aria-hidden="true" className="scene-canvas" />;
}
