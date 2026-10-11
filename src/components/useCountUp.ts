import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;

/** Без анимации: в тестах (нет matchMedia) и когда человек просит поменьше движения. */
function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Число плавно «набегает» до нового значения (первый раз — от нуля). Всегда заканчивает точным значением;
 * целое остаётся целым, поэтому для сумм в минимальных единицах подходит как есть.
 */
export function useCountUp(target: number): number {
  const allowed = motionAllowed();
  const [value, setValue] = useState(allowed ? 0 : target);
  const shown = useRef(value);

  useEffect(() => {
    if (!allowed || !Number.isFinite(target)) {
      shown.current = target;
      setValue(target);
      return;
    }
    const from = shown.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      const next = p >= 1 ? target : Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      shown.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, allowed]);

  return value;
}
