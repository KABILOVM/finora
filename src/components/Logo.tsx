import { useId } from 'react';

/**
 * Знак Sumoima: жирный «$» на цветном градиенте (тот же рисунок, что public/icon.svg и PNG из scripts/make-icons.mjs).
 * Цвета берутся из палитры выбранного акцента (классы logo-* и переменные --ac-logo-* в index.css), по умолчанию — фиолетовые;
 * значения в атрибутах — те же фиолетовые, на случай если стили не подключились. Файлы public/ от акцента не зависят.
 * Работает офлайн, без файлов. У каждого экземпляра свои id градиентов: градиент из скрытого (display:none)
 * элемента не рисуется, а в шапке телефона и в боковой панели ПК знак стоит одновременно.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6a6cff" className="logo-from" />
          <stop offset="1" stopColor="#9a5cf7" className="logo-to" />
        </linearGradient>
        <radialGradient id={`${id}b`} cx=".28" cy=".1" r=".95">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}c`} gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="40">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#e4defd" className="logo-glyph" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="15" fill={`url(#${id}a)`} />
      <rect width="48" height="48" rx="15" fill={`url(#${id}b)`} />
      <g transform="translate(3.4 0) skewX(-8)" fill="none" stroke={`url(#${id}c)`} strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M31.4 17.2C29.9 14.4 27.1 13 23.8 13C19.7 13 17 15.1 17 18.3C17 25 31 22.4 31 29.8C31 33 28.2 35.2 24 35.2C20.5 35.2 17.8 33.8 16.3 30.8"
          strokeWidth="5"
        />
        <path d="M24 8V40" strokeWidth="3.4" />
      </g>
    </svg>
  );
}
