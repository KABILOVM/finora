import { sparkPath } from './homeData';

/** График остатка за две недели: линия рисуется, под ней мягкая заливка, на конце маркер. Декоративный (aria-hidden). */
export function Sparkline({ points, className }: { points: readonly number[]; className?: string }) {
  const { d, lastY } = sparkPath(points);
  return (
    <div className={`relative ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 300 90" className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.38" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="spark-area" d={`${d} L300 90 L0 90Z`} fill="url(#spark-fill)" />
        <path className="spark-line" d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="spark-dot absolute right-0 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-current" style={{ top: `${(lastY / 90) * 100}%` }} />
    </div>
  );
}
