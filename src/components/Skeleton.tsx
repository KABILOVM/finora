import { cn } from '@/lib/cn';

/**
 * Заглушка на время загрузки: полоска с «бликом». Для скринридера — пустое место (aria-hidden): о том, что идёт загрузка,
 * говорит aria-busy у контейнера. При «меньше движения» блик не бегает (общее правило в index.css).
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('skeleton block rounded', className)} />;
}
