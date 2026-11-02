import type { CSSProperties } from 'react';
import { COLOR_CHOICES } from '@/features/wallets/walletUi';
import { cn } from '@/lib/cn';
import { personKey } from './people';

/**
 * Кружок с инициалами человека: у каждого свой цвет, один и тот же во всех списках («Мне должны», «Я должен», «Люди»), чтобы человека
 * узнавать с первого взгляда. Цвет считается по ключу человека (без регистра и «ё»), поэтому «Алишер» и «алишер » — один кружок.
 */

/** Буквы имени для кружка: первые буквы первых двух слов («Алишер Каримов» → «АК», «Мама» → «М»). Нет ни одной — «?». */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter((w) => w !== '');
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  const text = letters.join('').toLocaleUpperCase('ru');
  return text === '' ? '?' : text;
}

/** Цвет кружка человека из набора цветов приложения (тот же, что у категорий и кошельков). */
export function personColor(name: string): string {
  const key = personKey(name);
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  return COLOR_CHOICES[h % COLOR_CHOICES.length]?.value ?? '#475569';
}

export interface PersonAvatarProps {
  name: string;
  size?: number;
  className?: string;
}

/** Плитка подкрашена цветом человека (как значки категорий); буквы — тот же цвет, смешанный с цветом текста темы: читаются в светлой и тёмной. */
export function PersonAvatar({ name, size = 44, className }: PersonAvatarProps) {
  const color = personColor(name);
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
    color: `color-mix(in srgb, ${color} 62%, rgb(var(--text)))`,
    fontSize: Math.round(size * 0.38),
  };
  return (
    // Буквы рисует CSS (.person-initials, index.css) из data-initials: в тексте строки их нет, поэтому поиск, копирование и скринридер видят только имя
    <span
      aria-hidden="true"
      data-initials={initialsOf(name)}
      style={style}
      className={cn('person-initials inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold leading-none', className)}
    />
  );
}
