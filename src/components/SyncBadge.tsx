import type { SyncStatus } from '@/sync/transport';
import { pluralRu } from '@/lib/plural';
import { Badge, type BadgeTone } from './Badge';
import { Icon, type IconName } from './Icon';

/**
 * quarantined — записи, которые сервер не принял: в очереди их уже нет, но и на сервере тоже.
 * lastSyncedAt — когда последний цикл дошёл до конца. Без него «Синхронизировано» не показывается никогда.
 * Передавайте весь статус движка (`<SyncBadge {...status} />`), иначе эти сигналы потеряются.
 */
export type SyncBadgeProps = Pick<SyncStatus, 'phase' | 'pending'> &
  Partial<Pick<SyncStatus, 'quarantined' | 'lastSyncedAt'>> & { className?: string };

const queued = (n: number) => `${n} ${pluralRu(n, 'запись', 'записи', 'записей')} в очереди`;

/** Мусорное число (NaN, отрицательное, дробное) считаем нулём/целым. */
const count = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Был ли хотя бы один законченный цикл: нужна настоящая метка времени. null, пусто, мусор и «не передано» — нет. */
export const hasSynced = (lastSyncedAt: string | null | undefined): boolean =>
  typeof lastSyncedAt === 'string' && lastSyncedAt !== '' && !Number.isNaN(Date.parse(lastSyncedAt));

/**
 * Текст индикатора. Вынесен отдельно, чтобы его можно было проверить тестом без отрисовки.
 * «Синхронизировано» — только если очередь пуста, сервер ничего не отверг И был законченный цикл (lastSyncedAt).
 * До первого цикла — нейтральное «Ещё не синхронизировано».
 */
export function syncBadgeText(
  phase: SyncStatus['phase'],
  pending: number,
  quarantined = 0,
  lastSyncedAt?: string | null,
): string {
  const n = count(pending);
  const q = count(quarantined);
  // Отвергнутые сервером записи видны в любой фазе: «Синхронизировано» при них было бы ложным успокоением.
  const rejected = q > 0 ? `не принято сервером: ${q}` : '';
  const withRejected = (base: string) => (rejected ? `${base} · ${rejected}` : base);
  switch (phase) {
    case 'idle':
      if (n === 0) {
        if (q > 0) return `Не принято сервером: ${q}`;
        return hasSynced(lastSyncedAt) ? 'Синхронизировано' : 'Ещё не синхронизировано';
      }
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

/** Подсказка при наведении/долгом нажатии: то же, что в тексте, и понятное «что делать» там, где это нужно. */
export function syncBadgeHint(
  phase: SyncStatus['phase'],
  pending: number,
  quarantined = 0,
  lastSyncedAt?: string | null,
): string {
  const text = syncBadgeText(phase, pending, quarantined, lastSyncedAt);
  if (phase === 'auth-required') {
    return `${text}. Войдите в аккаунт заново: пока вы не вошли, данные не отправляются в облако. Всё сохранено на устройстве.`;
  }
  if (phase === 'idle' && count(pending) === 0 && count(quarantined) === 0 && !hasSynced(lastSyncedAt)) {
    return `${text}. Данные пока только на этом устройстве: первая синхронизация ещё не завершилась.`;
  }
  return text;
}

function look(
  phase: SyncStatus['phase'],
  pending: number,
  quarantined: number,
  synced: boolean,
): { icon: IconName; tone: BadgeTone; spin: boolean } {
  switch (phase) {
    case 'idle':
      if (quarantined > 0) return { icon: 'alert', tone: 'danger', spin: false };
      if (pending > 0) return { icon: 'cloud', tone: 'brand', spin: false };
      return synced ? { icon: 'cloud-check', tone: 'neutral', spin: false } : { icon: 'cloud', tone: 'neutral', spin: false };
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
export function SyncBadge({ phase, pending, quarantined = 0, lastSyncedAt, className }: SyncBadgeProps) {
  const text = syncBadgeText(phase, pending, quarantined, lastSyncedAt);
  const { icon, tone, spin } = look(phase, count(pending), count(quarantined), hasSynced(lastSyncedAt));
  return (
    <Badge tone={tone} role="status" title={syncBadgeHint(phase, pending, quarantined, lastSyncedAt)} className={className} data-phase={phase}>
      <Icon name={icon} size={14} className={spin ? 'animate-spin' : undefined} />
      <span>{text}</span>
    </Badge>
  );
}
