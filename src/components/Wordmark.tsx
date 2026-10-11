import { cn } from '@/lib/cn';

/**
 * Название «FINORA» рядом со знаком: тот же рисунок, что у «F» в логотипе, — жирное начертание с наклоном 12° (как skewX(-12) в Logo).
 * Текст в разметке остаётся «Finora» (так его читает скринридер и ищут тесты), заглавными он становится только на вид.
 * Размер задаёт вызывающий (text-lg, text-xl…).
 */
export function Wordmark({ className }: { className?: string }) {
  // Начертание Manrope ExtraBold само по себе легче «F» в знаке, поэтому буквы утолщены обводкой того же цвета.
  return (
    <span
      className={cn('inline-block -skew-x-12 font-extrabold uppercase leading-none tracking-[0.1em]', className)}
      style={{ WebkitTextStroke: '0.06em currentColor', paintOrder: 'stroke fill' }}
    >
      Finora
    </span>
  );
}
