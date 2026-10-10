import { useSyncExternalStore } from 'react';
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

export function OnlineBadge({ hideWhenOnline = false, className }: OnlineBadgeProps) {
  const online = useOnline();
  if (online && hideWhenOnline) return null;
  return (
    <Badge tone={online ? 'neutral' : 'warning'} role="status" className={className}>
      {online ? (
        <span className="h-2 w-2 rounded-full bg-income" aria-hidden="true" />
      ) : (
        <Icon name="cloud-off" size={14} />
      )}
      {online ? 'Онлайн' : 'Офлайн'}
    </Badge>
  );
}
