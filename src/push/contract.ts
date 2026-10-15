/**
 * ДОГОВОР напоминаний (push), общий для приложения, service worker и серверной функции supabase/functions/send-reminders.
 * Менять только вместе со всеми тремя. Таблицы описаны в supabase/schema.sql, раздел 9.
 *
 * Как это работает: приложение просит разрешение на уведомления, подписывается на push браузера (Web Push, ключ VAPID) и
 * сохраняет подписку в public.push_subscriptions; настройки — в public.reminder_settings. Раз в час расписание (pg_cron или внешний
 * планировщик) вызывает Edge Function send-reminders: для каждого пользователя, у которого сейчас «его» час, она смотрит данные
 * (регулярные платежи, долги, операции за сегодня, лимиты бюджета) и шлёт шифрованное push-сообщение (PushPayload). Service worker показывает его,
 * по нажатию открывает приложение на нужном экране. На iPhone это работает ТОЛЬКО в приложении, добавленном на экран «Домой» (iOS 16.4+).
 */

export type ReminderKind = 'payment' | 'debt' | 'daily' | 'budget';

/** Настройки напоминаний в виде для приложения (колонки reminder_settings в camelCase). */
export interface ReminderSettings {
  enabled: boolean;
  /** Час (0–23) по часовому поясу timezone, когда присылать. */
  hourLocal: number;
  /** IANA-имя часового пояса ('Asia/Dushanbe'); берётся с устройства. */
  timezone: string;
  remindPayments: boolean;
  remindDebts: boolean;
  /** Каждый день напоминать внести траты, если за сегодня нет ни одной операции. */
  remindDaily: boolean;
  /** Напоминать, когда расходы месяца дошли до 70% / 90% лимита бюджета или превысили его (в уведомлении только процент, без сумм). */
  remindBudgets: boolean;
  /** true — в уведомлении названия платежей, имена и названия лимитов; false (по умолчанию) — только общие слова и числа. Суммы не пишутся никогда. */
  showDetails: boolean;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  hourLocal: 9,
  timezone: 'Asia/Dushanbe',
  remindPayments: true,
  remindDebts: true,
  remindDaily: false,
  remindBudgets: false,
  showDetails: false,
};

/** Подписка устройства, как её отдаёт PushSubscription.toJSON() (ключи в base64url). */
export interface PushSubscriptionInput {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
  userAgent: string;
}

/** Содержимое push-сообщения (шифруется). Service worker (public/push-handler.js) показывает его как уведомление. */
export interface PushPayload {
  title: string;
  body: string;
  /** Куда перейти по нажатию: часть адреса после «#», например '/recurring' или '/debts/<id>' или '/' — относительно приложения. */
  url: string;
  /** Одинаковый tag заменяет прежнее уведомление, а не копит стопку. */
  tag: string;
}

/** Предел размера открытого текста push-сообщения (в байтах UTF-8), с запасом до лимита Web Push (около 4 КБ). */
export const PUSH_PAYLOAD_MAX_BYTES = 2000;

/** Имена таблиц (для запросов приложения). */
export const PUSH_TABLES = { subscriptions: 'push_subscriptions', settings: 'reminder_settings' } as const;

/**
 * Серверная функция send-reminders принимает POST:
 *  - Authorization: Bearer <CRON_SECRET>, тело {} — плановый запуск (раз в час): шлёт всем, у кого сейчас их час;
 *  - Authorization: Bearer <JWT вошедшего пользователя>, тело {"action":"test"} — «Проверить уведомление»: шлёт пробное
 *    сообщение на ВСЕ подписки только этого пользователя (чужим — никогда).
 * Ответ JSON { ok: boolean, sent: number, ... }.
 */
export const SEND_REMINDERS_FUNCTION = 'send-reminders';
