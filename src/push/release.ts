/**
 * Освободить это устройство от напоминаний текущего пользователя — на случай выхода из аккаунта.
 * Без этого после «Выйти» подписка устройства остаётся записанной за вышедшим человеком, и его напоминания продолжают приходить
 * на экран, которым уже пользуется другой. Вызывать ДО signOut (пока сессия жива): отзывает подписки устройства на сервере и
 * снимает подписку в браузере. Настройки аккаунта (enabled) не трогает: при повторном входе сторож подпишет устройство заново.
 * Делает всё, что успеет за timeoutMs; не бросает ошибок.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeviceId } from '@/db';
import { revokeDeviceSubscriptions } from './api';
import { detectSupport, getBrowserSubscription, unsubscribeThisDevice } from './subscription';
import { withTimeout } from './util';

export async function releasePushOnThisDevice(client: SupabaseClient | null, timeoutMs = 2000): Promise<void> {
  if (!client || detectSupport() !== 'supported') return; // в таком браузере подписки быть не может
  try {
    await withTimeout(
      (async () => {
        const sub = await getBrowserSubscription();
        if (sub === null && typeof Notification !== 'undefined' && Notification.permission !== 'granted') return; // подписывать нечего
        await revokeDeviceSubscriptions(client, { deviceId: getDeviceId(), endpoint: sub?.endpoint ?? null });
        await unsubscribeThisDevice();
      })(),
      timeoutMs,
    );
  } catch {
    /* выход важнее: не получилось — не страшно, сервер сам уберёт мёртвый адрес */
  }
}
