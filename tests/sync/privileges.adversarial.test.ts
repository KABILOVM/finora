// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeUserId, makeWallet } from './factories';
import { toWire } from '@/sync/tables';
import { createPgliteServer, type PgliteServer } from './pglite';

let pg: PgliteServer;
beforeAll(async () => {
  pg = await createPgliteServer();
}, 120_000);
afterAll(async () => pg.close());

const TABLES = ['settings', 'wallets', 'categories', 'debts', 'budgets', 'recurring_rules', 'transactions'];

describe('права на новые таблицы', () => {
  it('ни anon, ни authenticated не могут удалять, очищать, менять ключи и читать служебную схему', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const t of TABLES) {
        for (const priv of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const r = await pg.db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${t}', '${priv}') as ok`);
          expect(r.rows[0]!.ok, `${role} ${priv} ${t}`).toBe(false);
        }
      }
      const anonSel = await pg.db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.debts', 'SELECT') as ok`);
      if (role === 'anon') expect(anonSel.rows[0]!.ok).toBe(false);
    }
    const sch = await pg.db.query<{ ok: boolean }>(`select has_schema_privilege('authenticated', 'private', 'USAGE') as ok`);
    expect(sch.rows[0]!.ok).toBe(false);
  });

  it('чужой пользователь не может обновить/подменить мои долги, бюджеты и правила через upsert с тем же id', async () => {
    const u = makeUserId();
    const v = makeUserId();
    await pg.addUser(u);
    await pg.addUser(v);
    const cat = makeCategory({ clientUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' });
    const w = makeWallet({ clientUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' });
    const debt = makeDebt({ clientUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' });
    const bud = makeBudget({ categoryId: cat.id, clientUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' });
    const rule = makeRecurringRule({ walletId: w.id, debtId: debt.id, clientUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' });
    const tu = pg.transportFor(u);
    await tu.push('wallets', [toWire('wallets', w)]);
    await tu.push('categories', [toWire('categories', cat)]);
    await tu.push('debts', [toWire('debts', debt)]);
    await tu.push('budgets', [toWire('budgets', bud)]);
    await tu.push('recurring_rules', [toWire('recurring_rules', rule)]);
    const tv = pg.transportFor(v);
    const later = '2026-10-09T00:00:00.000Z';
    await expect(tv.push('debts', [toWire('debts', { ...debt, counterparty: 'ВЗЛОМ', clientUpdatedAt: later })])).rejects.toBeDefined();
    await expect(tv.push('budgets', [toWire('budgets', { ...bud, amountMinor: 1, clientUpdatedAt: later })])).rejects.toBeDefined();
    await expect(tv.push('recurring_rules', [toWire('recurring_rules', { ...rule, amountMinor: 1, clientUpdatedAt: later })])).rejects.toBeDefined();
    const rows = await pg.adminRows('debts');
    expect(rows.find((r) => r['id'] === debt.id)?.['counterparty']).not.toBe('ВЗЛОМ');
    expect(await tv.pull('debts', 0, 100)).toEqual([]);
    expect(await tv.pull('budgets', 0, 100)).toEqual([]);
    expect(await tv.pull('recurring_rules', 0, 100)).toEqual([]);
  });
});
