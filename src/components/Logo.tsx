/** Знак Finora: монета с буквой «F» на тёмной плашке (тот же рисунок, что public/icon.svg). Работает офлайн, без файлов. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#0f172a" />
      <circle cx="256" cy="256" r="168" fill="#10b981" />
      <circle cx="256" cy="256" r="140" fill="none" stroke="#0f172a" strokeOpacity="0.22" strokeWidth="8" />
      <g fill="#0f172a">
        <rect x="200" y="176" width="46" height="160" rx="10" />
        <rect x="200" y="176" width="112" height="44" rx="10" />
        <rect x="200" y="234" width="84" height="40" rx="10" />
      </g>
    </svg>
  );
}
