import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';
import { Icon } from './Icon';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Есть ли сеть у устройства (по событиям online/offline браузера). Это подсказка, а не гарантия доступа к серверу. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export interface OnlineBadgeProps {
  /** Показывать только когда сети нет (чтобы не занимать место в шапке). */
  hideWhenOnline?: boolean;
  className?: string;
}

/**
 * «Офлайн» — янтарная плашка с рамкой: заметна, но маленькая. data-keep: в шапке телефона она не сжимается
 * (сокращается подпись соседнего индикатора, см. .header-status в index.css).
 */
export function OnlineBadge({ hideWhenOnline = false, className }: OnlineBadgeProps) {
  const online = useOnline();
  if (online && hideWhenOnline) return null;
  return (
    <Badge
      tone={online ? 'neutral' : 'warning'}
      role="status"
      data-keep
      className={cn(!online && 'font-bold ring-1 ring-inset ring-warning/50', className)}
    >
      {online ? (
        <span className="h-2 w-2 rounded-full bg-income" aria-hidden="true" />
      ) : (
        <Icon name="cloud-off" size={14} />
      )}
      {online ? 'Онлайн' : 'Офлайн'}
    </Badge>
  );
}
