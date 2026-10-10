import { formatDayLabel, todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import type { SyncStatus } from '@/sync/transport';

export type SyncTone = 'ok' | 'info' | 'warn' | 'bad';

export interface SyncDescription {
  headline: string;
  detail?: string;
  tone: SyncTone;
}

const records = (n: number) => `${n} ${pluralRu(n, 'запись', 'записи', 'записей')}`;

/** Состояние синхронизации человеческим языком. «Всё отправлено» говорим только когда это правда. */
export function describeSync(status: SyncStatus): SyncDescription {
  const { phase, pending, quarantined, lastSyncedAt, lastError } = status;
  const rejected = quarantined > 0 ? `Сервер не принял ${records(quarantined)} — они показаны ниже.` : '';
  const join = (...parts: string[]) => parts.filter((p) => p !== '').join(' ');

  switch (phase) {
    case 'syncing':
      return { headline: 'Идёт синхронизация…', detail: rejected || undefined, tone: 'info' };
    case 'offline':
      return {
        headline: 'Нет связи с облаком',
        detail: join(
          pending > 0 ? `Ждут отправки: ${records(pending)}.` : '',
          'Всё сохранено на устройстве и отправится, когда появится сеть.',
          rejected,
        ),
        tone: 'warn',
      };
    case 'error':
      return {
        headline: 'Не удалось синхронизировать',
        detail: join(
          lastError ? `Причина: ${lastError}.` : '',
          pending > 0 ? `Ждут отправки: ${records(pending)}.` : '',
          'Данные на устройстве целы, попробуем ещё раз.',
          rejected,
        ),
        tone: 'bad',
      };
    case 'auth-required':
      return {
        headline: 'Нужно войти заново',
        detail: join(
          pending > 0 ? `Ждут отправки: ${records(pending)}.` : '',
          'Данные сохранены на устройстве, после входа они отправятся.',
          rejected,
        ),
        tone: 'bad',
      };
    case 'idle':
      if (pending > 0) {
        return {
          headline: `Ждут отправки: ${records(pending)}`,
          detail: join('Отправятся автоматически.', rejected),
          tone: 'info',
        };
      }
      if (quarantined > 0) return { headline: `Сервер не принял ${records(quarantined)}`, detail: 'Они показаны ниже.', tone: 'bad' };
      if (lastSyncedAt) return { headline: 'Всё отправлено в облако', tone: 'ok' };
      return { headline: 'Ещё не синхронизировалось', detail: 'Данные пока только на этом устройстве.', tone: 'info' };
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** '2026-10-10T11:40:00.000Z' → «Сегодня, 16:40» (по местным часам). Некорректное значение → «неизвестно». */
export function formatDateTime(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'неизвестно';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'неизвестно';
  const today = todayLocal(now);
  const day = formatDayLabel(todayLocal(d), today);
  return `${day}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
