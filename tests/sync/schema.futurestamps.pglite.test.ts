// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toWire } from '@/sync/tables';
import { makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Журнал «меток из будущего» (private.sync_future_stamps): повтор правки с убежавших вперёд часов
 * не должен ни плодить новые номера, ни затирать более новые правки других устройств.
 */

let server: PgliteServer;
beforeAll(async () => {
  server = await createPgliteServer();
}, 120_000);
afterAll(async () => {
  await server.close();
});

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ledgerCount = async (userId: string): Promise<number> =>
  (await server.db.query<{ n: number }>('select count(*)::int as n from private.sync_future_stamps where user_id = $1', [userId])).rows[0]?.n ?? -1;

/** Кошелёк «исходное» (устройство B), затем правка A с часами на час вперёд; ответ A «потерялся». */
async function scenario(userId: string) {
  const t = server.transportFor(userId);
  const real = Date.now();
  const w = makeWallet({ createdAt: iso(real - 10 * MIN), clientUpdatedAt: iso(real - 10 * MIN), name: 'исходное', deviceId: 'dev-b' });
  await t.push('wallets', [toWire('wallets', w)]);
  const row = async () => {
    const r = (await server.adminRows('wallets')).find((x) => x['id'] === w.id);
    if (!r) throw new Error('кошелёк пропал');
    return r;
  };
  const edit = (name: string, device: string, at: number) => toWire('wallets', { ...w, name, deviceId: device, clientUpdatedAt: iso(at) });
  return { t, real, w, row, edit };
}

describe('журнал меток из будущего', () => {
  it('запоздалый повтор: даже когда время сервера «догнало» присланную метку, старая правка новую не затирает', async () => {
    const { t, real, row, edit } = await scenario(makeUserId());
    const aEdit = edit('правка A', 'dev-a', real + 60 * MIN);
    try {
      await t.push('wallets', [aEdit]); // принята, метка зажата до «сейчас + 5 минут»
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(real + 6 * MIN));
      await t.push('wallets', [edit('правка B', 'dev-b', real + 6 * MIN)]);
      expect((await row())['name']).toBe('правка B');
      const afterB = await row();
      // через 52 минуты «сейчас + 5 минут» уже позже присланной метки: зажатия нет, но правку уже видели
      vi.setSystemTime(new Date(real + 58 * MIN));
      await t.push('wallets', [aEdit]);
      expect(await row()).toEqual(afterB); // ни имени, ни server_seq, ни server_updated_at не тронуто
    } finally {
      vi.useRealTimers();
    }
  });

  it('настоящая новая правка с тех же часов принимается (защита от повтора её не проглатывает)', async () => {
    const { t, real, row, edit } = await scenario(makeUserId());
    try {
      await t.push('wallets', [edit('правка A1', 'dev-a', real + 60 * MIN)]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(real + 6 * MIN));
      await t.push('wallets', [edit('правка B', 'dev-b', real + 6 * MIN)]);
      vi.setSystemTime(new Date(real + 7 * MIN));
      await t.push('wallets', [edit('правка A2', 'dev-a', real + 62 * MIN)]); // другая метка = другая правка
      const r = await row();
      expect(r['name']).toBe('правка A2');
      expect(Date.parse(String(r['client_updated_at']))).toBeLessThanOrEqual(real + 12 * MIN + 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('журнал пополняется только метками из будущего, закрыт для пользователей и чистится вместе с пользователем', async () => {
    const userId = makeUserId();
    const { t, real, edit } = await scenario(userId);
    expect(await ledgerCount(userId)).toBe(0); // честные метки в журнал не попадают
    await t.push('wallets', [edit('правка A', 'dev-a', real + 60 * MIN)]);
    await t.push('wallets', [edit('правка A', 'dev-a', real + 60 * MIN)]); // повтор: запись не дублируется
    expect(await ledgerCount(userId)).toBe(1);

    const err = await server
      .as({ role: 'authenticated', sub: userId }, (tx) => tx.query('select * from private.sync_future_stamps'))
      .then(() => null, (e: unknown) => e as { code?: string });
    expect(err?.code).toBe('42501');
    const priv = await server.db.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
      `select has_table_privilege('authenticated', 'private.sync_future_stamps', 'SELECT') as s,
              has_table_privilege('authenticated', 'private.sync_future_stamps', 'INSERT') as i,
              has_table_privilege('authenticated', 'private.sync_future_stamps', 'UPDATE') as u,
              has_table_privilege('anon', 'private.sync_future_stamps', 'SELECT') as d`,
    );
    expect(priv.rows[0]).toEqual({ s: false, i: false, u: false, d: false });
    const rls = await server.db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = 'private.sync_future_stamps'::regclass`);
    expect(rls.rows[0]?.relrowsecurity).toBe(true);

    await server.db.query('delete from auth.users where id = $1', [userId]);
    expect(await ledgerCount(userId)).toBe(0);
  });
});
