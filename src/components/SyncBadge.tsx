import type { SyncStatus } from '@/sync/transport';
import { pluralRu } from '@/lib/plural';
import { Badge, type BadgeTone } from './Badge';
import { Icon, type IconName } from './Icon';

/**
 * quarantined — записи, которые сервер не принял: в очереди их уже нет, но и на сервере тоже.
 * Передавайте весь статус движка (`<SyncBadge {...status} />`), иначе этот сигнал потеряется.
 */
export type SyncBadgeProps = Pick<SyncStatus, 'phase' | 'pending'> & Partial<Pick<SyncStatus, 'quarantined'>> & { className?: string };

const queued = (n: number) => `${n} ${pluralRu(n, 'запись', 'записи', 'записей')} в очереди`;

/** Мусорное число (NaN, отрицательное, дробное) считаем нулём/целым. */
const count = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Текст индикатора. Вынесен отдельно, чтобы его можно было проверить тестом без отрисовки. */
export function syncBadgeText(phase: SyncStatus['phase'], pending: number, quarantined = 0): string {
  const n = count(pending);
  const q = count(quarantined);
  // Отвергнутые сервером записи видны в любой фазе: «Синхронизировано» при них было бы ложным успокоением.
  const rejected = q > 0 ? `не принято сервером: ${q}` : '';
  const withRejected = (base: string) => (rejected ? `${base} · ${rejected}` : base);
  switch (phase) {
    case 'idle':
      if (n === 0) return q > 0 ? `Не принято сервером: ${q}` : 'Синхронизировано';
      return withRejected(`${n} ${pluralRu(n, 'запись ждёт', 'записи ждут', 'записей ждут')} отправки`);
    case 'syncing':
      return withRejected('Синхронизация…');
    case 'offline':
      return withRejected(n === 0 ? 'Без сети' : `Без сети · ${queued(n)}`);
    case 'error':
      return withRejected(n === 0 ? 'Ошибка синхронизации' : `Ошибка синхронизации · ${queued(n)}`);
    case 'auth-required':
      return withRejected(n === 0 ? 'Нужен вход' : `Нужен вход · ${queued(n)}`);
  }
}

function look(phase: SyncStatus['phase'], pending: number, quarantined: number): { icon: IconName; tone: BadgeTone; spin: boolean } {
  switch (phase) {
    case 'idle':
      if (quarantined > 0) return { icon: 'alert', tone: 'danger', spin: false };
      return pending > 0 ? { icon: 'cloud', tone: 'brand', spin: false } : { icon: 'cloud-check', tone: 'neutral', spin: false };
    case 'syncing':
      return { icon: 'refresh', tone: 'brand', spin: true };
    case 'offline':
      return { icon: 'cloud-off', tone: 'warning', spin: false };
    case 'error':
      return { icon: 'alert', tone: 'danger', spin: false };
    case 'auth-required':
      return { icon: 'lock', tone: 'warning', spin: false };
  }
}

/** Индикатор синхронизации. Работает по пропсам (тот же SyncStatus, что отдаёт движок синхронизации). */
export function SyncBadge({ phase, pending, quarantined = 0, className }: SyncBadgeProps) {
  const text = syncBadgeText(phase, pending, quarantined);
  const { icon, tone, spin } = look(phase, count(pending), count(quarantined));
  return (
    <Badge tone={tone} role="status" title={text} className={className} data-phase={phase}>
      <Icon name={icon} size={14} className={spin ? 'animate-spin' : undefined} />
      <span>{text}</span>
    </Badge>
  );
}
