/**
 * Состояние и действия раздела «Напоминания» в Настройках. Главное правило: интерфейс показывает «включено» только после
 * того, как это подтвердил сервер (ответ на запись), и не раньше. Все действия защищены от двойного нажатия и не бросают ошибок.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppEnv } from '@/app/env';
import { useAuth } from '@/auth/AuthProvider';
import { getDeviceId } from '@/db';
import {
  fail,
  listActiveSubscriptions,
  readReminderSettings,
  revokeDeviceSubscriptions,
  revokeOtherEndpointsOfDevice,
  saveReminderSettings,
  saveSubscription,
  sendTestReminder,
  type PushClient,
} from './api';
import { getVapidConfig } from './config';
import type { ReminderSettings } from './contract';
import { setDeviceOptedOut } from './deviceFlag';
import {
  detectSupport,
  ensureSubscription,
  getBrowserSubscription,
  readPermission,
  requestPermission,
  unsubscribeThisDevice,
  type PermissionState,
  type SupportKind,
} from './subscription';
import { deviceTimezone, isOnline, withPushLock } from './util';

export type RemindersPhase = 'no-cloud' | 'not-configured' | 'unsupported' | 'loading' | 'load-failed' | 'ready';
export type RemindersBusy = null | 'enable' | 'disable' | 'save' | 'test';
export interface RemindersNotice {
  tone: 'ok' | 'error' | 'info';
  text: string;
}

export interface RemindersModel {
  phase: RemindersPhase;
  support: SupportKind;
  permission: PermissionState;
  /** Настройки, как их подтвердил сервер; null — записи ещё нет (всё выключено). */
  settings: ReminderSettings | null;
  /** Правка, которая сейчас сохраняется (показываем её, пока сервер не ответил). */
  pending: Partial<ReminderSettings> | null;
  /** На этом устройстве есть подписка, и сервер о ней знает. */
  deviceOn: boolean;
  busy: RemindersBusy;
  notice: RemindersNotice | null;
  loadError: string | null;
  enable(): void;
  disable(): void;
  save(patch: Partial<ReminderSettings>): void;
  test(): void;
  reload(): void;
}

export function useReminders(): RemindersModel {
  const { client } = useAppEnv();
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const cloud = client !== null && auth.cloud;
  const vapid = useMemo(() => getVapidConfig(), []);

  const [support, setSupport] = useState<SupportKind>(() => detectSupport());
  const [permission, setPermission] = useState<PermissionState>(() => readPermission());
  const [loadState, setLoadState] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [deviceOn, setDeviceOn] = useState(false);
  const [busy, setBusyState] = useState<RemindersBusy>(null);
  const [pending, setPending] = useState<Partial<ReminderSettings> | null>(null);
  const [notice, setNotice] = useState<RemindersNotice | null>(null);

  const alive = useRef(true);
  const busyRef = useRef<RemindersBusy>(null);
  const loadNo = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setBusy = (b: RemindersBusy) => {
    busyRef.current = b;
    // Началось действие: чтение, запущенное до него, устарело и не должно потом затереть его результат.
    if (b !== null) loadNo.current++;
    if (alive.current) setBusyState(b);
  };
  const say = (tone: RemindersNotice['tone'], text: string) => {
    if (alive.current) setNotice({ tone, text });
  };

  const active = cloud && vapid.ok && support === 'supported' && userId !== null;

  /** Читает сервер и браузер. first — первая загрузка (показываем «проверяем»), иначе обновляем молча. */
  const load = useCallback(
    async (first: boolean) => {
      if (!active || !client) return;
      const mine = ++loadNo.current;
      const current = () => alive.current && loadNo.current === mine;
      if (first) {
        setLoadState('loading');
        setLoadError(null);
      }
      const perm = readPermission();
      const [s, subs, browserSub] = await Promise.all([readReminderSettings(client as PushClient), listActiveSubscriptions(client as PushClient), getBrowserSubscription()]);
      if (!current()) return;
      setPermission(perm);
      if (!s.ok || !subs.ok) {
        // при тихом обновлении старые данные оставляем: пропавшая на минуту сеть не должна «выключать» раздел
        if (first || busyRef.current === null) {
          setLoadError(!s.ok ? s.error.message : !subs.ok ? subs.error.message : null);
          if (first) setLoadState('failed');
        }
        return;
      }
      if (busyRef.current !== null) return; // идёт действие — его результат главнее старого чтения
      setSettings(s.value);
      setDeviceOn(perm === 'granted' && browserSub !== null && subs.value.some((x) => x.endpoint === browserSub.endpoint));
      setLoadError(null);
      setLoadState('ready');
    },
    [active, client],
  );

  useEffect(() => {
    if (active) void load(true);
  }, [active, load, userId]);

  // Вернулись на вкладку / появилась сеть: разрешение могли поменять в системных настройках — читаем заново, молча.
  useEffect(() => {
    if (!cloud) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      setSupport(detectSupport());
      setPermission(readPermission());
      if (active && busyRef.current === null) void load(false);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [cloud, active, load]);

  const enable = () => {
    if (busyRef.current !== null || !active || !client || !vapid.ok || userId === null) return;
    setBusy('enable');
    setNotice(null);
    void (async () => {
      try {
        if (!isOnline()) return say('error', fail('offline').error.message);
        // Вопрос о разрешении — ПЕРВЫЙ await внутри нажатия: иначе iPhone его не покажет.
        let perm = readPermission();
        if (perm === 'default') perm = await requestPermission();
        if (!alive.current) return;
        setPermission(perm);
        if (perm === 'denied') return; // объяснение, как включить, постоянно видно в разделе
        if (perm !== 'granted') return say('info', 'Разрешение на уведомления не получено. Нажмите кнопку ещё раз и выберите «Разрешить».');

        setDeviceOptedOut(userId, false);
        await withPushLock(async () => {
          // fresh: если в браузере уже есть подписка, которую сервер за этим человеком не знает (осталась от другого человека на этом
          // телефоне или запись пропала), берём НОВУЮ — чтобы чужие напоминания не приходили на этот экран.
          const made = await ensureSubscription(vapid.bytes, { fresh: true });
          if (!made.ok) {
            if (made.reason === 'denied') {
              if (alive.current) setPermission('denied');
              return;
            }
            return say('error', made.message);
          }
          const saved = await saveSubscription(client as PushClient, made.input);
          if (!saved.ok) return say('error', saved.error.message);
          await revokeOtherEndpointsOfDevice(client as PushClient, made.input.deviceId, made.input.endpoint);
          const on = await saveReminderSettings(client as PushClient, { enabled: true, timezone: deviceTimezone() });
          if (!on.ok) return say('error', `Устройство подключено, но включить напоминания не удалось. ${on.error.message}`);
          if (!alive.current) return;
          setSettings(on.value);
          setDeviceOn(true);
          say('ok', 'Готово. Нажмите «Проверить уведомление», чтобы убедиться, что оно приходит.');
        });
      } catch {
        say('error', 'Не получилось включить напоминания. Попробуйте ещё раз.');
      } finally {
        setBusy(null);
      }
    })();
  };

  const disable = () => {
    if (busyRef.current !== null || !active || !client || userId === null) return;
    setBusy('disable');
    setNotice(null);
    void (async () => {
      try {
        if (!isOnline()) return say('error', fail('offline').error.message);
        await withPushLock(async () => {
          // Сначала сервер (там отзыв подписи), потом браузер: если сети нет, ничего не меняется и экран не врёт.
          const sub = await getBrowserSubscription();
          const revoked = await revokeDeviceSubscriptions(client as PushClient, { deviceId: getDeviceId(), endpoint: sub?.endpoint ?? null });
          if (!revoked.ok) return say('error', revoked.error.message);
          setDeviceOptedOut(userId, true);
          await unsubscribeThisDevice();
          if (alive.current) setDeviceOn(false);
          if (revoked.value.remaining > 0) return say('ok', 'На этом устройстве напоминания выключены. На других устройствах они остаются.');
          const off = await saveReminderSettings(client as PushClient, { enabled: false });
          if (!off.ok) return say('error', `На этом устройстве напоминания выключены, но настройку аккаунта сохранить не удалось. ${off.error.message}`);
          if (alive.current) setSettings(off.value);
          say('ok', 'Это устройство больше не получает уведомления.');
        });
      } catch {
        say('error', 'Не получилось выключить напоминания. Попробуйте ещё раз.');
      } finally {
        setBusy(null);
      }
    })();
  };

  const save = (patch: Partial<ReminderSettings>) => {
    if (busyRef.current !== null || !active || !client) return;
    setBusy('save');
    setNotice(null);
    setPending(patch);
    void (async () => {
      try {
        const r = await saveReminderSettings(client as PushClient, patch);
        if (!r.ok) return say('error', `Не сохранилось. ${r.error.message}`);
        if (alive.current) setSettings(r.value);
      } catch {
        say('error', 'Не сохранилось. Попробуйте ещё раз.');
      } finally {
        if (alive.current) setPending(null);
        setBusy(null);
      }
    })();
  };

  const test = () => {
    if (busyRef.current !== null || !active || !client) return;
    setBusy('test');
    setNotice(null);
    void (async () => {
      try {
        const r = await sendTestReminder(client as PushClient);
        if (!r.ok) return say('error', r.error.message);
        say('ok', 'Отправили — ждите несколько секунд.');
      } catch {
        say('error', 'Не получилось отправить проверочное уведомление. Попробуйте ещё раз.');
      } finally {
        setBusy(null);
      }
    })();
  };

  let phase: RemindersPhase;
  if (!cloud) phase = 'no-cloud';
  else if (!vapid.ok) phase = 'not-configured';
  else if (support !== 'supported') phase = 'unsupported';
  else if (loadState === 'loading') phase = 'loading';
  else if (loadState === 'failed') phase = 'load-failed';
  else phase = 'ready';

  return {
    phase,
    support,
    permission,
    settings,
    pending,
    deviceOn,
    busy,
    notice,
    loadError,
    enable,
    disable,
    save,
    test,
    reload: () => void load(true),
  };
}
