import { useId } from 'react';

/**
 * Знак Finora: жирная наклонная «F» на фиолетовом градиенте (тот же рисунок, что public/icon.svg).
 * Работает офлайн, без файлов. У каждого экземпляра свои id градиентов: градиент из скрытого (display:none)
 * элемента не рисуется, а в шапке телефона и в боковой панели ПК знак стоит одновременно.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6a6cff" />
          <stop offset="1" stopColor="#9a5cf7" />
        </linearGradient>
        <radialGradient id={`${id}b`} cx=".28" cy=".1" r=".95">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}c`} gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="38">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#e4defd" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="15" fill={`url(#${id}a)`} />
      <rect width="48" height="48" rx="15" fill={`url(#${id}b)`} />
      <g transform="translate(5.1 0) skewX(-12)">
        <path d="M16 11H36V17.4H23V21.8H32V28H23V37H16Z" fill={`url(#${id}c)`} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
