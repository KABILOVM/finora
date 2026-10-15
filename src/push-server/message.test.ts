// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_CHARS,
  NAME_MAX_CHARS,
  PUSH_PAYLOAD_MAX_BYTES,
  buildPayload,
  cleanName,
  fitPayload,
  isAllowedPushEndpoint,
  parseDebtRow,
  parseDebtTxRow,
  parseRuleRow,
  parseSettingsRow,
  parseSubscriptionRow,
  readConfig,
  safeEqual,
  truncateToFit,
  utf8Bytes,
} from '../../supabase/functions/send-reminders/index';

const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('текст сообщения', () => {
  const pay = (n: number, overdue = false, note = 'Аренда') => Array.from({ length: n }, () => ({ note, overdue }));

  it('платежи сегодня: склонение по числу', () => {
    const body = (n: number) => buildPayload({ payments: pay(n), debts: [], daily: false }, false)!.body;
    expect(body(1)).toBe('Сегодня 1 платёж.');
    expect(body(2)).toBe('Сегодня 2 платежа.');
    expect(body(4)).toBe('Сегодня 4 платежа.');
    expect(body(5)).toBe('Сегодня 5 платежей.');
    expect(body(11)).toBe('Сегодня 11 платежей.');
    expect(body(12)).toBe('Сегодня 12 платежей.');
    expect(body(21)).toBe('Сегодня 21 платёж.');
    expect(body(22)).toBe('Сегодня 22 платежа.');
    expect(body(100)).toBe('Сегодня 100 платежей.');
    expect(body(101)).toBe('Сегодня 101 платёж.');
  });

  it('просроченные и сегодняшние вместе', () => {
    expect(buildPayload({ payments: pay(3, true), debts: [], daily: false }, false)!.body).toBe('Просрочено: 3 платежа.');
    expect(buildPayload({ payments: [...pay(2), ...pay(1, true)], debts: [], daily: false }, false)!.body).toBe('Сегодня 2 платежа, просрочено 1.');
    expect(buildPayload({ payments: [...pay(1), ...pay(5, true)], debts: [], daily: false }, false)!.body).toBe('Сегодня 1 платёж, просрочено 5.');
  });

  it('пример из задания: платежи и долги одним сообщением', () => {
    const p = buildPayload({ payments: pay(2), debts: [{ counterparty: 'Рустам' }], daily: false }, false)!;
    expect(p).toEqual({ title: 'Sumoima', body: 'Сегодня 2 платежа. Долги: срок подошёл у 1.', url: '/', tag: 'finora-reminder' });
  });

  it('ссылка и метка по смыслу', () => {
    const only = (items: Parameters<typeof buildPayload>[0]) => {
      const p = buildPayload(items, false)!;
      return [p.url, p.tag];
    };
    expect(only({ payments: pay(1), debts: [], daily: false })).toEqual(['/recurring', 'finora-payments']);
    expect(only({ payments: [], debts: [{ counterparty: 'А' }], daily: false })).toEqual(['/debts', 'finora-debts']);
    expect(only({ payments: [], debts: [], daily: true })).toEqual(['/', 'finora-daily']);
    expect(only({ payments: pay(1), debts: [{ counterparty: 'А' }], daily: false })).toEqual(['/', 'finora-reminder']);
    expect(only({ payments: pay(1), debts: [], daily: true })).toEqual(['/', 'finora-reminder']);
  });

  it('нечего сообщать — null', () => {
    expect(buildPayload({ payments: [], debts: [], daily: false }, true)).toBeNull();
  });

  it('напоминание «внесите траты»', () => {
    expect(buildPayload({ payments: [], debts: [], daily: true }, false)!.body).toBe('Сегодня ещё нет записей. Внесите траты и доходы.');
  });

  it('без деталей: ни названий, ни имён — только числа и общие слова', () => {
    const p = buildPayload({ payments: [{ note: 'Кредит в Алиф-банке', overdue: false }], debts: [{ counterparty: 'Рустам Каримов' }], daily: false }, false)!;
    expect(p.body).not.toMatch(/Алиф|Рустам|Каримов|Кредит/);
    expect(p.body).toBe('Сегодня 1 платёж. Долги: срок подошёл у 1.');
  });

  it('с деталями: названия платежей и имена должников; пустое название — «Платёж»', () => {
    const p = buildPayload(
      { payments: [{ note: 'Аренда', overdue: false }, { note: '   ', overdue: false }, { note: 'Интернет', overdue: true }], debts: [{ counterparty: 'Рустам' }, { counterparty: '' }], daily: false },
      true,
    )!;
    expect(p.body).toBe('Сегодня 2 платежа, просрочено 1 (Аренда, Платёж, Интернет). Долги: срок подошёл у 2 (Рустам, Долг).');
  });

  it('больше трёх названий — «и ещё N»', () => {
    const items = ['А', 'Б', 'В', 'Г', 'Д'].map((note) => ({ note, overdue: false }));
    expect(buildPayload({ payments: items, debts: [], daily: false }, true)!.body).toBe('Сегодня 5 платежей (А, Б, В и ещё 2).');
  });

  it('кириллица, эмодзи, перенос строки и управляющие знаки в названиях', () => {
    expect(cleanName('Аренда 🏠\nквартиры\t(июнь)', 'Платёж')).toBe('Аренда 🏠 квартиры (июнь)');
    expect(cleanName('a\u0000b‮c‏d', 'Х')).toBe('a b c d');
    expect(cleanName(undefined, 'Платёж')).toBe('Платёж');
    expect(cleanName(42, 'Платёж')).toBe('Платёж');
    expect(cleanName('\n\t ', 'Платёж')).toBe('Платёж');
    expect(buildPayload({ payments: [{ note: 'Йога 🧘‍♀️', overdue: false }], debts: [], daily: false }, true)!.body).toBe('Сегодня 1 платёж (Йога 🧘‍♀️).');
  });

  it('длинное название режется по знакам: эмодзи и семейный эмодзи не разрываются', () => {
    const family = '👨‍👩‍👧‍👦'; // один знак из 7 кодовых точек
    const name = cleanName(family.repeat(NAME_MAX_CHARS + 10), 'x');
    expect(name.endsWith('…')).toBe(true);
    expect(name.slice(0, -1)).toBe(family.repeat(NAME_MAX_CHARS));
    expect(cleanName('я'.repeat(NAME_MAX_CHARS), 'x')).toBe('я'.repeat(NAME_MAX_CHARS));
    expect(cleanName('я'.repeat(NAME_MAX_CHARS + 1), 'x')).toBe(`${'я'.repeat(NAME_MAX_CHARS)}…`);
  });

  it('суммы в сообщение не попадают: даже если в названии записано число, оно остаётся названием, а полей суммы у сообщения нет', () => {
    const items: Parameters<typeof buildPayload>[0] = { payments: [{ note: 'Ипотека', overdue: false }], debts: [], daily: false };
    // тип пунктов не содержит суммы: добавить её нельзя (проверка компилятором), в тексте цифр кроме счётчика нет
    expect(buildPayload(items, true)!.body.replace(/\D/g, '')).toBe('1');
  });

  it('размер: любое сообщение укладывается в 2000 байт и в 300 знаков; режется по границе знака', () => {
    const emoji = '😀'.repeat(NAME_MAX_CHARS);
    const p = buildPayload({ payments: Array.from({ length: 20 }, () => ({ note: emoji, overdue: false })), debts: Array.from({ length: 20 }, () => ({ counterparty: emoji })), daily: true }, true)!;
    expect(utf8Bytes(JSON.stringify(p))).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    expect(p.body.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
    expect(p.body).toBe(p.body.normalize('NFC'));
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(p.body)).toBe(false); // нет «оборванных» половинок пары
  });
});

describe('обрезка по границе знака', () => {
  const lone = (s: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

  it('fitPayload: JSON не больше предела в байтах UTF-8 для кириллицы (2 байта) и эмодзи (4 байта)', () => {
    for (const unit of ['я', '😀', 'a', '👨‍👩‍👧‍👦', '🇹🇯']) {
      for (const max of [150, 199, 200, 201, 333, 2000]) {
        const base = { title: 'Sumoima', body: unit.repeat(900), url: '/', tag: 'finora-reminder' };
        const r = fitPayload(base, max);
        expect(utf8Bytes(JSON.stringify(r)), `${unit} / ${max}`).toBeLessThanOrEqual(max);
        expect(r.body.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
        expect(lone(r.body), `${unit} / ${max}: оборванная пара`).toBe(false);
        expect(r.body.endsWith('…')).toBe(true);
        expect({ ...r, body: '' }).toEqual({ ...base, body: '' });
        // обрезка ровно по целым знакам: перед многоточием только целые «unit»
        expect(r.body.slice(0, -1).split(unit).join('')).toBe('');
      }
    }
  });

  it('влезает целиком — не трогается; пусто остаётся пустым', () => {
    const p = { title: 'Sumoima', body: 'Привет', url: '/', tag: 't' };
    expect(fitPayload(p)).toEqual(p);
    expect(fitPayload({ ...p, body: '' }).body).toBe('');
  });

  it('предел в 300 знаков действует и когда байтов ещё много', () => {
    const r = fitPayload({ title: 'Sumoima', body: 'a'.repeat(1000), url: '/', tag: 't' });
    expect(r.body).toBe(`${'a'.repeat(BODY_MAX_CHARS - 1)}…`);
  });

  it('совсем нет места — пусто, без исключения', () => {
    expect(fitPayload({ title: 'Sumoima', body: 'текст', url: '/', tag: 't' }, 10).body).toBe('');
  });

  it('экранирование JSON учитывается: кавычки и переносы раздувают размер', () => {
    const r = fitPayload({ title: 'F', body: '"'.repeat(500), url: '/', tag: 't' }, 120);
    expect(utf8Bytes(JSON.stringify(r))).toBeLessThanOrEqual(120);
  });

  it('truncateToFit: произвольное условие, пробелы перед многоточием не остаются', () => {
    expect(truncateToFit('привет мир', (s) => s.length <= 8)).toBe('привет…');
    expect(truncateToFit('привет', (s) => s.length <= 8)).toBe('привет');
    expect(truncateToFit('привет', () => false)).toBe('');
  });
});

describe('адреса push-сервисов', () => {
  it('известные сервисы принимаются', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com/wp/xyz',
      'https://android.googleapis.com/gcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QPFo',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) {
      expect(isAllowedPushEndpoint(u), u).toBe(true);
    }
  });

  it('чужие хосты, http, учётные данные, порт, похожие имена и мусор — нет (иначе функция стала бы отправлять запросы куда угодно)', () => {
    for (const u of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example/push',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil-fcm.googleapis.com/x',
      'https://notify.windows.com.evil.example/x',
      'https://x.push.apple.com.evil.example/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://[::1]/x',
      'https://169.254.169.254/latest/meta-data',
      'ftp://fcm.googleapis.com/x',
      'fcm.googleapis.com',
      '',
      `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
    ]) {
      expect(isAllowedPushEndpoint(u), u.slice(0, 60)).toBe(false);
    }
    for (const bad of [null, undefined, 5, {}, ['https://fcm.googleapis.com/x']]) expect(isAllowedPushEndpoint(bad)).toBe(false);
  });

  it('дополнительные хосты из настроек — только точные совпадения', () => {
    expect(isAllowedPushEndpoint('https://push.example.org/x', ['push.example.org'])).toBe(true);
    expect(isAllowedPushEndpoint('https://sub.push.example.org/x', ['push.example.org'])).toBe(false);
    expect(isAllowedPushEndpoint('https://PUSH.EXAMPLE.ORG/x', ['push.example.org'])).toBe(true);
  });
});

describe('разбор строк базы (имена колонок — как в supabase/schema.sql)', () => {
  const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  it('настройки', () => {
    expect(parseSettingsRow({ user_id: U.toUpperCase(), hour_local: 9, timezone: 'Asia/Dushanbe', remind_payments: true, remind_debts: false, remind_daily: true, remind_budgets: true, show_details: false })).toEqual({
      userId: U,
      hourLocal: 9,
      timezone: 'Asia/Dushanbe',
      remindPayments: true,
      remindDebts: false,
      remindDaily: true,
      remindBudgets: true,
      showDetails: false,
    });
    // старая строка без колонки remind_budgets: лимиты выключены
    expect(parseSettingsRow({ user_id: U, hour_local: 9, timezone: 'UTC' })).toMatchObject({ remindBudgets: false });
    for (const bad of [null, 5, [], { user_id: 'не-uuid', hour_local: 9, timezone: 'UTC' }, { user_id: U, hour_local: 24, timezone: 'UTC' }, { user_id: U, hour_local: 9.5, timezone: 'UTC' }, { user_id: U, hour_local: '9', timezone: 'UTC' }, { user_id: U, hour_local: 9, timezone: null }]) {
      expect(parseSettingsRow(bad)).toBeNull();
    }
    // флаги: только настоящее true включает (null/«true» строкой — нет)
    expect(parseSettingsRow({ user_id: U, hour_local: 0, timezone: 'UTC', remind_payments: 'true', remind_budgets: 'true', show_details: 1 })).toMatchObject({ remindPayments: false, remindBudgets: false, showDetails: false });
  });

  it('правила, долги, операции долга, подписки', () => {
    expect(parseRuleRow({ id: RULE, note: 'N', frequency: 'weekly', interval_n: 2, start_on: '2026-01-01', end_on: null })).toEqual({ id: RULE, note: 'N', frequency: 'weekly', intervalN: 2, startOn: '2026-01-01', endOn: null });
    expect(parseRuleRow({ id: RULE, frequency: 'hourly', interval_n: 1, start_on: '2026-01-01', end_on: null })).toBeNull();
    expect(parseRuleRow({ id: RULE, frequency: 'daily', interval_n: '1', start_on: '2026-01-01', end_on: null })).toBeNull();
    expect(parseRuleRow({ id: 'x', frequency: 'daily', interval_n: 1, start_on: '2026-01-01', end_on: null })).toBeNull();
    expect(parseDebtRow({ id: RULE, direction: 'lent', counterparty: 'К', principal_minor: 5, currency: 'TJS', due_on: '2026-10-10' })).toMatchObject({ id: RULE, principalMinor: 5, dueOn: '2026-10-10' });
    expect(parseDebtRow({ id: RULE, direction: 'gift', counterparty: 'К', principal_minor: 5, currency: 'TJS', due_on: '2026-10-10' })).toBeNull();
    expect(parseDebtRow({ id: RULE, direction: 'lent', counterparty: 'К', principal_minor: '5', currency: 'TJS', due_on: '2026-10-10' })).toBeNull();
    expect(parseDebtTxRow({ debt_id: RULE.toUpperCase(), wallet_id: U, kind: 'income', amount_minor: 3 })).toEqual({ debtId: RULE, walletId: U, kind: 'income', amountMinor: 3 });
    expect(parseDebtTxRow({ debt_id: RULE, wallet_id: U, kind: 'income', amount_minor: '3' })).toBeNull();
    expect(parseSubscriptionRow({ id: RULE, endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth_secret: 's' })).toEqual({ id: RULE, endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', authSecret: 's' });
    expect(parseSubscriptionRow({ id: RULE, endpoint: 5, p256dh: 'k', auth_secret: 's' })).toBeNull();
  });
});

describe('настройки окружения и сравнение секретов', () => {
  const GOOD: Record<string, string> = {
    CRON_SECRET: 'c'.repeat(32),
    SUPABASE_URL: 'https://proj.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    VAPID_PUBLIC_KEY: 'B'.repeat(87),
    VAPID_PRIVATE_KEY: 'p'.repeat(43),
    VAPID_SUBJECT: 'mailto:owner@example.org',
  };
  const read = (patch: Record<string, string | undefined> = {}) => readConfig((n) => ({ ...GOOD, ...patch })[n]);

  it('всё на месте — настройки без лишнего слэша в адресе', () => {
    const r = read();
    expect('cfg' in r && r.cfg.base).toBe('https://proj.supabase.co');
    expect('cfg' in r && r.cfg.extraHosts).toEqual([]);
  });

  it('секрет ровно 32 символа подходит, 31 — нет, с пробелом — нет; пусто и нет переменной — нет', () => {
    expect('cfg' in read({ CRON_SECRET: 'c'.repeat(32) })).toBe(true);
    for (const v of ['c'.repeat(31), 'c'.repeat(16) + ' ' + 'c'.repeat(16), '', undefined]) expect('problems' in read({ CRON_SECRET: v }), String(v)).toBe(true);
  });

  it('каждый недостающий параметр назван по имени, а значения секретов в список не попадают', () => {
    const r = readConfig(() => undefined);
    expect('problems' in r && r.problems.map((p) => p.split(' ')[0])).toEqual(['CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    const short = read({ CRON_SECRET: 'sekret-value-1234', VAPID_PRIVATE_KEY: 'bad-private-key-value' });
    expect(JSON.stringify(short)).not.toMatch(/sekret-value|bad-private/);
  });

  it('VAPID_SUBJECT: mailto: или https://; иное — нет', () => {
    for (const v of ['mailto:a@b.c', 'https://finora.example/']) expect('cfg' in read({ VAPID_SUBJECT: v }), v).toBe(true);
    for (const v of ['a@b.c', 'http://finora.example', 'mailto:', 'tel:123']) expect('problems' in read({ VAPID_SUBJECT: v }), v).toBe(true);
  });

  it('PUSH_EXTRA_HOSTS: хосты через запятую, мусор отбрасывается', () => {
    const r = read({ PUSH_EXTRA_HOSTS: ' Push.Example.org, ,a/b,x y,ok.test ' });
    expect('cfg' in r && r.cfg.extraHosts).toEqual(['push.example.org', 'ok.test']);
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'a')).toBe(false);
    expect(safeEqual('я', 'я')).toBe(true);
    expect(safeEqual('я', 'ё')).toBe(false);
  });
});
