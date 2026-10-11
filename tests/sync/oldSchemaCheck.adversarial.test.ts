// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCloudCheck } from '@/sync/diagnostics';
import { makeUserId } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

const STAGE1 = readFileSync(fileURLToPath(new URL('./fixtures/schema.stage1.sql', import.meta.url)), 'utf8');
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer({ schema: STAGE1 });
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => pg.close());

describe('Проверка облака на СТАРОЙ схеме', () => {
  it('говорит «ошибка» и называет недостающие таблицы/колонки; ничего не пишет', async () => {
    const me = makeUserId();
    const real = createClient(emu.url, makeJwt({ role: 'anon' }), {
      global: {
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          const req = new Request(input, init);
          const url = new URL(req.url);
          if (req.method === 'GET' && (url.searchParams.get('select') ?? '*') !== '*') {
            url.searchParams.set('select', '*');
            return emu.fetch(url.toString(), { method: 'GET', headers: req.headers, signal: req.signal });
          }
          return emu.fetch(req);
        }) as typeof fetch,
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => makeJwt({ sub: me }),
    });
    const client = { from: (t: string) => real.from(t), auth: { getSession: async () => ({ data: { session: { user: { id: me } } }, error: null }) } };
    const steps = await runCloudCheck(client as never, { userId: me, url: 'https://abcdefgh.supabase.co', hasSession: true, pending: 0, quarantined: 0 }, { timeoutMs: 5000 });
    const by = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(by['schema']?.status).toBe('fail');
    expect(by['schema']?.message).toMatch(/debts/);
    expect(by['schema']?.message).toMatch(/budgets/);
    expect(by['schema']?.message).toMatch(/recurring_rules/);
    for (const t of ['wallets', 'transactions'] as const) expect((await pg.adminRows(t)).length).toBe(0);
  });
});
