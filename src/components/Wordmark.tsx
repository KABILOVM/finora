import { cn } from '@/lib/cn';

/**
 * Название «Sumoima» рядом со знаком: жирное начертание с наклоном 8° (как в знаке «$» в Logo).
 * Размер задаёт вызывающий (text-lg, text-xl…).
 */
export function Wordmark({ className }: { className?: string }) {
  // Начертание Manrope ExtraBold слегка утолщено обводкой того же цвета, чтобы название держалось рядом со знаком.
  return (
    <span
      className={cn('inline-block -skew-x-6 font-extrabold leading-none tracking-[0.02em]', className)}
      style={{ WebkitTextStroke: '0.04em currentColor', paintOrder: 'stroke fill' }}
    >
      Sumoima
    </span>
  );
}
