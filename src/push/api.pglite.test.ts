// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { createPgliteServer, type Actor, type PgliteServer } from '../../tests/sync/pglite';
import { settingsToColumns, subscriptionToRow } from './api';
import type { PushSubscriptionInput } from './contract';
import { AUTH_SECRET, ENDPOINT, ENDPOINT_2, OTHER_USER, P256DH, USER } from './__fixtures__/pushKit';

/* ---------------------------------------------------------------------------------------------
 * Настоящий Postgres (PGlite) со схемой supabase/schema.sql, раздел 9. Запросы приложения переписаны в тот SQL, который строит
 * PostgREST (insert … select … from jsonb_populate_recordset … on conflict … do update; update … where …), и выполняются от имени
 * роли authenticated с JWT пользователя. Проверяем то, что заглушкой не проверить: конфликт по полю с default auth.uid(),
 * защиту строк (RLS), запрет DELETE, закрытый журнал и совпадение проверок приложения с ограничениями таблиц.
 * ------------------------------------------------------------------------------------------- */

let server: PgliteServer;
beforeAll(async () => {
  server = await createPgliteServer();
  await server.addUser(USER);
  await server.addUser(OTHER_USER);
}, 120_000);
afterAll(async () => {
  await server.close();
});

const asUser = (sub: string): Actor => ({ role: 'authenticated', sub });
const q = (ident: string): string => `"${ident}"`;
type Row = Record<string, unknown>;

/** Как PostgREST при Prefer: resolution=merge-duplicates и ?on_conflict=…: колонки — ключи тела; user_id в теле нет. */
async function upsert(tx: Transaction, table: string, conflict: string[], row: Row): Promise<Row> {
  const cols = Object.keys(row);
  const list = cols.map(q).join(', ');
  const sets = cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
  const res = await tx.query<Row>(
    `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) ` +
      `on conflict (${conflict.join(', ')}) do update set ${sets} returning *`,
    [JSON.stringify([row])],
  );
  return res.rows[0]!;
}

const settings = (sub: string, patch: Row) => server.as(asUser(sub), (tx) => upsert(tx, 'reminder_settings', ['user_id'], { ...patch, updated_at: new Date().toISOString() }));
const subscribe = (sub: string, row: Row) => server.as(asUser(sub), (tx) => upsert(tx, 'push_subscriptions', ['user_id', 'endpoint'], row));
const rowsOf = (sql: string, params: unknown[] = []) => server.db.query<Row>(sql, params).then((r) => r.rows);

async function sqlCode(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  if (e === null) return 'OK';
  return (e as { code?: string }).code ?? String(e);
}

const SUB: PushSubscriptionInput = { deviceId: 'device-aaaa-1111', endpoint: ENDPOINT, p256dh: P256DH, authSecret: AUTH_SECRET, userAgent: 'Mozilla/5.0 test' };
const subRow = (sub: PushSubscriptionInput): Row => subscriptionToRow(sub, new Date().toISOString())!;

describe('reminder_settings: настройки напоминаний в настоящей базе', () => {
  it('первое сохранение создаёт СВОЮ строку (user_id подставляет база), остальное — по умолчанию; второе меняет только названное', async () => {
    const first = await settings(USER, { enabled: true, timezone: 'Asia/Dushanbe' });
    expect(first).toMatchObject({ user_id: USER, enabled: true, hour_local: 9, timezone: 'Asia/Dushanbe', remind_payments: true, remind_debts: true, remind_daily: false, show_details: false });
    await settings(USER, { remind_daily: true, show_details: true });
    const second = await settings(USER, { hour_local: 21 });
    expect(second).toMatchObject({ user_id: USER, enabled: true, hour_local: 21, remind_daily: true, show_details: true, timezone: 'Asia/Dushanbe' });
    expect(await rowsOf('select 1 from public.reminder_settings where user_id = $1', [USER])).toHaveLength(1);
  });

  it('у каждого пользователя своя строка; чужую не прочитать и не изменить', async () => {
    await settings(OTHER_USER, { enabled: false, hour_local: 3 });
    const seen = await server.as(asUser(USER), (tx) => tx.query<Row>('select user_id, hour_local from public.reminder_settings').then((r) => r.rows));
    expect(seen).toEqual([{ user_id: USER, hour_local: 21 }]);
    // «обновить все строки» затрагивает только свои
    const upd = await server.as(asUser(USER), (tx) => tx.query('update public.reminder_settings set show_details = true'));
    expect(upd.affectedRows).toBe(1);
    expect((await rowsOf('select hour_local, show_details from public.reminder_settings where user_id = $1', [OTHER_USER]))[0]).toEqual({ hour_local: 3, show_details: false });
  });

  it('вписать строку за другого человека нельзя (RLS), удалить свою — тоже', async () => {
    const forged = server.as(asUser(USER), (tx) => tx.query('insert into public.reminder_settings (user_id, enabled) values ($1, true) on conflict (user_id) do nothing', [OTHER_USER]));
    expect(await sqlCode(forged)).toBe('42501');
    expect(await sqlCode(server.as(asUser(USER), (tx) => tx.query('delete from public.reminder_settings')))).toBe('42501');
    expect(await sqlCode(server.as({ role: 'anon', sub: null }, (tx) => tx.query('select * from public.reminder_settings')))).toBe('42501');
  });

  it('проверки приложения совпадают с ограничениями таблицы: час 0–23; всё, что приложение пропускает, база принимает', async () => {
    for (const hour of [-1, 0, 12, 23, 24]) {
      const cols = settingsToColumns({ hourLocal: hour });
      const db = await sqlCode(settings(USER, { hour_local: hour }));
      expect(cols !== null, `час ${hour}: приложение`).toBe(db === 'OK');
    }
    for (const tz of ['UTC', 'Asia/Dushanbe', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3']) {
      expect(settingsToColumns({ timezone: tz })).not.toBeNull();
      expect(await sqlCode(settings(USER, { timezone: tz })), tz).toBe('OK');
    }
    // слишком длинное или пустое база тоже не примет (приложение до неё не доведёт)
    expect(await sqlCode(settings(USER, { timezone: 'x'.repeat(65) }))).toBe('23514');
    expect(await sqlCode(settings(USER, { timezone: '' }))).toBe('23514');
    expect(settingsToColumns({ timezone: 'x'.repeat(65) })).toBeNull();
    expect(settingsToColumns({ timezone: '' })).toBeNull();
  });
});

describe('push_subscriptions: подписки устройств в настоящей базе', () => {
  it('сохранение: конфликт по (user_id, endpoint) работает при user_id из default; повторное сохранение не плодит строк и снимает отписку', async () => {
    const first = await subscribe(USER, subRow(SUB));
    expect(first).toMatchObject({ user_id: USER, endpoint: ENDPOINT, device_id: SUB.deviceId, revoked_at: null });
    await server.as(asUser(USER), (tx) => tx.query('update public.push_subscriptions set revoked_at = now() where endpoint = $1', [ENDPOINT]));
    const again = await subscribe(USER, { ...subRow(SUB), p256dh: `${P256DH}-new`.slice(0, 100) });
    expect(again).toMatchObject({ id: first.id, revoked_at: null });
    expect(again.created_at).toEqual(first.created_at);
    expect(await rowsOf('select 1 from public.push_subscriptions where user_id = $1', [USER])).toHaveLength(1);
  });

  it('тот же адрес у другого пользователя — отдельная строка, а не конфликт и не перехват чужой', async () => {
    await subscribe(OTHER_USER, subRow({ ...SUB, deviceId: 'other-device-1' }));
    const mine = await server.as(asUser(USER), (tx) => tx.query<Row>('select user_id, device_id from public.push_subscriptions').then((r) => r.rows));
    expect(mine).toEqual([{ user_id: USER, device_id: SUB.deviceId }]);
    expect(await rowsOf('select 1 from public.push_subscriptions where endpoint = $1', [ENDPOINT])).toHaveLength(2);
  });

  it('отзыв устройства (update … where device_id = … and revoked_at is null): только свои строки; удалять строки нельзя', async () => {
    await subscribe(USER, subRow({ ...SUB, endpoint: ENDPOINT_2, deviceId: 'phone-2' }));
    const patch = { revoked_at: new Date().toISOString() };
    const res = await server.as(asUser(USER), (tx) => tx.query('update public.push_subscriptions set revoked_at = $1 where device_id = $2 and revoked_at is null', [patch.revoked_at, SUB.deviceId]));
    expect(res.affectedRows).toBe(1); // у USER и OTHER_USER одинаковый адрес, но другой device_id; отозвана только эта строка
    const revokedIds = (await rowsOf('select user_id, device_id from public.push_subscriptions where revoked_at is not null')).map((r) => `${r.user_id}/${r.device_id}`);
    expect(revokedIds).toEqual([`${USER}/${SUB.deviceId}`]);
    // список действующих подписок: только свои и только не отозванные
    const active = await server.as(asUser(USER), (tx) => tx.query<Row>('select endpoint, device_id, revoked_at from public.push_subscriptions where revoked_at is null').then((r) => r.rows));
    expect(active).toEqual([{ endpoint: ENDPOINT_2, device_id: 'phone-2', revoked_at: null }]);
    expect(await sqlCode(server.as(asUser(USER), (tx) => tx.query('delete from public.push_subscriptions')))).toBe('42501');
  });

  it('вписать подписку за другого человека или перекинуть свою на другого нельзя', async () => {
    const forged = server.as(asUser(USER), (tx) =>
      tx.query('insert into public.push_subscriptions (user_id, device_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4, $5)', [OTHER_USER, 'd', 'https://push.example/forged', P256DH, AUTH_SECRET]),
    );
    expect(await sqlCode(forged)).toBe('42501');
    const hijack = server.as(asUser(USER), (tx) => tx.query('update public.push_subscriptions set user_id = $1 where device_id = $2', [OTHER_USER, 'phone-2']));
    expect(await sqlCode(hijack)).toBe('42501');
  });

  it('журнал отправленного (push_log) закрыт для приложения полностью', async () => {
    for (const actor of [asUser(USER), { role: 'anon', sub: null } as Actor]) {
      expect(await sqlCode(server.as(actor, (tx) => tx.query('select * from public.push_log')))).toBe('42501');
      expect(await sqlCode(server.as(actor, (tx) => tx.query("insert into public.push_log (user_id, kind, ref, sent_on) values ($1, 'daily', 'x', current_date)", [USER])))).toBe('42501');
    }
  });

  it('приложение не отправляет того, что база отклонит (граничные длины); по договору лишнее отклоняет само', async () => {
    const https = (n: number, tag: string) => `https://${tag}`.padEnd(n, 'a');
    // [название, подписка, годна ли она по договору (src/push/contract.ts + раздел 9 схемы), база обязана отклонить то же]
    const cases: Array<[string, (tag: string) => PushSubscriptionInput, boolean, boolean]> = [
      ['адрес 11 символов', (t) => ({ ...SUB, endpoint: https(11, t) }), false, true],
      ['адрес 12', (t) => ({ ...SUB, endpoint: https(12, t) }), true, false],
      ['адрес 2048', (t) => ({ ...SUB, endpoint: https(2048, t) }), true, false],
      ['адрес 2049', (t) => ({ ...SUB, endpoint: https(2049, t) }), false, true],
      ['адрес http', (t) => ({ ...SUB, endpoint: `http://${t}`.padEnd(30, 'a') }), false, true],
      ['ключ 20', (t) => ({ ...SUB, endpoint: https(30, t), p256dh: 'k'.repeat(20) }), true, false],
      ['ключ 200', (t) => ({ ...SUB, endpoint: https(30, t), p256dh: 'k'.repeat(200) }), true, false],
      ['ключ 201', (t) => ({ ...SUB, endpoint: https(30, t), p256dh: 'k'.repeat(201) }), false, true],
      ['секрет 7', (t) => ({ ...SUB, endpoint: https(30, t), authSecret: 's'.repeat(7) }), false, true],
      ['секрет 8', (t) => ({ ...SUB, endpoint: https(30, t), authSecret: 's'.repeat(8) }), true, false],
      ['секрет 100', (t) => ({ ...SUB, endpoint: https(30, t), authSecret: 's'.repeat(100) }), true, false],
      ['секрет 101', (t) => ({ ...SUB, endpoint: https(30, t), authSecret: 's'.repeat(101) }), false, true],
      ['устройство пустое', (t) => ({ ...SUB, endpoint: https(30, t), deviceId: '' }), false, true],
      ['устройство 1', (t) => ({ ...SUB, endpoint: https(30, t), deviceId: 'd' }), true, false],
      ['устройство 64', (t) => ({ ...SUB, endpoint: https(30, t), deviceId: 'd'.repeat(64) }), true, false],
      ['устройство 65', (t) => ({ ...SUB, endpoint: https(30, t), deviceId: 'd'.repeat(65) }), false, true],
      ['user agent 1000 (приложение режет до 300)', (t) => ({ ...SUB, endpoint: https(30, t), userAgent: 'u'.repeat(1000) }), true, false],
    ];
    for (const [i, [name, make, valid, dbMustReject]] of cases.entries()) {
      const sub = make(`b${i}x`);
      const row = subscriptionToRow(sub, new Date().toISOString());
      expect(row !== null, `${name}: по договору ${valid ? 'годна' : 'негодна'}`).toBe(valid);
      // главное: что приложение пропустило, то база принимает
      if (row) expect(await sqlCode(subscribe(OTHER_USER, row)), `${name}: база должна принять то, что отправило приложение`).toBe('OK');
      // и ограничения таблицы действительно такие, как в договоре (иначе договор и схема разошлись)
      if (dbMustReject) {
        const raw: Row = { device_id: sub.deviceId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth_secret: sub.authSecret, user_agent: sub.userAgent.slice(0, 300) };
        expect(await sqlCode(subscribe(OTHER_USER, raw)), `${name}: база должна отклонить`).toBe('23514');
      }
    }
  });
});
