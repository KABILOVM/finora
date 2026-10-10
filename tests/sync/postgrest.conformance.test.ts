// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll } from 'vitest';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { runConformance } from './conformance';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Весь набор сценариев сервера — через НАСТОЯЩИЙ supabase-js, createSupabaseTransport, HTTP-эмулятор PostgREST
 * и НАСТОЯЩУЮ схему supabase/schema.sql на PGlite.
 */

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});

const ANON_KEY = makeJwt({ role: 'anon' });
function clientFor(userId: string | null) {
  return createClient(emu.url, ANON_KEY, {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(userId === null ? {} : { accessToken: async () => makeJwt({ sub: userId }) }),
  });
}

runConformance('supabase-js + эмулятор PostgREST + PGlite', async () => ({
  transportFor: (userId) => createSupabaseTransport(clientFor(userId)),
  now: () => pg.now(),
  adminRows: (table) => pg.adminRows(table),
  signedOutTransport: () => createSupabaseTransport(clientFor(null)),
}));
