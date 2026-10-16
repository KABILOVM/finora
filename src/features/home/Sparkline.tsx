import { useId } from 'react';
import { sparkPath } from './homeData';

export interface SparklineProps {
  points: readonly number[];
  className?: string;
  /** true — низкий и широкий график (300×64) для подложки карточки; обычный — 300×90. */
  fit?: boolean;
}

/**
 * График остатка за две недели: линия рисуется, под ней мягкая заливка, на конце маркер. Декоративный (aria-hidden).
 * Анимация рисования играет заново, когда меняются точки (ключ — сами значения).
 */
export function Sparkline({ points, className, fit = false }: SparklineProps) {
  const W = 300;
  const H = fit ? 64 : 90;
  const { d, lastY } = sparkPath(points, W, H);
  const gradId = `spark-fill-${useId().replace(/:/g, '')}`;
  return (
    <div key={points.join(',')} className={`relative ${className ?? ''}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.38" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="spark-area" d={`${d} L${W} ${H} L0 ${H}Z`} fill={`url(#${gradId})`} />
        <path className="spark-line" d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="spark-dot absolute right-0 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-current" style={{ top: `${(lastY / H) * 100}%` }} />
    </div>
  );
}
