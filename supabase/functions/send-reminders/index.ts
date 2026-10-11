/**
 * Edge Function «send-reminders»: раз в час смотрит, у кого сейчас «его» час, и шлёт push-напоминания (регулярные платежи,
 * долги, «внесите траты»); по кнопке «Проверить уведомление» шлёт пробное сообщение на устройства ВОШЕДШЕГО пользователя.
 * Договор: src/push/contract.ts и supabase/schema.sql, раздел 9. Файл САМОДОСТАТОЧЕН: его целиком вставляют в редактор
 * Edge Functions (Supabase → Edge Functions → Create function → send-reminders), относительных импортов нет
 * (кроме web-push: `npm:web-push@3.6.7` подгружается в момент первой отправки).
 *
 * !!! НА ЖИВОМ SUPABASE ЭТА ФУНКЦИЯ НЕ ЗАПУСКАЛАСЬ !!!
 * Проверено только эмуляторами: настоящая схема в PGlite + подмена PostgREST + подмена отправки. Не проверено: Deno и пакет
 * web-push в Supabase, шифрование и доставка через серверы Apple/Google/Mozilla, VAPID-ключи, pg_cron/pg_net. После
 * развёртывания пройди проверку «ПРОВЕРКА» ниже и посмотри логи функции (Edge Functions → send-reminders → Logs).
 * Блоки между маркерами SHARED:* — дословные копии из src/ (проверяет тест src/push-server/edge.test.ts).
 *
 * КАК РАЗВЕРНУТЬ (по шагам)
 *  1. Ключи VAPID (один раз, на своём компьютере): `npx web-push generate-vapid-keys`. Получится пара: Public Key (87 символов)
 *     и Private Key (43 символа). Приватный ключ — только в секреты функции (шаг 3), НИКУДА больше. Публичный ключ
 *     ещё нужен приложению: переменная VITE_VAPID_PUBLIC_KEY на хостинге (см. .env.example), затем пересобрать приложение.
 *     Ключи в паре, менять один без другого нельзя; если пару заменить, все устройства придётся подписать заново.
 *  2. Supabase → Edge Functions → Create function с именем send-reminders → вставь весь этот файл → Deploy.
 *     В настройках функции ОТКЛЮЧИ «Verify JWT» (или деплой с флагом --no-verify-jwt): секрет расписания — не JWT.
 *     Проверку токена пользователя функция делает сама (для кнопки «Проверить уведомление»).
 *  3. Edge Functions → Secrets, добавь четыре секрета:
 *       CRON_SECRET        длинная случайная строка БЕЗ пробелов, НЕ КОРОЧЕ 32 символов (короче — функция откажется работать)
 *       VAPID_PUBLIC_KEY   Public Key из шага 1
 *       VAPID_PRIVATE_KEY  Private Key из шага 1
 *       VAPID_SUBJECT      твой контакт для push-сервисов, латиницей: mailto:you@example.com  (или https://адрес-сайта)
 *     SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY платформа подставляет сама; в коде ключей нет и быть не должно.
 *     Необязательно: PUSH_EXTRA_HOSTS — через запятую точные имена хостов push-сервиса, если твой браузер использует
 *     не Google/Apple/Mozilla/Microsoft (по умолчанию адреса других хостов игнорируются: защита от чужих адресов в базе).
 *     Если CRON_SECRET уже создан для fetch-rates, он общий на проект: заводить второй не нужно.
 *  4. Расписание раз в час (pg_cron + pg_net; в этой среде НЕ запускалось — проверь у себя). Database → Extensions: включи
 *     pg_cron и pg_net. Затем в SQL Editor (если секрет в хранилище уже создан для fetch-rates, первую строку пропусти):
 *       select vault.create_secret('<тот же CRON_SECRET>', 'cron_secret');
 *       select cron.schedule('send-reminders-hourly', '5 * * * *', $$
 *         select net.http_post(
 *           url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
 *           headers := jsonb_build_object('Content-Type', 'application/json',
 *             'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
 *           body := '{}'::jsonb,
 *           timeout_milliseconds := 60000);
 *       $$);
 *     Время cron — UTC: '5 * * * *' = каждый час в :05. Часовой пояс человека функция учитывает сама. Запасной вариант без
 *     pg_cron: любой внешний планировщик (cron-job.org, GitHub Actions по расписанию), делающий тот же запрос раз в час.
 *     Отключить расписание: select cron.unschedule('send-reminders-hourly');
 *  5. ПРОВЕРКА (подставь свои значения):
 *       curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders -H "Authorization: Bearer <CRON_SECRET>" -d '{}'
 *     без заголовка или с чужим секретом ответ 401; не хватает настроек (секрет короче 32 символов, нет ключей VAPID) — 500
 *     {"ok":false,"error":"not_configured"}, а в логах функции написано, каких именно переменных не хватает.
 *     Успех: 200 и {"ok":true,"mode":"cron","users":N,"sent":N,...} — только счётчики. Кнопка «Проверить уведомление» в
 *     Настройках → Напоминания шлёт то же с токеном пользователя: {"action":"test"}.
 *
 * КАК ЭТО РАБОТАЕТ
 *  - Плановый запуск (Authorization: Bearer <CRON_SECRET>, тело {}): читает reminder_settings (enabled = true); для каждого
 *    пользователя считает ЕГО локальные дату и час по timezone (неверная зона — пропуск, остальные не страдают). Шлёт, если
 *    hour_local ≤ локальный час < hour_local + 6 (в пределах суток): пропущенный запуск cron не теряет напоминание дня.
 *    Повтор в тот же день исключает push_log (user_id, kind, ref, sent_on = локальная дата).
 *  - payments: живые не архивные правила с auto_post = 0 (при 1 платёж проводит само приложение): даты СЕГОДНЯ и просроченные за
 *    7 дней по расписанию (та же логика, что в приложении), для которых нет операции с id v5(правило, дата). Удалённая операция
 *    = «пропущено» = обработано.
 *  - debts: живые не архивные не закрытые долги со сроком сегодня, завтра или просроченным (до 30 дней), у которых остаток > 0.
 *  - daily: за локальное «сегодня» нет ни одной живой операции (любого вида).
 *  - На пользователя за запуск уходит ОДНО сообщение. Суммы в нём не пишутся никогда; названия — только если show_details = true.
 *  - Порядок: сначала запись в push_log (только новые пункты попадают в сообщение), потом отправка. Если ни одно устройство не
 *    приняло сообщение и причина не в «подписка мертва» (404/410), записи запуска из push_log убираются: следующий час повторит.
 *    Подписка с ответом 404/410 получает revoked_at и сбоем не считается.
 *  - Один телефон — один хозяин. Если два человека записаны на один и тот же адрес push (один вышел без отзыва подписки или без
 *    сети, второй вошёл на том же телефоне), напоминания получает только тот, кто подтвердил устройство позже (больше last_seen_at
 *    среди действующих подписок с этим адресом). У другого эта подписка пропускается (счётчик skippedSharedEndpoint), в журнал
 *    ничего не пишется: напоминание придёт, когда он подпишет своё устройство. Равные времена — не шлём никому. Не удалось
 *    выяснить хозяина (ошибка базы) — человек пропускается до следующего часа. Относится и к «Проверить уведомление».
 *  - У каждой отправки свой срок SEND_TIMEOUT_MS: зависшее соединение с push-сервисом считается сбоем (запись журнала снимается,
 *    следующий час повторит) и не держит остальных людей этого запуска.
 *  - Безопасность: проверка секрета постоянного времени; токен пользователя проверяется через сервер авторизации (auth/v1/user,
 *    как supabase.auth.getUser(jwt)); «test» шлёт ТОЛЬКО на подписки самого пользователя; адреса push принимаются только
 *    от известных push-сервисов; в логи и ответы не попадают ключи, адреса подписок, почта и тексты ошибок сервера.
 */

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Локальные копии типов приложения (src/domain/types.ts, src/push/contract.ts): здесь нельзя ничего импортировать.
type IsoDate = string;
type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
interface RecurringRule {
  frequency: Frequency;
  intervalN: number;
  startOn: IsoDate;
  endOn: IsoDate | null;
}

/** Содержимое push-сообщения (src/push/contract.ts → PushPayload). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}
/** Предел размера открытого текста сообщения в байтах UTF-8 (копия PUSH_PAYLOAD_MAX_BYTES; значение сверяет тест). */
export const PUSH_PAYLOAD_MAX_BYTES = 2000;

// <<< SHARED:schedule
/** Границы дат операции на сервере (включительно). */
export const SCHEDULE_MIN_DATE: IsoDate = '2000-01-01';
export const SCHEDULE_MAX_DATE: IsoDate = '2100-01-01';
/** Допустимый шаг: каждые 1…1000 периодов (как CHECK interval_n на сервере). */
export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 1000;

export type ScheduleRule = Pick<RecurringRule, 'frequency' | 'intervalN' | 'startOn' | 'endOn'>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const DAY_MS = 86_400_000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number, len: number) => String(n).padStart(len, '0');

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseYmd(s: unknown): Ymd | null {
  if (typeof s !== 'string') return null;
  const mt = DATE_RE.exec(s);
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Номер дня от 1970-01-01. Годы 2000…2100 — безопасно через Date.UTC. */
const dayNum = ({ y, m, d }: Ymd): number => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

function fromDayNum(n: number): IsoDate {
  const dt = new Date(n * DAY_MS);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

const fromYmd = ({ y, m, d }: Ymd): IsoDate => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

const MIN_DAY = dayNum(parseYmd(SCHEDULE_MIN_DATE) as Ymd);
const MAX_DAY = dayNum(parseYmd(SCHEDULE_MAX_DATE) as Ymd);

/** Настоящая дата в границах сервера (2000-01-01 … 2100-01-01). */
export function isScheduleDate(s: unknown): s is IsoDate {
  const ymd = parseYmd(s);
  if (!ymd) return false;
  const n = dayNum(ymd);
  return n >= MIN_DAY && n <= MAX_DAY;
}

/** Правило пригодно для расчёта: вид, шаг и даты в допустимых границах, конец не раньше начала. */
export function isValidSchedule(rule: ScheduleRule): boolean {
  if (!FREQUENCIES.includes(rule.frequency)) return false;
  if (!Number.isSafeInteger(rule.intervalN) || rule.intervalN < INTERVAL_MIN || rule.intervalN > INTERVAL_MAX) return false;
  if (!isScheduleDate(rule.startOn)) return false;
  if (rule.endOn !== null) {
    if (!isScheduleDate(rule.endOn)) return false;
    if (rule.endOn < rule.startOn) return false;
  }
  return true;
}

/** Дата k-го срабатывания (k ≥ 0); null — за верхней границей сервера. */
function dateAt(rule: ScheduleRule, start: Ymd, k: number): IsoDate | null {
  const n = rule.intervalN;
  switch (rule.frequency) {
    case 'daily':
    case 'weekly': {
      const v = dayNum(start) + k * n * (rule.frequency === 'weekly' ? 7 : 1);
      return v > MAX_DAY ? null : fromDayNum(v);
    }
    case 'monthly': {
      const idx = start.y * 12 + (start.m - 1) + k * n;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      if (y > 2100) return null;
      return fromYmd({ y, m, d: Math.min(start.d, daysInMonth(y, m)) });
    }
    case 'yearly': {
      const y = start.y + k * n;
      if (y > 2100) return null;
      return fromYmd({ y, m: start.m, d: Math.min(start.d, daysInMonth(y, start.m)) });
    }
  }
}

/** Верхний предел поиска: конец правила или граница сервера. */
const lastAllowed = (rule: ScheduleRule): IsoDate =>
  rule.endOn !== null && rule.endOn < SCHEDULE_MAX_DATE ? rule.endOn : SCHEDULE_MAX_DATE;

/** Приблизительный номер срабатывания, с которого стоит искать дату ≥ from (с запасом назад: дальше шагаем вперёд). */
function startIndex(rule: ScheduleRule, start: Ymd, from: IsoDate): number {
  const f = parseYmd(from);
  if (!f) return 0;
  const n = rule.intervalN;
  let k: number;
  switch (rule.frequency) {
    case 'daily':
      k = Math.floor((dayNum(f) - dayNum(start)) / n);
      break;
    case 'weekly':
      k = Math.floor((dayNum(f) - dayNum(start)) / (7 * n));
      break;
    case 'monthly':
      k = Math.floor(((f.y - start.y) * 12 + (f.m - start.m)) / n);
      break;
    case 'yearly':
      k = Math.floor((f.y - start.y) / n);
      break;
  }
  return Math.max(0, k - 1);
}

/**
 * Даты срабатывания правила в отрезке [from, to] (обе границы включительно), по возрастанию, без повторов.
 * Не раньше startOn, не позже endOn и не позже 2100-01-01. Пустой отрезок (from > to), некорректное правило или даты → [].
 */
export function occurrencesBetween(rule: ScheduleRule, from: IsoDate, to: IsoDate): IsoDate[] {
  if (!isValidSchedule(rule) || !isScheduleDate(from) || !isScheduleDate(to) || from > to) return [];
  const start = parseYmd(rule.startOn) as Ymd;
  const stop = to < lastAllowed(rule) ? to : lastAllowed(rule);
  const out: IsoDate[] = [];
  for (let k = startIndex(rule, start, from); ; k++) {
    const d = dateAt(rule, start, k);
    if (d === null || d > stop) break;
    if (d >= from) out.push(d);
  }
  return out;
}
// SHARED:schedule >>>

// <<< SHARED:ids
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatUuid(b: Uint8Array): string {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function parseUuid(uuid: string): Uint8Array {
  if (!isUuid(uuid)) throw new TypeError(`Некорректный UUID: ${String(uuid)}`);
  const h = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

/** SHA-1 на чистом JS — запасной путь, когда crypto.subtle нет (небезопасный контекст). Результат обязан совпадать с crypto.subtle. */
function sha1Fallback(data: Uint8Array): Uint8Array {
  const total = ((data.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = data.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80).fill(0);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      // копия в «чистый» ArrayBuffer: типы TS не любят Uint8Array поверх ArrayBufferLike
      return new Uint8Array(await subtle.digest('SHA-1', new Uint8Array(data)));
    } catch {
      // идём в запасной путь
    }
  }
  return sha1Fallback(data);
}

/** UUID v5 (RFC 4122): SHA-1 от «пространство имён + имя». Одинаковые входы дают одинаковый результат на любом устройстве. */
export async function uuidV5(namespaceUuid: string, name: string): Promise<string> {
  const ns = parseUuid(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const digest = (await sha1(input)).slice(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(digest);
}
// SHARED:ids >>>

// <<< SHARED:plural
/**
 * Склонение по числу: pluralRu(1, 'запись', 'записи', 'записей') → 'запись'; 2 → 'записи'; 5 → 'записей'; 21 → 'запись'.
 * Дробные и отрицательные числа обрабатываются по модулю целой части.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
// SHARED:plural >>>

// ====================== Ядро: чистые функции (без сети, базы и часов; «сейчас» передаётся) ======================

export const PAYMENT_LOOKBACK_DAYS = 7;
export const DEBT_OVERDUE_DAYS = 30;
/** Окно отправки: hour_local ≤ локальный час < hour_local + SEND_WINDOW_HOURS (в пределах суток). */
export const SEND_WINDOW_HOURS = 6;
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
/** Служебный service worker (public/push-handler.js) режет текст по 300 знаков: выше нет смысла. */
export const BODY_MAX_CHARS = 300;
export const NAME_MAX_CHARS = 40;
export const NAMES_SHOWN = 3;
export const MAX_SUBSCRIPTIONS_PER_USER = 20;
/** Сколько действующих подписок с одним адресом читаем при выяснении хозяина (людей в приложении единицы, запас большой). */
export const MAX_CLAIMS_PER_ENDPOINT = 50;
/**
 * Предел одной отправки. web-push сам прерывает только «простой» сокета (timeout: 10 с), а медленный или зависший ответ push-сервиса
 * он не ограничит; без своего предела одна такая отправка держала бы весь запуск до остановки платформой (около 150 с).
 */
export const SEND_TIMEOUT_MS = 15_000;
export const MAX_PAYMENT_CANDIDATES = 400;
export const MAX_DEBTS_PER_USER = 200;
export const MIN_SECRET_LENGTH = 32;
export const PUSH_TITLE = 'Finora';
/** Записи push_log старше стольких суток чистятся (нужны только текущему дню). */
export const LOG_KEEP_DAYS = 60;
/** Плановый запуск не начинает новых людей позже этого срока (у платформы жёсткий предел около 150 секунд). */
export const RUN_BUDGET_MS = 90_000;

export type LogKind = 'payment' | 'debt' | 'daily';
export interface LogEntry {
  kind: LogKind;
  ref: string;
}

/** Настройки напоминаний одного пользователя (reminder_settings в camelCase). */
export interface ReminderSettingsRow {
  userId: string;
  hourLocal: number;
  timezone: string;
  remindPayments: boolean;
  remindDebts: boolean;
  remindDaily: boolean;
  showDetails: boolean;
}

export interface RuleLite extends ScheduleRule {
  id: string;
  note: string;
}

export interface DebtLite {
  id: string;
  direction: 'lent' | 'borrowed';
  counterparty: string;
  principalMinor: number;
  currency: string;
  dueOn: IsoDate;
}

export interface DebtTxLite {
  debtId: string;
  kind: string;
  walletId: string;
  amountMinor: number;
}

export interface PushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
}

/** Действующая подписка с данным адресом push (чья-то): по ним решается, кому принадлежит устройство. Ключей здесь нет. */
export interface EndpointClaim {
  id: string;
  endpoint: string;
  /** last_seen_at так, как отдала база (дата и время с поясом): когда человек в последний раз подтвердил это устройство. */
  lastSeenAt: string;
}

const ONE_DAY = 86_400_000;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Дата 'ГГГГ-ММ-ДД' со сдвигом на n суток (арифметика по календарю UTC, летнего времени нет). */
export function shiftIso(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * ONE_DAY).toISOString().slice(0, 10);
}

/** Сколько суток от `from` до `to` (отрицательно, если `to` раньше). */
export function daysFromTo(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / ONE_DAY);
}

export interface LocalMoment {
  /** Локальная дата 'ГГГГ-ММ-ДД' в часовом поясе человека. */
  date: IsoDate;
  /** Локальный час 0–23. */
  hour: number;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat | null {
  const known = zoneFormats.get(timeZone);
  if (known !== undefined) return known;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    });
  } catch {
    f = null; // неизвестный часовой пояс
  }
  if (zoneFormats.size < 200) zoneFormats.set(timeZone, f);
  return f;
}

/**
 * Локальные дата и час момента `now` в часовом поясе timeZone (имя IANA, например 'Asia/Dushanbe'; переход на летнее время и
 * дробные смещения вроде Катманду UTC+5:45 учитывает Intl). Неверная зона или неверный момент → null.
 */
export function localMoment(now: Date, timeZone: unknown): LocalMoment | null {
  if (typeof timeZone !== 'string' || timeZone === '' || timeZone.length > 64 || Number.isNaN(now.getTime())) return null;
  const f = zoneFormat(timeZone);
  if (f === null) return null;
  const parts = f.formatToParts(now);
  const num = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const y = num('year');
  const m = num('month');
  const d = num('day');
  let h = num('hour');
  if (![y, m, d, h].every(Number.isInteger) || y < 1000) return null;
  if (h === 24) h = 0; // некоторые движки показывают полночь как 24
  if (h < 0 || h > 23 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { date: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, hour: h };
}

/** Входит ли локальный час в окно отправки [hourLocal, hourLocal + 6). Окно не переходит через полночь. */
export function inSendWindow(hourLocal: number, localHour: number): boolean {
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) return false;
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) return false;
  return localHour >= hourLocal && localHour < hourLocal + SEND_WINDOW_HOURS;
}

export interface PaymentCandidate {
  ruleId: string;
  date: IsoDate;
  note: string;
  /** Дата раньше сегодняшней. */
  overdue: boolean;
}

/**
 * Даты платежей, до которых дошло время: сегодня и за последние 7 суток (по расписанию, та же логика, что в приложении).
 * Какие из них уже проведены или пропущены, знает база (операция с id v5(правило, дата)). Не больше MAX_PAYMENT_CANDIDATES
 * (остаются самые свежие). Порядок: по дате, потом по id правила.
 */
export function paymentCandidates(rules: readonly RuleLite[], today: IsoDate): PaymentCandidate[] {
  if (!isScheduleDate(today)) return [];
  const from = shiftIso(today, -PAYMENT_LOOKBACK_DAYS);
  const out: PaymentCandidate[] = [];
  for (const rule of rules) {
    for (const date of occurrencesBetween(rule, from, today)) out.push({ ruleId: rule.id.toLowerCase(), date, note: rule.note, overdue: date < today });
  }
  out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  return out.length > MAX_PAYMENT_CANDIDATES ? out.slice(out.length - MAX_PAYMENT_CANDIDATES) : out;
}

export const paymentRef = (ruleId: string, date: IsoDate): string => `${ruleId.toLowerCase()}:${date}`;
export const DAILY_REF = 'day';

export type DebtDueKind = 'today' | 'tomorrow' | 'overdue';

/** Срок долга относительно «сегодня»: сегодня, завтра, просрочен (до 30 суток) или null — напоминать рано/поздно. */
export function debtDueKind(dueOn: unknown, today: IsoDate): DebtDueKind | null {
  if (!isScheduleDate(dueOn) || !isScheduleDate(today)) return null;
  const diff = daysFromTo(today, dueOn);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 0 && diff >= -DEBT_OVERDUE_DAYS) return 'overdue';
  return null;
}

/**
 * Остаток долга — как domain/debts.ts: исходная сумма минус платежи. Платёж — живая операция этого долга того вида, что
 * «возврат» для направления (мне должны → доход, я должен → расход) в кошельке ТОЙ ЖЕ валюты, что долг. Остальные
 * (другая валюта, неизвестный кошелёк, выдача долга, перевод) в остаток не входят. Не меньше 0. Считает точно (BigInt).
 */
export function debtRemainingMinor(debt: DebtLite, txs: readonly DebtTxLite[], currencyByWallet: ReadonlyMap<string, string>): bigint {
  if (!Number.isSafeInteger(debt.principalMinor) || debt.principalMinor <= 0) return 0n;
  const payKind = debt.direction === 'lent' ? 'income' : 'expense';
  let paid = 0n;
  for (const t of txs) {
    if (t.debtId !== debt.id || t.kind !== payKind) continue;
    if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) continue;
    if (currencyByWallet.get(t.walletId) !== debt.currency) continue;
    paid += BigInt(t.amountMinor);
  }
  const left = BigInt(debt.principalMinor) - paid;
  return left > 0n ? left : 0n;
}

/** Адрес push принимаем только от известных push-сервисов (иначе чужой адрес в базе превратил бы функцию в «отправителя» запросов). */
const PUSH_HOST_SUFFIXES: readonly string[] = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];
const PUSH_HOSTS: readonly string[] = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com'];

export function isAllowedPushEndpoint(endpoint: unknown, extraHosts: readonly string[] = []): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s)) || extraHosts.includes(host);
}

/**
 * Оставляет только те подписки, чей адрес принадлежит их человеку. Один адрес push — одно устройство — один человек за раз; схема
 * же допускает одинаковый адрес у двух людей (выход без отзыва подписки, потом вход другого человека на том же телефоне).
 * Хозяин адреса — тот, у кого среди ДЕЙСТВУЮЩИХ подписок с этим адресом самое позднее last_seen_at. Равное время, непонятное время
 * или отсутствие самой строки среди действующих (её только что отозвали) — не доказано, значит не шлём: лучше пропустить
 * напоминание, чем показать его на чужом экране. Отозванные строки других людей хозяина не определяют (отозвано = человек
 * сам снял устройство). Подписка без соседей по адресу остаётся всегда.
 */
export function ownedSubscriptions(subs: readonly PushSub[], claims: readonly EndpointClaim[]): PushSub[] {
  const byEndpoint = new Map<string, EndpointClaim[]>();
  for (const c of claims) {
    const list = byEndpoint.get(c.endpoint);
    if (list) list.push(c);
    else byEndpoint.set(c.endpoint, [c]);
  }
  return subs.filter((s) => {
    const rows = byEndpoint.get(s.endpoint) ?? [];
    const mine = rows.find((c) => c.id === s.id);
    if (mine === undefined) return false;
    const others = rows.filter((c) => c !== mine);
    if (others.length === 0) return true;
    const t = Date.parse(mine.lastSeenAt);
    return others.every((o) => t > Date.parse(o.lastSeenAt)); // NaN в любой части даёт false
  });
}

// ---- текст сообщения ----

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Знаки так, как их видит человек (эмодзи с модификаторами и флаги не рвутся). */
function graphemes(s: string): string[] {
  if (typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Укорачивает текст до самого длинного начала, для которого fits(начало + «…») верно; рвёт только по границе знака
 * (не посреди эмодзи, не посреди символа UTF-8). Влезает целиком — возвращает как есть. Совсем не влезает — ''.
 */
export function truncateToFit(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text;
  let out = '';
  for (const g of graphemes(text)) {
    if (!fits(`${out}${g}…`)) break;
    out += g;
  }
  out = out.trimEnd();
  return fits(`${out}…`) ? `${out}…` : '';
}

/** Название для уведомления: без управляющих знаков и переносов, не длиннее NAME_MAX_CHARS знаков; пусто → fallback. */
export function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim() : '';
  if (s === '') return fallback;
  const g = graphemes(s);
  return g.length <= NAME_MAX_CHARS ? s : `${g.slice(0, NAME_MAX_CHARS).join('').trimEnd()}…`;
}

const namesText = (names: readonly string[]): string => {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return names.length > NAMES_SHOWN ? `${shown} и ещё ${names.length - NAMES_SHOWN}` : shown;
};

export interface ReminderItems {
  payments: ReadonlyArray<{ note: string; overdue: boolean }>;
  debts: ReadonlyArray<{ counterparty: string }>;
  daily: boolean;
}

/** Сообщение режется до PUSH_PAYLOAD_MAX_BYTES (размер всего JSON в байтах UTF-8) и BODY_MAX_CHARS знаков, по границе знака. */
export function fitPayload(p: PushPayload, maxBytes: number = PUSH_PAYLOAD_MAX_BYTES): PushPayload {
  const fits = (body: string): boolean => body.length <= BODY_MAX_CHARS && utf8Bytes(JSON.stringify({ ...p, body })) <= maxBytes;
  return { ...p, body: truncateToFit(p.body, fits) };
}

/**
 * Одно сообщение на пользователя за запуск. Только числа и общие слова; showDetails добавляет названия (заметка платежа или
 * «Платёж», имя должника). Суммы не пишутся никогда. Нечего сообщать → null.
 * url: только платежи → /recurring, только долги → /debts, иначе /.
 */
export function buildPayload(items: ReminderItems, showDetails: boolean): PushPayload | null {
  const pay = items.payments;
  const debts = items.debts;
  if (pay.length === 0 && debts.length === 0 && !items.daily) return null;
  const parts: string[] = [];
  if (pay.length > 0) {
    const late = pay.filter((p) => p.overdue).length;
    const now = pay.length - late;
    const word = (n: number): string => pluralRu(n, 'платёж', 'платежа', 'платежей');
    let s = now === 0 ? `Просрочено: ${late} ${word(late)}` : late === 0 ? `Сегодня ${now} ${word(now)}` : `Сегодня ${now} ${word(now)}, просрочено ${late}`;
    if (showDetails) s += ` (${namesText(pay.map((p) => cleanName(p.note, 'Платёж')))})`;
    parts.push(`${s}.`);
  }
  if (debts.length > 0) {
    let s = `Долги: срок подошёл у ${debts.length}`;
    if (showDetails) s += ` (${namesText(debts.map((d) => cleanName(d.counterparty, 'Долг')))})`;
    parts.push(`${s}.`);
  }
  if (items.daily) parts.push('Сегодня ещё нет записей. Внесите траты и доходы.');
  const onlyPay = pay.length > 0 && debts.length === 0 && !items.daily;
  const onlyDebts = debts.length > 0 && pay.length === 0 && !items.daily;
  const onlyDaily = items.daily && pay.length === 0 && debts.length === 0;
  return fitPayload({
    title: PUSH_TITLE,
    body: parts.join(' '),
    url: onlyPay ? '/recurring' : onlyDebts ? '/debts' : '/',
    tag: onlyPay ? 'finora-payments' : onlyDebts ? 'finora-debts' : onlyDaily ? 'finora-daily' : 'finora-reminder',
  });
}

/** Пробное сообщение для кнопки «Проверить уведомление». */
export const TEST_PAYLOAD: PushPayload = { title: PUSH_TITLE, body: 'Проверка связи: уведомления работают.', url: '/', tag: 'finora-test' };

// ====================== Доступ к данным и отправка: подменяемые зависимости ======================

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface SettingsPage {
  rows: ReminderSettingsRow[];
  /** Сколько строк не прошли проверку (мусор в базе). */
  rejected: number;
  /** user_id последней строки страницы (для следующей страницы); null — страница пуста. */
  lastUserId: string | null;
}

export interface ReminderStore {
  /** Страница настроек с enabled = true, по возрастанию user_id, после afterUserId. Пустая страница = конец. */
  listEnabledSettings(afterUserId: string | null): Promise<SettingsPage>;
  /** Действующие (revoked_at пусто) подписки ТОЛЬКО этого пользователя, не больше MAX_SUBSCRIPTIONS_PER_USER. */
  listSubscriptions(userId: string): Promise<PushSub[]>;
  /**
   * Действующие подписки ЛЮБЫХ людей с этими адресами push (только id, адрес и last_seen_at; ключей не читает). Единственное
   * место, где читаются чужие строки: нужно, чтобы не слать напоминания человека на устройство, которым уже пользуется другой.
   */
  listLiveEndpointClaims(endpoints: readonly string[]): Promise<EndpointClaim[]>;
  /** Живые не архивные правила с auto_post = 0, начавшиеся не позже today. Все страницы. */
  listRules(userId: string, today: IsoDate): Promise<RuleLite[]>;
  /** Какие из id есть среди операций пользователя (живые и удалённые). */
  existingTransactionIds(userId: string, ids: readonly string[]): Promise<Set<string>>;
  /** Живые не архивные не закрытые долги со сроком в [dueFrom, dueTo]. */
  listDebts(userId: string, dueFrom: IsoDate, dueTo: IsoDate): Promise<DebtLite[]>;
  /** Живые операции этих долгов (все страницы). */
  listDebtTransactions(userId: string, debtIds: readonly string[]): Promise<DebtTxLite[]>;
  /** Валюты кошельков (в том числе архивных и удалённых). */
  walletCurrencies(userId: string, walletIds: readonly string[]): Promise<Map<string, string>>;
  /** Есть ли живая операция с датой `date`. */
  hasLiveTransactionOn(userId: string, date: IsoDate): Promise<boolean>;
  /** insert … ignore duplicates: возвращает ТОЛЬКО новые записи (их раньше сегодня не отправляли). */
  insertLog(userId: string, sentOn: IsoDate, entries: readonly LogEntry[]): Promise<LogEntry[]>;
  deleteLog(userId: string, sentOn: IsoDate, entries: readonly LogEntry[]): Promise<void>;
  revokeSubscription(id: string, at: string): Promise<void>;
  /** Чистка журнала: записи с sent_on раньше beforeDate. */
  pruneLog(beforeDate: IsoDate): Promise<void>;
}

export interface SendResult {
  /** ok — принято; dead — 404/410, подписки больше нет; failed — прочая ошибка. */
  outcome: 'ok' | 'dead' | 'failed';
  /** HTTP-код ответа push-сервиса, если он был (для счётчиков). */
  status?: number;
  /** Отправка не уложилась в SEND_TIMEOUT_MS (ставит сама функция, не отправитель). */
  timedOut?: boolean;
}
export type Sender = (sub: PushSub, body: string, opts: { ttl: number }) => Promise<SendResult>;

/** Зависимости handler; в бою все берутся из окружения Deno, в тестах подставляются. */
export interface HandlerDeps {
  env?: (name: string) => string | undefined;
  now?: () => Date;
  /** Часы в миллисекундах для срока выполнения запуска (по умолчанию Date.now). */
  clockMs?: () => number;
  fetchImpl?: FetchFn;
  store?: ReminderStore;
  send?: Sender;
  /** Токен пользователя → id пользователя; null — токен недействителен; ошибка — сервер авторизации недоступен. */
  verifyJwt?: (jwt: string) => Promise<string | null>;
}

const UPSTREAM_TIMEOUT_MS = 10_000;

export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbError';
  }
}

async function timedFetch(fetchImpl: FetchFn, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- разбор строк PostgREST (имена колонок — как в supabase/schema.sql) ----

export function parseSettingsRow(row: unknown): ReminderSettingsRow | null {
  if (!isRec(row)) return null;
  const { user_id: userId, hour_local: hour, timezone } = row;
  if (typeof userId !== 'string' || !isUuid(userId)) return null;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (typeof timezone !== 'string') return null;
  return {
    userId: userId.toLowerCase(),
    hourLocal: hour,
    timezone,
    remindPayments: row.remind_payments === true,
    remindDebts: row.remind_debts === true,
    remindDaily: row.remind_daily === true,
    showDetails: row.show_details === true,
  };
}

export function parseRuleRow(row: unknown): RuleLite | null {
  if (!isRec(row) || typeof row.id !== 'string' || !isUuid(row.id)) return null;
  const { frequency, interval_n: intervalN, start_on: startOn, end_on: endOn, note } = row;
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') return null;
  if (typeof intervalN !== 'number' || typeof startOn !== 'string') return null;
  if (endOn !== null && typeof endOn !== 'string') return null;
  return { id: row.id.toLowerCase(), note: typeof note === 'string' ? note : '', frequency, intervalN, startOn, endOn };
}

export function parseDebtRow(row: unknown): DebtLite | null {
  if (!isRec(row) || typeof row.id !== 'string' || !isUuid(row.id)) return null;
  const { direction, counterparty, principal_minor: principal, currency, due_on: dueOn } = row;
  if (direction !== 'lent' && direction !== 'borrowed') return null;
  if (typeof principal !== 'number' || typeof currency !== 'string' || typeof dueOn !== 'string') return null;
  return { id: row.id.toLowerCase(), direction, counterparty: typeof counterparty === 'string' ? counterparty : '', principalMinor: principal, currency, dueOn };
}

export function parseDebtTxRow(row: unknown): DebtTxLite | null {
  if (!isRec(row) || typeof row.debt_id !== 'string' || typeof row.wallet_id !== 'string') return null;
  if (typeof row.kind !== 'string' || typeof row.amount_minor !== 'number') return null;
  return { debtId: row.debt_id.toLowerCase(), kind: row.kind, walletId: row.wallet_id.toLowerCase(), amountMinor: row.amount_minor };
}

export function parseSubscriptionRow(row: unknown): PushSub | null {
  if (!isRec(row) || typeof row.id !== 'string' || !isUuid(row.id)) return null;
  const { endpoint, p256dh, auth_secret: authSecret } = row;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof authSecret !== 'string') return null;
  return { id: row.id.toLowerCase(), endpoint, p256dh, authSecret };
}

/**
 * Строка выборки «кто ещё записан на этот адрес». Строка без понятного времени всё равно считается: хозяина по ней не доказать,
 * значит ownedSubscriptions никому не отдаст адрес (безопаснее пропустить, чем показать чужое). Не строка/без id — пропуск.
 */
export function parseClaimRow(row: unknown, endpoint: string): EndpointClaim | null {
  if (!isRec(row) || typeof row.id !== 'string' || !isUuid(row.id)) return null;
  return { id: row.id.toLowerCase(), endpoint, lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : '' };
}

// ---- хранилище поверх PostgREST (REST API Supabase) ----

const PAGE_SIZE = 1000; // предел строк на запрос у PostgREST по умолчанию; больше он молча не отдаст
const MAX_PAGES = 200;
const IN_CHUNK = 100; // id в одном запросе: адрес не должен выходить за пределы
const WRITE_CHUNK = 200;

const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const SAFE_REF = /^[A-Za-z0-9:._-]{1,200}$/;

export function createPostgrestStore(opts: { base: string; key: string; fetchImpl?: FetchFn }): ReminderStore {
  const base = opts.base.replace(/\/+$/, '');
  const fetchImpl: FetchFn = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const baseHeaders: Record<string, string> = { apikey: opts.key, accept: 'application/json' };
  // Ключ в старом виде (JWT) идёт и в Authorization; новый формат (sb_secret_…) — только в apikey.
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(opts.key)) baseHeaders.authorization = `Bearer ${opts.key}`;

  /** Один запрос. Текст ошибки сервера НЕ берём (в нём бывают значения строк): только статус и пятизнаковый код. */
  async function call(method: string, table: string, query: ReadonlyArray<readonly [string, string]>, extra?: { body?: unknown; prefer?: string }): Promise<unknown> {
    const qs = query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const headers: Record<string, string> = { ...baseHeaders };
    if (extra?.body !== undefined) headers['content-type'] = 'application/json';
    if (extra?.prefer) headers.prefer = extra.prefer;
    let res: Response;
    try {
      res = await timedFetch(fetchImpl, `${base}/rest/v1/${table}${qs ? `?${qs}` : ''}`, {
        method,
        headers,
        body: extra?.body === undefined ? undefined : JSON.stringify(extra.body),
      });
    } catch (e) {
      throw new DbError(`${table}: ${(e as { name?: string })?.name === 'AbortError' ? 'нет ответа за 10 с' : 'нет связи с базой'}`);
    }
    if (!res.ok) {
      let code = '';
      try {
        const c = (await res.json()) as { code?: unknown };
        if (typeof c.code === 'string' && /^[A-Z0-9]{5,8}$/.test(c.code)) code = ` ${c.code}`;
      } catch {
        /* тела нет — только статус */
      }
      throw new DbError(`${table}: HTTP ${res.status}${code}`);
    }
    if (res.status === 204 || (method !== 'GET' && !(extra?.prefer ?? '').includes('return=representation'))) return null;
    try {
      return await res.json();
    } catch {
      throw new DbError(`${table}: ответ не JSON`);
    }
  }

  /** Все строки выборки порциями по PAGE_SIZE: «после последнего ключа», пока страница не опустеет (устойчиво к чужому max-rows). */
  async function allRows(table: string, query: Array<[string, string]>, keyCol: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q: Array<[string, string]> = [...query, ['order', `${keyCol}.asc`], ['limit', String(PAGE_SIZE)]];
      if (after !== null) q.push([keyCol, `gt.${after}`]);
      const rows = await call('GET', table, q);
      if (!Array.isArray(rows) || rows.length === 0) return out;
      const last: unknown = rows[rows.length - 1];
      const key = isRec(last) ? last[keyCol] : undefined;
      if (typeof key !== 'string') throw new DbError(`${table}: в ответе нет колонки ${keyCol}`);
      for (const r of rows) if (isRec(r)) out.push(r);
      after = key;
    }
    throw new DbError(`${table}: слишком много строк`);
  }

  const uuids = (list: readonly string[]): string[] => [...new Set(list.map((s) => s.toLowerCase()).filter((s) => isUuid(s)))];

  return {
    async listEnabledSettings(afterUserId) {
      const q: Array<[string, string]> = [
        ['select', 'user_id,hour_local,timezone,remind_payments,remind_debts,remind_daily,show_details'],
        ['enabled', 'eq.true'],
        ['order', 'user_id.asc'],
        ['limit', String(PAGE_SIZE)],
      ];
      if (afterUserId !== null) q.push(['user_id', `gt.${afterUserId}`]);
      const raw = await call('GET', 'reminder_settings', q);
      const list = Array.isArray(raw) ? raw : [];
      const rows: ReminderSettingsRow[] = [];
      for (const r of list) {
        const p = parseSettingsRow(r);
        if (p) rows.push(p);
      }
      const last: unknown = list[list.length - 1];
      const lastId = isRec(last) && typeof last.user_id === 'string' ? last.user_id.toLowerCase() : null;
      if (list.length > 0 && lastId === null) throw new DbError('reminder_settings: в ответе нет user_id');
      return { rows, rejected: list.length - rows.length, lastUserId: lastId };
    },

    async listSubscriptions(userId) {
      const raw = await call('GET', 'push_subscriptions', [
        ['select', 'id,endpoint,p256dh,auth_secret'],
        ['user_id', `eq.${userId}`],
        ['revoked_at', 'is.null'],
        ['order', 'last_seen_at.desc,id.asc'],
        ['limit', String(MAX_SUBSCRIPTIONS_PER_USER)],
      ]);
      const out: PushSub[] = [];
      for (const r of Array.isArray(raw) ? raw : []) {
        const p = parseSubscriptionRow(r);
        if (p) out.push(p);
      }
      return out;
    },

    async listLiveEndpointClaims(endpoints) {
      const out: EndpointClaim[] = [];
      // По одному запросу на адрес: значение идёт после «eq.» как есть (без разбора запятых и скобок), поэтому подставить в фильтр
      // ничего лишнего нельзя; длинных адресов в одном запросе нет. Первая ошибка выбрасывается: хозяина не знаем — не шлём.
      for (const endpoint of new Set(endpoints)) {
        const raw = await call('GET', 'push_subscriptions', [
          ['select', 'id,last_seen_at'],
          ['endpoint', `eq.${endpoint}`],
          ['revoked_at', 'is.null'],
          ['order', 'last_seen_at.desc,id.asc'],
          ['limit', String(MAX_CLAIMS_PER_ENDPOINT)],
        ]);
        for (const r of Array.isArray(raw) ? raw : []) {
          const p = parseClaimRow(r, endpoint);
          if (p) out.push(p);
        }
      }
      return out;
    },

    async listRules(userId, today) {
      const rows = await allRows(
        'recurring_rules',
        [
          ['select', 'id,note,frequency,interval_n,start_on,end_on'],
          ['user_id', `eq.${userId}`],
          ['deleted_at', 'is.null'],
          ['archived_at', 'is.null'],
          ['auto_post', 'eq.0'],
          ['start_on', `lte.${today}`],
        ],
        'id',
      );
      const out: RuleLite[] = [];
      for (const r of rows) {
        const p = parseRuleRow(r);
        if (p) out.push(p);
      }
      return out;
    },

    async existingTransactionIds(userId, ids) {
      const found = new Set<string>();
      for (const part of chunks(uuids(ids), IN_CHUNK)) {
        const raw = await call('GET', 'transactions', [
          ['select', 'id'],
          ['user_id', `eq.${userId}`],
          ['id', `in.(${part.join(',')})`],
          ['limit', String(part.length)],
        ]);
        for (const r of Array.isArray(raw) ? raw : []) if (isRec(r) && typeof r.id === 'string') found.add(r.id.toLowerCase());
      }
      return found;
    },

    async listDebts(userId, dueFrom, dueTo) {
      const rows = await allRows(
        'debts',
        [
          ['select', 'id,direction,counterparty,principal_minor,currency,due_on'],
          ['user_id', `eq.${userId}`],
          ['deleted_at', 'is.null'],
          ['archived_at', 'is.null'],
          ['closed_at', 'is.null'],
          ['due_on', `gte.${dueFrom}`],
          ['due_on', `lte.${dueTo}`],
        ],
        'id',
      );
      const out: DebtLite[] = [];
      for (const r of rows) {
        const p = parseDebtRow(r);
        if (p) out.push(p);
      }
      return out.slice(0, MAX_DEBTS_PER_USER);
    },

    async listDebtTransactions(userId, debtIds) {
      const out: DebtTxLite[] = [];
      for (const part of chunks(uuids(debtIds), 50)) {
        const rows = await allRows(
          'transactions',
          [
            ['select', 'id,debt_id,kind,wallet_id,amount_minor'],
            ['user_id', `eq.${userId}`],
            ['deleted_at', 'is.null'],
            ['debt_id', `in.(${part.join(',')})`],
          ],
          'id',
        );
        for (const r of rows) {
          const p = parseDebtTxRow(r);
          if (p) out.push(p);
        }
      }
      return out;
    },

    async walletCurrencies(userId, walletIds) {
      const out = new Map<string, string>();
      for (const part of chunks(uuids(walletIds), IN_CHUNK)) {
        const raw = await call('GET', 'wallets', [
          ['select', 'id,currency'],
          ['user_id', `eq.${userId}`],
          ['id', `in.(${part.join(',')})`],
          ['limit', String(part.length)],
        ]);
        for (const r of Array.isArray(raw) ? raw : []) if (isRec(r) && typeof r.id === 'string' && typeof r.currency === 'string') out.set(r.id.toLowerCase(), r.currency);
      }
      return out;
    },

    async hasLiveTransactionOn(userId, date) {
      const raw = await call('GET', 'transactions', [
        ['select', 'id'],
        ['user_id', `eq.${userId}`],
        ['deleted_at', 'is.null'],
        ['occurred_on', `eq.${date}`],
        ['limit', '1'],
      ]);
      return Array.isArray(raw) && raw.length > 0;
    },

    async insertLog(userId, sentOn, entries) {
      const fresh: LogEntry[] = [];
      for (const part of chunks(entries, WRITE_CHUNK)) {
        const rows = part.map((e) => ({ user_id: userId, kind: e.kind, ref: e.ref, sent_on: sentOn }));
        const raw = await call('POST', 'push_log', [['on_conflict', 'user_id,kind,ref,sent_on'], ['select', 'kind,ref']], {
          body: rows,
          prefer: 'resolution=ignore-duplicates,return=representation',
        });
        for (const r of Array.isArray(raw) ? raw : []) {
          if (isRec(r) && (r.kind === 'payment' || r.kind === 'debt' || r.kind === 'daily') && typeof r.ref === 'string') fresh.push({ kind: r.kind, ref: r.ref });
        }
      }
      return fresh;
    },

    async deleteLog(userId, sentOn, entries) {
      for (const kind of ['payment', 'debt', 'daily'] as const) {
        const refs = entries.filter((e) => e.kind === kind).map((e) => e.ref);
        if (refs.some((r) => !SAFE_REF.test(r))) throw new DbError('push_log: недопустимый ref');
        for (const part of chunks(refs, IN_CHUNK)) {
          await call('DELETE', 'push_log', [
            ['user_id', `eq.${userId}`],
            ['sent_on', `eq.${sentOn}`],
            ['kind', `eq.${kind}`],
            ['ref', `in.(${part.join(',')})`],
          ], { prefer: 'return=minimal' });
        }
      }
    },

    async revokeSubscription(id, at) {
      await call('PATCH', 'push_subscriptions', [['id', `eq.${id}`], ['revoked_at', 'is.null']], { body: { revoked_at: at }, prefer: 'return=minimal' });
    },

    async pruneLog(beforeDate) {
      await call('DELETE', 'push_log', [['sent_on', `lt.${beforeDate}`]], { prefer: 'return=minimal' });
    },
  };
}

/** Проверка токена пользователя на сервере авторизации (то же, что делает supabase.auth.getUser(jwt)). */
export function createJwtVerifier(opts: { base: string; key: string; fetchImpl?: FetchFn }): (jwt: string) => Promise<string | null> {
  const base = opts.base.replace(/\/+$/, '');
  const fetchImpl: FetchFn = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return async (jwt) => {
    const res = await timedFetch(fetchImpl, `${base}/auth/v1/user`, { headers: { apikey: opts.key, authorization: `Bearer ${jwt}`, accept: 'application/json' } });
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return null; // токен недействителен или просрочен
    if (!res.ok) throw new Error(`auth HTTP ${res.status}`); // сервер авторизации недоступен: это не «токен плохой»
    let user: unknown;
    try {
      user = await res.json();
    } catch {
      return null;
    }
    const id = isRec(user) ? user.id : undefined;
    return typeof id === 'string' && isUuid(id) ? id.toLowerCase() : null;
  };
}

/** Исход ошибки отправки. Ошибка web-push содержит адрес подписки, поэтому берём из неё ТОЛЬКО числовой код ответа. */
export function classifyPushError(e: unknown): SendResult {
  const code = isRec(e) ? e.statusCode : undefined;
  const status = typeof code === 'number' && Number.isInteger(code) ? code : undefined;
  return { outcome: status === 404 || status === 410 ? 'dead' : 'failed', status };
}

/** Нужная нам часть пакета web-push. */
export interface WebPushLike {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: string; timeout: number },
  ): Promise<unknown>;
}

/** Отправка через web-push (npm:web-push@3.6.7). Пакет подгружается при первой отправке: тестам в Node Deno не нужен. */
export function createWebPushSender(
  vapid: { subject: string; publicKey: string; privateKey: string },
  load: () => Promise<WebPushLike> = async () => {
    // @ts-ignore: адрес вида npm: понимает только Deno
    const mod = await import('npm:web-push@3.6.7');
    return (mod.default ?? mod) as WebPushLike;
  },
): Sender {
  let ready: Promise<WebPushLike> | null = null;
  const lib = (): Promise<WebPushLike> => {
    ready ??= load().then((wp) => {
      wp.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      return wp;
    });
    return ready;
  };
  return async (sub, body, opts) => {
    let wp: WebPushLike;
    try {
      wp = await lib();
    } catch {
      ready = null; // не загрузился или ключи не приняты: в следующий раз попробуем заново
      console.error('send-reminders: не удалось подготовить отправку (пакет web-push или ключи VAPID)');
      return { outcome: 'failed' };
    }
    try {
      await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authSecret } }, body, {
        TTL: opts.ttl,
        urgency: 'normal',
        timeout: UPSTREAM_TIMEOUT_MS,
      });
      return { outcome: 'ok' };
    } catch (e) {
      return classifyPushError(e);
    }
  };
}

// ====================== Сценарий: напоминания пользователям ======================

export interface Counters {
  users: number;
  inWindow: number;
  notified: number;
  sent: number;
  failed: number;
  revoked: number;
  skippedBadSettings: number;
  skippedBadTimezone: number;
  skippedOutsideWindow: number;
  skippedNoSubscriptions: number;
  skippedBadEndpoint: number;
  /** Подписки, пропущенные потому, что тот же адрес позже подтвердил другой человек (см. ownedSubscriptions). */
  skippedSharedEndpoint: number;
  skippedNothingToSend: number;
  skippedAlreadySent: number;
  skippedTimeBudget: number;
  errors: number;
  failedStatuses: Record<string, number>;
}

const newCounters = (): Counters => ({
  users: 0,
  inWindow: 0,
  notified: 0,
  sent: 0,
  failed: 0,
  revoked: 0,
  skippedBadSettings: 0,
  skippedBadTimezone: 0,
  skippedOutsideWindow: 0,
  skippedNoSubscriptions: 0,
  skippedBadEndpoint: 0,
  skippedSharedEndpoint: 0,
  skippedNothingToSend: 0,
  skippedAlreadySent: 0,
  skippedTimeBudget: 0,
  errors: 0,
  failedStatuses: {},
});

export interface RunCtx {
  store: ReminderStore;
  send: Sender;
  now: Date;
  extraHosts: readonly string[];
  /** Настоящие часы в миллисекундах (для срока выполнения; «сейчас» для расчётов — now). */
  clockMs: () => number;
}

interface Delivery {
  accepted: number;
  failed: number;
  dead: PushSub[];
  statuses: Record<string, number>;
}

/** Ждёт отправку не дольше SEND_TIMEOUT_MS: не дождались — сбой с пометкой timedOut (поздний ответ отправителя уже не важен). */
async function sendWithin(ctx: RunCtx, sub: PushSub, body: string): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<SendResult>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: 'failed', timedOut: true }), SEND_TIMEOUT_MS);
  });
  try {
    // исключение отправителя (и синхронное тоже) уходит в catch у вызывающего и становится обычным сбоем
    return await Promise.race([ctx.send(sub, body, { ttl: PUSH_TTL_SECONDS }), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function deliver(ctx: RunCtx, subs: readonly PushSub[], payload: PushPayload): Promise<Delivery> {
  const body = JSON.stringify(fitPayload(payload));
  const results = await Promise.all(
    subs.map(async (sub): Promise<SendResult> => {
      try {
        return await sendWithin(ctx, sub, body);
      } catch {
        return { outcome: 'failed' };
      }
    }),
  );
  const d: Delivery = { accepted: 0, failed: 0, dead: [], statuses: {} };
  results.forEach((r, i) => {
    if (r.outcome === 'ok') d.accepted++;
    else if (r.outcome === 'dead') d.dead.push(subs[i] as PushSub);
    else {
      d.failed++;
      const key = r.timedOut === true ? 'timeout' : r.status === undefined ? 'network' : String(r.status);
      d.statuses[key] = (d.statuses[key] ?? 0) + 1;
    }
  });
  return d;
}

/**
 * Подписки пользователя, годные к отправке: адрес от известного push-сервиса И устройство не перешло к другому человеку
 * (см. ownedSubscriptions). Не удалось выяснить хозяина (ошибка базы) — исключение: лучше пропустить, чем показать чужое.
 */
async function usableSubscriptions(ctx: RunCtx, userId: string): Promise<{ usable: PushSub[]; badEndpoints: number; sharedEndpoints: number }> {
  const all = await ctx.store.listSubscriptions(userId);
  const allowed = all.filter((s) => isAllowedPushEndpoint(s.endpoint, ctx.extraHosts));
  const usable = allowed.length === 0 ? [] : ownedSubscriptions(allowed, await ctx.store.listLiveEndpointClaims(allowed.map((s) => s.endpoint)));
  return { usable, badEndpoints: all.length - allowed.length, sharedEndpoints: allowed.length - usable.length };
}

async function revokeDead(ctx: RunCtx, dead: readonly PushSub[], c: Counters): Promise<void> {
  for (const sub of dead) {
    try {
      await ctx.store.revokeSubscription(sub.id, ctx.now.toISOString());
      c.revoked++;
    } catch {
      c.errors++;
    }
  }
}

function addStatuses(c: Counters, statuses: Record<string, number>): void {
  for (const [k, n] of Object.entries(statuses)) c.failedStatuses[k] = (c.failedStatuses[k] ?? 0) + n;
}

interface Found {
  payments: Array<{ ref: string; note: string; overdue: boolean }>;
  debts: Array<{ ref: string; counterparty: string }>;
  daily: boolean;
}

/** Что сегодня напомнить пользователю (до проверки по push_log). */
async function findDue(store: ReminderStore, s: ReminderSettingsRow, today: IsoDate): Promise<Found> {
  const found: Found = { payments: [], debts: [], daily: false };
  if (s.remindPayments) {
    const cands = paymentCandidates(await store.listRules(s.userId, today), today);
    if (cands.length > 0) {
      const ids = await Promise.all(cands.map((p) => uuidV5(p.ruleId, p.date)));
      const have = await store.existingTransactionIds(s.userId, ids);
      cands.forEach((p, i) => {
        if (!have.has(ids[i] as string)) found.payments.push({ ref: paymentRef(p.ruleId, p.date), note: p.note, overdue: p.overdue });
      });
    }
  }
  if (s.remindDebts) {
    const debts = (await store.listDebts(s.userId, shiftIso(today, -DEBT_OVERDUE_DAYS), shiftIso(today, 1))).filter((d) => debtDueKind(d.dueOn, today) !== null);
    if (debts.length > 0) {
      const txs = await store.listDebtTransactions(s.userId, debts.map((d) => d.id));
      const wallets = await store.walletCurrencies(s.userId, txs.map((t) => t.walletId));
      for (const d of debts) {
        if (debtRemainingMinor(d, txs, wallets) > 0n) found.debts.push({ ref: d.id, counterparty: d.counterparty });
      }
    }
  }
  if (s.remindDaily && !(await store.hasLiveTransactionOn(s.userId, today))) found.daily = true;
  return found;
}

async function remindUser(ctx: RunCtx, s: ReminderSettingsRow, c: Counters): Promise<void> {
  const local = localMoment(ctx.now, s.timezone);
  if (local === null) {
    c.skippedBadTimezone++;
    return;
  }
  if (!inSendWindow(s.hourLocal, local.hour)) {
    c.skippedOutsideWindow++;
    return;
  }
  c.inWindow++;
  if (!s.remindPayments && !s.remindDebts && !s.remindDaily) {
    c.skippedNothingToSend++;
    return;
  }
  const { usable, badEndpoints, sharedEndpoints } = await usableSubscriptions(ctx, s.userId);
  c.skippedBadEndpoint += badEndpoints;
  c.skippedSharedEndpoint += sharedEndpoints;
  if (usable.length === 0) {
    c.skippedNoSubscriptions++;
    return;
  }
  const found = await findDue(ctx.store, s, local.date);
  const entries: LogEntry[] = [
    ...found.payments.map((p): LogEntry => ({ kind: 'payment', ref: p.ref })),
    ...found.debts.map((d): LogEntry => ({ kind: 'debt', ref: d.ref })),
    ...(found.daily ? [{ kind: 'daily', ref: DAILY_REF } as LogEntry] : []),
  ];
  if (entries.length === 0) {
    c.skippedNothingToSend++;
    return;
  }
  // Сначала запись в журнал, потом отправка: в сообщение попадают только пункты, которых сегодня ещё не было.
  const fresh = await ctx.store.insertLog(s.userId, local.date, entries);
  const isNew = new Set(fresh.map((e) => `${e.kind}|${e.ref}`));
  const payload = buildPayload(
    {
      payments: found.payments.filter((p) => isNew.has(`payment|${p.ref}`)),
      debts: found.debts.filter((d) => isNew.has(`debt|${d.ref}`)),
      daily: found.daily && isNew.has(`daily|${DAILY_REF}`),
    },
    s.showDetails,
  );
  if (payload === null) {
    c.skippedAlreadySent++;
    return;
  }
  const d = await deliver(ctx, usable, payload);
  c.sent += d.accepted;
  c.failed += d.failed;
  addStatuses(c, d.statuses);
  await revokeDead(ctx, d.dead, c);
  if (d.accepted > 0) {
    c.notified++;
  } else if (d.failed > 0) {
    // Никто не принял, и причина не только «подписка мертва»: убираем записи этого запуска, следующий час попробует снова.
    try {
      await ctx.store.deleteLog(s.userId, local.date, fresh);
    } catch {
      c.errors++;
    }
  }
}

/** Плановый запуск: всем, у кого сейчас «их» час. Бросает только если не удалось прочитать настройки. */
export async function runScheduled(ctx: RunCtx): Promise<Counters> {
  const c = newCounters();
  const started = ctx.clockMs();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await ctx.store.listEnabledSettings(after);
    if (batch.lastUserId === null) break;
    if (after !== null && batch.lastUserId <= after) break; // страница не продвинулась: сервер игнорирует курсор, иначе одни и те же люди шли бы по кругу
    c.skippedBadSettings += batch.rejected;
    for (const s of batch.rows) {
      c.users++;
      if (ctx.clockMs() - started > RUN_BUDGET_MS) {
        c.skippedTimeBudget++; // не успеваем: этих людей догонит следующий час (окно отправки шире часа)
        continue;
      }
      try {
        await remindUser(ctx, s, c);
      } catch (e) {
        c.errors++;
        console.error('send-reminders: ошибка при обработке пользователя', e instanceof DbError ? e.message : (e as { name?: string } | null)?.name ?? 'Error');
      }
    }
    after = batch.lastUserId;
  }
  try {
    await ctx.store.pruneLog(shiftIso(ctx.now.toISOString().slice(0, 10), -LOG_KEEP_DAYS));
  } catch {
    c.errors++;
  }
  return c;
}

export interface TestResult {
  sent: number;
  failed: number;
  revoked: number;
  skippedBadEndpoint: number;
  skippedSharedEndpoint: number;
  failedStatuses: Record<string, number>;
}

/** «Проверить уведомление»: пробное сообщение на подписки ЭТОГО пользователя. В push_log не пишет, настройки не требует. */
export async function runTest(ctx: RunCtx, userId: string): Promise<TestResult> {
  const { usable, badEndpoints, sharedEndpoints } = await usableSubscriptions(ctx, userId);
  const c = newCounters();
  if (usable.length > 0) {
    const d = await deliver(ctx, usable, TEST_PAYLOAD);
    c.sent = d.accepted;
    c.failed = d.failed;
    addStatuses(c, d.statuses);
    await revokeDead(ctx, d.dead, c);
  }
  return { sent: c.sent, failed: c.failed, revoked: c.revoked, skippedBadEndpoint: badEndpoints, skippedSharedEndpoint: sharedEndpoints, failedStatuses: c.failedStatuses };
}

// ====================== HTTP-обработчик ======================

const CORS_HEADERS: Record<string, string> = {
  // Доступ по заголовку Authorization, а не по cookie: звёздочка безопасна.
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/** Сравнение без раннего выхода: время не зависит от того, сколько символов совпало. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export interface Config {
  cronSecret: string;
  base: string;
  serviceKey: string;
  vapid: { subject: string; publicKey: string; privateKey: string };
  extraHosts: string[];
}

/** Читает настройки окружения. Нехватка — список ИМЁН переменных (значения не показываются никогда). */
export function readConfig(env: (name: string) => string | undefined): { cfg: Config } | { problems: string[] } {
  const problems: string[] = [];
  const cronSecret = env('CRON_SECRET') ?? '';
  if (cronSecret.length < MIN_SECRET_LENGTH || /\s/.test(cronSecret)) problems.push(`CRON_SECRET (нужно не меньше ${MIN_SECRET_LENGTH} символов без пробелов)`);
  const base = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/.test(base)) problems.push('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey === '') problems.push('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = (env('VAPID_PUBLIC_KEY') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)) problems.push('VAPID_PUBLIC_KEY');
  const privateKey = (env('VAPID_PRIVATE_KEY') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(privateKey)) problems.push('VAPID_PRIVATE_KEY');
  const subject = (env('VAPID_SUBJECT') ?? '').trim();
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) problems.push('VAPID_SUBJECT (mailto:… или https://…)');
  if (problems.length > 0) return { problems };
  const extraHosts = (env('PUSH_EXTRA_HOSTS') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]+$/.test(h));
  return { cfg: { cronSecret, base, serviceKey, vapid: { subject, publicKey, privateKey }, extraHosts } };
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const MAX_TOKEN_LENGTH = 4096;
const MAX_BODY_BYTES = 4096;
const TEST_LIMIT_PER_MINUTE = 5;

/** Тело запроса: пусто или объект JSON. Иначе 'bad'. */
async function readJsonBody(req: Request): Promise<Record<string, unknown> | 'bad'> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) return 'bad';
  const text = (await req.text()).trim();
  if (text.length > MAX_BODY_BYTES) return 'bad';
  if (text === '') return {};
  try {
    const v: unknown = JSON.parse(text);
    return isRec(v) ? v : 'bad';
  } catch {
    return 'bad';
  }
}

/**
 * Обработчик запроса. Порядок: OPTIONS → метод POST (иначе 405) → окружение (иначе 500 «не настроено») → Authorization
 * (нет или чужой — 401) → секрет расписания: плановый запуск; токен пользователя: только {"action":"test"}.
 */
export function createHandler(deps: HandlerDeps = {}): (req: Request) => Promise<Response> {
  const env = deps.env ?? ((name: string) => Deno.env.get(name) as string | undefined);
  const testHits = new Map<string, number[]>();
  let cachedSender: { key: string; send: Sender } | null = null;
  /** Один отправитель на все запросы одного экземпляра функции: пакет web-push грузится один раз. */
  const productionSender = (vapid: Config['vapid']): Sender => {
    const key = `${vapid.subject}|${vapid.publicKey}|${vapid.privateKey}`;
    if (cachedSender === null || cachedSender.key !== key) cachedSender = { key, send: createWebPushSender(vapid) };
    return cachedSender.send;
  };

  const allowTest = (userId: string, nowMs: number): boolean => {
    const recent = (testHits.get(userId) ?? []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= TEST_LIMIT_PER_MINUTE) {
      testHits.set(userId, recent);
      return false;
    }
    recent.push(nowMs);
    testHits.set(userId, recent);
    if (testHits.size > 500) for (const k of testHits.keys()) if (k !== userId) testHits.delete(k);
    return true;
  };

  async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST, OPTIONS' });

    const conf = readConfig(env);
    if ('problems' in conf) {
      console.error(`send-reminders: не настроено: ${conf.problems.join(', ')}`);
      return jsonResponse(500, { ok: false, error: 'not_configured' });
    }
    const { cfg } = conf;

    const m = /^Bearer\s+(\S+)$/i.exec((req.headers.get('authorization') ?? '').trim());
    const token = m?.[1] ?? '';
    if (token === '' || token.length > MAX_TOKEN_LENGTH) return jsonResponse(401, { ok: false, error: 'unauthorized' });

    const fetchImpl: FetchFn = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    const now = deps.now?.() ?? new Date();
    const store = deps.store ?? createPostgrestStore({ base: cfg.base, key: cfg.serviceKey, fetchImpl });
    const send = deps.send ?? productionSender(cfg.vapid);
    const ctx: RunCtx = { store, send, now, extraHosts: cfg.extraHosts, clockMs: deps.clockMs ?? Date.now };
    const scrub = (s: string): string => [cfg.serviceKey, cfg.cronSecret, cfg.vapid.privateKey, cfg.vapid.publicKey].reduce((t, secret) => t.split(secret).join('***'), s);

    if (safeEqual(token, cfg.cronSecret)) {
      const body = await readJsonBody(req);
      if (body === 'bad' || Object.keys(body).length > 0) return jsonResponse(400, { ok: false, error: 'bad_request' });
      let counters: Counters;
      try {
        counters = await runScheduled(ctx);
      } catch (e) {
        console.error('send-reminders: не удалось прочитать настройки', scrub(e instanceof DbError ? e.message : 'ошибка'));
        return jsonResponse(502, { ok: false, error: 'db_read_failed' });
      }
      console.log(`send-reminders: пользователей ${counters.users}, в окне ${counters.inWindow}, отправлено ${counters.sent}, сбоев ${counters.failed}, отозвано ${counters.revoked}, общих адресов пропущено ${counters.skippedSharedEndpoint}, ошибок ${counters.errors}`);
      return jsonResponse(200, { ok: true, mode: 'cron', ...counters });
    }

    if (!JWT_SHAPE.test(token)) return jsonResponse(401, { ok: false, error: 'unauthorized' });
    const verify = deps.verifyJwt ?? createJwtVerifier({ base: cfg.base, key: cfg.serviceKey, fetchImpl });
    let userId: string | null;
    try {
      userId = await verify(token);
    } catch {
      console.error('send-reminders: сервер авторизации недоступен');
      return jsonResponse(503, { ok: false, error: 'auth_unavailable' });
    }
    if (userId === null) return jsonResponse(401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    if (body === 'bad' || body.action !== 'test') return jsonResponse(400, { ok: false, error: 'bad_request' });
    if (!allowTest(userId, now.getTime())) return jsonResponse(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' });
    try {
      const r = await runTest(ctx, userId);
      // Нет ни одной подписки — не ошибка сервера: ok и sent = 0 (приложение объяснит человеку, что делать).
      return jsonResponse(200, { ok: r.sent > 0 || r.failed === 0, mode: 'test', ...r });
    } catch (e) {
      console.error('send-reminders: пробное сообщение не отправлено', scrub(e instanceof DbError ? e.message : 'ошибка'));
      return jsonResponse(502, { ok: false, error: 'db_read_failed' });
    }
  }

  return async (req) => {
    try {
      return await handle(req);
    } catch (e) {
      console.error('send-reminders: непредвиденная ошибка', (e as { name?: string } | null)?.name ?? 'Error');
      return jsonResponse(500, { ok: false, error: 'internal' });
    }
  };
}

// В тестах (Node/Vitest) Deno нет — файл просто импортируется, сервер не стартует.
if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler());
}
