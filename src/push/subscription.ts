/**
 * Подписка этого устройства на push: что умеет браузер, разрешение, подписка и отписка.
 * Всё читает из браузера в момент вызова (ничего не кэширует), каждое ожидание — с таймаутом: subscribe() бывает «зависает».
 * Разрешение на уведомления запрашивается ТОЛЬКО функцией requestPermission(), а её вызывает только нажатие кнопки.
 * Ничего здесь не логирует и не кладёт в сообщения адрес push-службы и ключи.
 */
import { isStandalone } from '@/components/InstallHint';
import { getDeviceId } from '@/db';
import { encodeBase64Url } from './config';
import type { PushSubscriptionInput } from './contract';
import { TimeoutError, withTimeout } from './util';

/* ------------------------------ что умеет устройство ------------------------------ */

export type SupportKind = 'supported' | 'insecure' | 'ios-old' | 'ios-install' | 'unsupported';

/** Всё, что нужно знать об устройстве, чтобы решить, умеет ли оно push. Собирается из браузера или задаётся в тесте. */
export interface SupportEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Запущено с экрана «Домой» (display-mode: standalone / navigator.standalone). */
  standalone: boolean;
  secure: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function browserSupportEnv(): SupportEnv {
  const w = typeof window === 'undefined' ? undefined : window;
  const n = typeof navigator === 'undefined' ? undefined : navigator;
  let standalone = false;
  try {
    standalone = n !== undefined && w !== undefined && isStandalone();
  } catch {
    standalone = false;
  }
  return {
    userAgent: n?.userAgent ?? '',
    maxTouchPoints: n?.maxTouchPoints ?? 0,
    standalone,
    secure: w?.isSecureContext !== false,
    hasServiceWorker: n !== undefined && 'serviceWorker' in n && !!n.serviceWorker,
    hasPushManager: w !== undefined && 'PushManager' in w,
    hasNotification: w !== undefined && 'Notification' in w,
  };
}

export const isIosDevice = (env: Pick<SupportEnv, 'userAgent' | 'maxTouchPoints'>): boolean =>
  /iPad|iPhone|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);

/** Версия iOS из строки браузера ('CPU iPhone OS 16_4 like Mac OS X' → 16.4). null — не видно (например, iPad под видом Mac). */
export function iosVersion(userAgent: string): number | null {
  const m = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

/**
 * Умеет ли устройство присылать напоминания. На iPhone push работает ТОЛЬКО в приложении, добавленном на экран «Домой»,
 * и только на iOS 16.4 и новее; во вкладке Safari его нет вообще (PushManager не существует).
 */
export function classifySupport(env: SupportEnv): SupportKind {
  if (isIosDevice(env)) {
    const v = iosVersion(env.userAgent);
    if (v !== null && v < 16.04) return 'ios-old';
    if (!env.standalone) return 'ios-install';
  }
  if (!env.secure) return 'insecure';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  return 'supported';
}

export const detectSupport = (): SupportKind => classifySupport(browserSupportEnv());

/** Объяснение для человека, почему напоминания здесь недоступны. 'supported' — объяснять нечего (null). */
export function explainSupport(kind: SupportKind): string | null {
  switch (kind) {
    case 'supported':
      return null;
    case 'ios-old':
      return 'На этом iPhone напоминания работают с iOS 16.4. Обновите систему: Настройки → Основные → Обновление ПО.';
    case 'ios-install':
      return 'На iPhone напоминания работают только в приложении, добавленном на экран «Домой». Добавьте Sumoima (как это сделать, написано ниже в разделе «Установка на телефон»), откройте её с экрана «Домой» и вернитесь сюда.';
    case 'insecure':
      return 'Уведомления работают только на защищённой странице (адрес должен начинаться с https).';
    case 'unsupported':
      return 'Этот браузер не умеет присылать уведомления. Откройте Sumoima в Chrome, Edge или Firefox, а на iPhone — в приложении с экрана «Домой».';
  }
}

export const DENIED_HELP =
  'Уведомления для Sumoima запрещены в настройках. Разрешите их: на iPhone — Настройки → Уведомления → Sumoima; на Android и компьютере — значок замка рядом с адресом → Уведомления → Разрешить. Потом вернитесь сюда.';

/* ------------------------------ разрешение ------------------------------ */

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function readPermission(): PermissionState {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    const p = Notification.permission;
    return p === 'granted' || p === 'denied' || p === 'default' ? p : 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * Спрашивает разрешение. ВЫЗЫВАТЬ ТОЛЬКО ИЗ НАЖАТИЯ КНОПКИ и до любых других await (иначе iPhone не покажет вопрос).
 * Без таймаута: человек может думать над вопросом сколько угодно. Не бросает ошибок.
 */
export function requestPermission(): Promise<PermissionState> {
  return new Promise<PermissionState>((resolve) => {
    try {
      if (typeof Notification === 'undefined') return resolve('unsupported');
      let done = false;
      const finish = (answer?: unknown) => {
        if (done) return;
        done = true;
        resolve(answer === 'granted' || answer === 'denied' || answer === 'default' ? answer : readPermission());
      };
      // Старые Safari принимают только функцию обратного вызова, новые возвращают Promise: поддерживаем оба.
      const maybe = Notification.requestPermission(finish) as unknown as Promise<unknown> | undefined;
      if (maybe && typeof maybe.then === 'function') maybe.then(finish, () => finish());
    } catch {
      resolve(readPermission());
    }
  });
}

/* ------------------------------ подписка ------------------------------ */

export type SubscribeFailure = 'unsupported' | 'denied' | 'no-permission' | 'no-worker' | 'timeout' | 'failed' | 'bad-subscription';

export type SubscribeResult =
  | { ok: true; subscription: PushSubscription; input: PushSubscriptionInput }
  | { ok: false; reason: SubscribeFailure; message: string };

const SUBSCRIBE_TIMEOUT_MS = 30_000;
const WORKER_TIMEOUT_MS = 10_000;

const failure = (reason: SubscribeFailure, message: string): { ok: false; reason: SubscribeFailure; message: string } => ({ ok: false, reason, message });

const FAIL_TEXT: Record<SubscribeFailure, string> = {
  unsupported: 'Это устройство не умеет присылать уведомления.',
  denied: DENIED_HELP,
  'no-permission': 'Разрешение на уведомления не получено. Нажмите кнопку ещё раз и выберите «Разрешить».',
  'no-worker': 'Служебный модуль приложения ещё не запущен. Закройте и снова откройте Sumoima, затем повторите.',
  timeout: 'Служба уведомлений телефона долго не отвечает. Проверьте интернет и попробуйте ещё раз.',
  failed: 'Не получилось включить уведомления на этом устройстве. Проверьте интернет и попробуйте ещё раз.',
  'bad-subscription': 'Браузер выдал подписку в неожиданном виде. Обновите браузер и попробуйте ещё раз.',
};
const fail = (reason: SubscribeFailure) => failure(reason, FAIL_TEXT[reason]);

/** Регистрация сервис-воркера (с ожиданием, пока он станет активным). null — воркера нет или он не запустился вовремя. */
export async function getWorkerRegistration(timeoutMs = WORKER_TIMEOUT_MS): Promise<ServiceWorkerRegistration | null> {
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return null;
    return await withTimeout(sw.ready, timeoutMs);
  } catch {
    return null;
  }
}

/** Текущая подписка браузера на push (null — нет или узнать не удалось). */
export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getWorkerRegistration(3000);
    if (!reg) return null;
    return await withTimeout(reg.pushManager.getSubscription(), 5000);
  } catch {
    return null;
  }
}

export function matchesVapidKey(sub: PushSubscription, key: Uint8Array): boolean {
  const have = sub.options?.applicationServerKey;
  if (!have) return true; // браузер не показывает ключ — сравнить нечем, считаем подходящим
  const a = new Uint8Array(have as ArrayBuffer);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/** Подписка в виде, который принимает таблица push_subscriptions. null — у браузерной подписки нет адреса или ключей. */
export function toSubscriptionInput(sub: PushSubscription, deviceId = getDeviceId(), userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): PushSubscriptionInput | null {
  try {
    const json = sub.toJSON() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof json.endpoint === 'string' ? json.endpoint : sub.endpoint;
    let p256dh = json.keys?.p256dh;
    let auth = json.keys?.auth;
    if (typeof p256dh !== 'string' && typeof sub.getKey === 'function') {
      const k = sub.getKey('p256dh');
      if (k) p256dh = encodeBase64Url(new Uint8Array(k));
    }
    if (typeof auth !== 'string' && typeof sub.getKey === 'function') {
      const k = sub.getKey('auth');
      if (k) auth = encodeBase64Url(new Uint8Array(k));
    }
    if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
    return { deviceId, endpoint, p256dh, authSecret: auth, userAgent: userAgent.slice(0, 300) };
  } catch {
    return null;
  }
}

export interface EnsureOptions {
  /** true — прежнюю подписку сначала снять и оформить новую (адрес станет новым). */
  fresh?: boolean;
}

/**
 * Оформляет подписку этого устройства (или берёт действующую, если ключ тот же). Разрешение должно быть уже выдано.
 * Прежняя подписка с другим ключом сервера (ключ VAPID сменили) снимается и заменяется. Не бросает ошибок.
 */
export async function ensureSubscription(vapidKey: Uint8Array, options: EnsureOptions = {}): Promise<SubscribeResult> {
  if (classifySupport(browserSupportEnv()) !== 'supported') return fail('unsupported');
  const permission = readPermission();
  if (permission === 'denied') return fail('denied');
  if (permission !== 'granted') return fail('no-permission');
  const reg = await getWorkerRegistration();
  if (!reg) return fail('no-worker');
  try {
    let sub = await withTimeout(reg.pushManager.getSubscription(), 8000);
    if (sub && (options.fresh === true || !matchesVapidKey(sub, vapidKey))) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    if (!sub) {
      sub = await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey as BufferSource }), SUBSCRIBE_TIMEOUT_MS);
    }
    const input = toSubscriptionInput(sub);
    if (!input) return fail('bad-subscription');
    return { ok: true, subscription: sub, input };
  } catch (e) {
    if (e instanceof TimeoutError) return fail('timeout');
    if ((e as { name?: unknown } | null)?.name === 'NotAllowedError') return fail('denied');
    return fail('failed');
  }
}

/** Снимает подписку браузера на этом устройстве. true — подписки больше нет (снята или её и не было). Не бросает ошибок. */
export async function unsubscribeThisDevice(): Promise<boolean> {
  try {
    const sub = await getBrowserSubscription();
    if (!sub) return true;
    return await withTimeout(sub.unsubscribe(), 5000);
  } catch {
    return false;
  }
}
