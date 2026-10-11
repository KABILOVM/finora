/**
 * Сверка подписки на push с сервером: «пожарный» на случай, когда подписка протухла, сменилась или пропала.
 * Работает молча: ничего не показывает человеку и не бросает ошибок (результат — короткое слово для журнала и тестов).
 * В журнал идёт только слово-результат, без почты, адресов push и ключей.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { LOCAL_USER_ID } from '@/auth/config';
import { getDeviceId } from '@/db';
import {
  listActiveSubscriptions,
  readReminderSettings,
  revokeOtherEndpointsOfDevice,
  saveReminderSettings,
  saveSubscription,
} from './api';
import { getVapidConfig, type VapidConfig } from './config';
import { isDeviceOptedOut } from './deviceFlag';
import {
  detectSupport,
  ensureSubscription,
  getBrowserSubscription,
  matchesVapidKey,
  readPermission,
  toSubscriptionInput,
  type PermissionState,
  type SubscribeResult,
  type SupportKind,
} from './subscription';
import { deviceTimezone, isOnline, withTimeout } from './util';

export type KeeperOutcome =
  | 'skipped-no-cloud'
  | 'skipped-not-configured'
  | 'skipped-unsupported'
  | 'skipped-permission'
  | 'skipped-offline'
  | 'skipped-signed-out'
  | 'skipped-disabled'
  | 'skipped-device-off'
  | 'skipped-busy'
  | 'ok'
  | 'updated'
  | 'failed';

/** Всё, что сверка берёт из окружения; в тестах подменяется. */
export interface KeeperDeps {
  vapid(): VapidConfig;
  support(): SupportKind;
  permission(): PermissionState;
  online(): boolean;
  timezone(): string;
  deviceId(): string;
  /** Человек выключил напоминания на этом устройстве (см. deviceFlag). */
  optedOut(userId: string): boolean;
  browserSubscription(): Promise<PushSubscription | null>;
  ensure(key: Uint8Array, options?: { fresh?: boolean }): Promise<SubscribeResult>;
}

export const defaultKeeperDeps: KeeperDeps = {
  vapid: getVapidConfig,
  support: detectSupport,
  permission: readPermission,
  online: isOnline,
  timezone: deviceTimezone,
  deviceId: () => getDeviceId(),
  optedOut: isDeviceOptedOut,
  browserSubscription: getBrowserSubscription,
  ensure: ensureSubscription,
};

/** Идентификатор вошедшего пользователя по сохранённой сессии (без сети). null — никто не вошёл или это локальный режим. */
async function currentUserId(client: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await withTimeout(client.auth.getSession(), 4000);
    const id: unknown = data.session?.user?.id;
    return typeof id === 'string' && id !== '' && id !== LOCAL_USER_ID ? id : null;
  } catch {
    return null;
  }
}

/** Подписку браузера записать на сервер (и убрать прежние адреса этого устройства). */
async function saveCurrent(client: SupabaseClient, sub: PushSubscription, deviceId: string): Promise<boolean> {
  const input = toSubscriptionInput(sub, deviceId);
  if (!input) return false;
  const saved = await saveSubscription(client, input);
  if (!saved.ok) return false;
  await revokeOtherEndpointsOfDevice(client, deviceId, input.endpoint);
  return true;
}

/**
 * Одна сверка. Условия: облако есть, человек вошёл, разрешение выдано, напоминания включены (enabled=true на сервере).
 *  1. часовой пояс устройства изменился — обновляем timezone в настройках;
 *  2. подписки в браузере нет, а разрешение есть — оформляем заново и сохраняем;
 *  3. подписка в браузере есть:
 *     - её адрес записан на сервере у этого пользователя — всё в порядке;
 *     - иначе (адреса нет у этого пользователя: его сменил браузер, или подписку создал другой человек на этом же телефоне,
 *       или запись пропала) — ВСЕГДА оформляем СВОЮ новую подписку, а не забираем найденную: один адрес на двоих означал бы,
 *       что чьи-то напоминания приходят на экран другого человека.
 */
export async function runKeeperCheck(client: SupabaseClient | null, overrides: Partial<KeeperDeps> = {}): Promise<KeeperOutcome> {
  const d: KeeperDeps = { ...defaultKeeperDeps, ...overrides };
  try {
    if (!client) return 'skipped-no-cloud';
    const vapid = d.vapid();
    if (!vapid.ok) return 'skipped-not-configured';
    if (d.support() !== 'supported') return 'skipped-unsupported';
    if (d.permission() !== 'granted') return 'skipped-permission';
    if (!d.online()) return 'skipped-offline';
    const userId = await currentUserId(client);
    if (userId === null) return 'skipped-signed-out';
    if (d.optedOut(userId)) return 'skipped-device-off';

    const settings = await readReminderSettings(client);
    if (!settings.ok) return 'failed';
    if (settings.value === null || !settings.value.enabled) return 'skipped-disabled';

    let changed = false;
    const deviceId = d.deviceId();
    const current = await d.browserSubscription();

    if (current === null) {
      const made = await d.ensure(vapid.bytes);
      if (!made.ok || !(await saveCurrent(client, made.subscription, deviceId))) return 'failed';
      changed = true;
    } else {
      const stored = await listActiveSubscriptions(client);
      if (!stored.ok) return 'failed';
      const known = stored.value.some((s) => s.endpoint === current.endpoint);
      if (known && matchesVapidKey(current, vapid.bytes)) {
        // всё в порядке
      } else {
        const made = await d.ensure(vapid.bytes, { fresh: true });
        if (!made.ok || !(await saveCurrent(client, made.subscription, deviceId))) return 'failed';
        changed = true;
      }
    }

    const tz = d.timezone();
    if (tz !== settings.value.timezone) {
      const saved = await saveReminderSettings(client, { timezone: tz });
      if (!saved.ok) return 'failed';
      changed = true;
    }
    return changed ? 'updated' : 'ok';
  } catch {
    return 'failed';
  }
}
