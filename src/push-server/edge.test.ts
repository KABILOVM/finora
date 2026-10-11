// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as edge from '../../supabase/functions/send-reminders/index';
import { uuidV5 as srcUuidV5 } from '../db/ids';
import { occurrencesBetween as srcOccurrences } from '../domain/schedule';
import { pluralRu as srcPlural } from '../lib/plural';
import { PUSH_PAYLOAD_MAX_BYTES as CONTRACT_MAX_BYTES, SEND_REMINDERS_FUNCTION } from '../push/contract';
import { isSafeAppPath } from '../push/navigate';

const EDGE_URL = new URL('../../supabase/functions/send-reminders/index.ts', import.meta.url);
const edgeSource = readFileSync(EDGE_URL, 'utf8');
const rel = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Верхние уровни файла: блоки, разделённые пустой строкой, за которой следует строка без отступа. */
const chunksOf = (text: string): string[] => text.split(/\n\n(?=\S)/).map((c) => c.replace(/\n+$/, ''));

function region(source: string, name: string): string {
  const start = source.indexOf(`// <<< SHARED:${name}\n`);
  const endMarker = `// SHARED:${name} >>>`;
  const end = source.indexOf(endMarker);
  expect(start, `маркер начала SHARED:${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `маркер конца SHARED:${name}`).toBeGreaterThan(start);
  return source.slice(start + `// <<< SHARED:${name}\n`.length, end);
}

/** Имя объявления блока (для сообщений об ошибке). */
const nameOf = (chunk: string): string => /(?:function|const|interface|type|class)\s+([A-Za-z0-9_]+)/.exec(chunk)?.[1] ?? chunk.slice(0, 40);

const SHARED: Array<{ name: string; file: string; mustHave: string[]; skipped: string[] }> = [
  {
    name: 'schedule',
    file: '../domain/schedule.ts',
    mustHave: ['occurrencesBetween', 'isValidSchedule', 'isScheduleDate', 'dateAt', 'startIndex', 'lastAllowed', 'parseYmd', 'daysInMonth', 'ScheduleRule'],
    // что в клиентском файле есть, а в серверный не нужно (всё остальное обязано быть в копии: иначе расписание разойдётся)
    skipped: ['shiftDay', 'nextOccurrence', 'isOccurrence', 'UpcomingStatus', 'statusOf', 'UpcomingEntry', 'UPCOMING_MAX_DAYS_AHEAD', 'clampDays', 'upcomingOccurrences'],
  },
  {
    name: 'ids',
    file: '../db/ids.ts',
    mustHave: ['uuidV5', 'sha1Fallback', 'sha1', 'formatUuid', 'parseUuid', 'isUuid', 'UUID_RE', 'rotl', 'hex'],
    skipped: ['FINORA_NAMESPACE', 'newId', 'defaultId'],
  },
  { name: 'plural', file: '../lib/plural.ts', mustHave: ['pluralRu'], skipped: [] },
];

describe('Edge-функция: файл самодостаточен и не расходится с приложением', () => {
  it.each(SHARED)('блок SHARED:$name состоит из дословных кусков $file и не теряет нужного', ({ name, file, mustHave, skipped }) => {
    const src = chunksOf(rel(file));
    const copy = chunksOf(region(edgeSource, name));
    for (const c of copy) expect(src, `в ${file} нет дословного куска ${nameOf(c)}`).toContain(c);
    expect(copy.length, 'копия не пуста').toBeGreaterThan(0);
    const copied = new Set(copy.map(nameOf));
    for (const n of mustHave) expect(copied, `в копии нет ${n}`).toContain(n);
    // всё, что из клиентского файла НЕ скопировано, должно быть в явном списке «не нужно»
    const left = src.filter((c) => !copy.includes(c)).map(nameOf);
    const allowed = new Set(skipped);
    const unexpected = left.filter((n) => !allowed.has(n) && !/^(import|\/\*\*)/.test(n));
    expect(unexpected, `в ${file} появилось то, чего нет в серверной копии: сверь и добавь в блок`).toEqual([]);
  });

  it('нет статических import и require: файл можно целиком вставить в редактор Edge Functions', () => {
    expect(edgeSource).not.toMatch(/^\s*import[\s{*]/m);
    expect(edgeSource).not.toMatch(/\brequire\(/);
    expect(edgeSource).not.toMatch(/\sfrom\s+['"]/);
  });

  it('web-push подгружается лениво и один раз: import("npm:web-push@3.6.7") внутри функции отправки', () => {
    const hits = edgeSource.match(/import\('npm:[^']+'\)/g) ?? [];
    expect(hits).toEqual(["import('npm:web-push@3.6.7')"]);
    const at = edgeSource.indexOf("import('npm:web-push@3.6.7')");
    const fnStart = edgeSource.lastIndexOf('export function createWebPushSender');
    expect(fnStart).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(fnStart);
    expect(edgeSource).toMatch(/\/\/ @ts-ignore[^\n]*\n\s*const mod = await import\('npm:web-push@3\.6\.7'\)/);
  });

  it('в коде нет секретов; ключи и секреты читаются только из окружения', () => {
    expect(edgeSource).not.toMatch(/eyJ[A-Za-z0-9_-]{15,}/);
    expect(edgeSource).not.toMatch(/sb_secret_[A-Za-z0-9]/);
    expect(edgeSource).not.toMatch(/(service_role|SERVICE_ROLE_KEY|CRON_SECRET|VAPID_PRIVATE_KEY)['"]?\s*[:=]\s*['"][^'"]+['"]/);
    for (const name of ['CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      expect(edgeSource, name).toContain(`env('${name}')`);
    }
    // ни одной длинной base64url-строки (похожей на ключ VAPID) в строковых литералах
    expect(edgeSource).not.toMatch(/['"`][A-Za-z0-9_-]{60,}['"`]/);
  });

  it('в журналы и ответы не попадают ключи, адреса подписок и сырые ошибки: console.* печатает только свои слова и коды', () => {
    const calls = edgeSource.split('\n').filter((l) => /console\.(log|error|warn|info)\(/.test(l));
    expect(calls.length).toBeGreaterThan(3);
    for (const l of calls) {
      expect(l, l.trim()).not.toMatch(/endpoint|p256dh|authSecret|auth_secret|serviceKey|privateKey|cronSecret/);
      if (/\.message/.test(l)) expect(l, l.trim()).toContain('instanceof DbError'); // текст ошибки берём только у своей DbError (статус и код)
      // ошибку целиком (с адресом подписки внутри) не печатаем: только имя класса или текст DbError
      expect(l, l.trim()).not.toMatch(/console\.\w+\([^)]*,\s*e\s*\)/);
    }
  });

  it('объявлен declare const Deno; сервер стартует только внутри if (typeof Deno !== "undefined")', () => {
    expect(edgeSource).toContain('declare const Deno: any;');
    expect(edgeSource).toMatch(/if \(typeof Deno !== 'undefined'\) \{\s*Deno\.serve\(createHandler\(\)\);/);
    expect(typeof (globalThis as { Deno?: unknown }).Deno).toBe('undefined');
  });

  it('шапка честно говорит «не запускалось» и описывает развёртывание по шагам', () => {
    const head = edgeSource.slice(0, 7000);
    for (const part of [
      'НА ЖИВОМ SUPABASE ЭТА ФУНКЦИЯ НЕ ЗАПУСКАЛАСЬ',
      'КАК РАЗВЕРНУТЬ',
      'Verify JWT',
      'CRON_SECRET',
      'НЕ КОРОЧЕ 32',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
      'npx web-push generate-vapid-keys',
      'pg_cron',
      'pg_net',
      'cron.schedule',
      'net.http_post',
      'UTC',
      'curl -i -X POST',
      '"action":"test"',
      'VITE_VAPID_PUBLIC_KEY',
    ]) {
      expect(head, part).toContain(part);
    }
  });

  it('имя папки функции совпадает с договором, а предел размера — с src/push/contract.ts', () => {
    expect(EDGE_URL.pathname.endsWith(`/supabase/functions/${SEND_REMINDERS_FUNCTION}/index.ts`)).toBe(true);
    expect(edge.PUSH_PAYLOAD_MAX_BYTES).toBe(CONTRACT_MAX_BYTES);
    expect(rel('../push/contract.ts')).toContain(`PUSH_PAYLOAD_MAX_BYTES = ${edge.PUSH_PAYLOAD_MAX_BYTES};`);
  });
});

describe('Edge-функция: общие куски работают так же, как в приложении', () => {
  const FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
  const STARTS = ['2026-01-29', '2026-01-30', '2026-01-31', '2024-02-29', '2025-03-31', '2026-10-10', '2027-12-31', '2000-01-01', '2099-12-31'];
  const WINDOWS: Array<[string, string]> = [
    ['2026-02-20', '2026-03-04'],
    ['2028-02-22', '2028-03-01'],
    ['2026-04-23', '2026-04-30'],
    ['2026-12-25', '2027-01-04'],
    ['2100-01-01', '2100-01-01'],
    ['2026-10-04', '2026-10-11'],
  ];

  it('occurrencesBetween: сетка правил × окон даёт то же, что клиентский код, и не вырождается в пустоту', () => {
    let nonEmpty = 0;
    for (const frequency of FREQS) {
      for (const intervalN of [1, 2, 3, 12, 1000]) {
        for (const startOn of STARTS) {
          for (const endOn of [null, '2026-03-15', '2028-02-29']) {
            const rule = { frequency, intervalN, startOn, endOn };
            for (const [from, to] of WINDOWS) {
              const a = edge.occurrencesBetween(rule, from, to);
              expect(a).toEqual(srcOccurrences(rule, from, to));
              if (a.length > 0) nonEmpty++;
            }
          }
        }
      }
    }
    expect(nonEmpty).toBeGreaterThan(100);
  });

  it('uuidV5: те же значения, что у приложения, и RFC-вектор', async () => {
    const ns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // пространство DNS из RFC 4122
    expect(await edge.uuidV5(ns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    for (const name of ['2026-10-10', '2028-02-29', 'ёж 😀', '']) {
      const rule = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      expect(await edge.uuidV5(rule, name)).toBe(await srcUuidV5(rule, name));
    }
    await expect(edge.uuidV5('не-uuid', 'x')).rejects.toThrow(TypeError);
  });

  it('pluralRu: те же слова для 0…300 и для странных чисел', () => {
    for (let n = 0; n <= 300; n++) expect(edge.pluralRu(n, 'платёж', 'платежа', 'платежей')).toBe(srcPlural(n, 'платёж', 'платежа', 'платежей'));
    for (const n of [-1, -11, 1.9, NaN, 1e9]) expect(edge.pluralRu(n, 'а', 'б', 'в')).toBe(srcPlural(n, 'а', 'б', 'в'));
  });
});

describe('Edge-функция: сообщение понимает настоящий service worker (public/push-handler.js)', () => {
  const SW = readFileSync(new URL('../../public/push-handler.js', import.meta.url), 'utf8');

  function show(json: string): Array<{ title: string; options: Record<string, unknown> }> {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
    const self = {
      addEventListener: (t: string, fn: (e: unknown) => void) => void (handlers[t] = fn),
      registration: { scope: 'https://finora.example/', showNotification: (title: string, options: Record<string, unknown>) => (shown.push({ title, options }), Promise.resolve()) },
      clients: { matchAll: async () => [], openWindow: async () => null },
      location: { href: 'https://finora.example/sw.js' },
    };
    vm.runInNewContext(SW, { self });
    handlers.push!({ data: { text: () => json }, waitUntil: () => undefined });
    return shown;
  }

  it('каждый вид сообщения доходит до уведомления без искажений и обрезки', () => {
    const cases = [
      edge.buildPayload({ payments: [{ note: 'Аренда', overdue: false }, { note: '', overdue: true }], debts: [{ counterparty: 'Рустам' }], daily: true }, true),
      edge.buildPayload({ payments: [{ note: 'Х', overdue: false }], debts: [], daily: false }, false),
      edge.buildPayload({ payments: [], debts: [{ counterparty: 'Д'.repeat(300) }], daily: false }, true),
      edge.buildPayload({ payments: [], debts: [], daily: true }, false),
      edge.TEST_PAYLOAD,
    ];
    for (const p of cases) {
      expect(p).not.toBeNull();
      const payload = p as edge.PushPayload;
      expect(isSafeAppPath(payload.url), payload.url).toBe(true);
      const shown = show(JSON.stringify(payload));
      expect(shown).toHaveLength(1);
      expect(shown[0]!.title).toBe(payload.title);
      expect(shown[0]!.options).toMatchObject({ body: payload.body, tag: payload.tag, data: { url: payload.url } });
    }
  });
});
