// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { makeCategory, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Раздел 7 supabase/schema.sql (ограничения длины color / icon / fx_source) на УЖЕ созданной базе.
 * Таблицы создаются «if not exists» и в старых проектах не меняются, поэтому ограничения добавляются отдельным блоком.
 * «Старую базу» получаем так: применяем схему и убираем эти пять ограничений, как будто их никогда не было.
 */

const NAMES = ['wallets_color_len', 'wallets_icon_len', 'categories_color_len', 'categories_icon_len', 'transactions_fx_source_len'] as const;
const TABLE_OF = (name: string): string => name.slice(0, name.indexOf('_'));

let server: PgliteServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function oldDatabase(): Promise<PgliteServer> {
  server = await createPgliteServer();
  for (const name of NAMES) await server.db.exec(`alter table public.${TABLE_OF(name)} drop constraint ${name}`);
  return server;
}

const state = async (s: PgliteServer): Promise<Record<string, boolean>> => {
  const res = await s.db.query<{ conname: string; convalidated: boolean }>(
    `select conname, convalidated from pg_constraint where conname = any($1)`,
    [[...NAMES]],
  );
  return Object.fromEntries(res.rows.map((r) => [r.conname, r.convalidated]));
};

const insertWallet = (id: string, color: string, stamp = '2026-01-01T00:00:00Z'): string =>
  `insert into public.wallets (id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order)
   values ('${id}', '${stamp}', '${stamp}', 'dev', 'W', 'TJS', 'cash', 0, '${color}', 'w', 1)`;

describe('схема: ограничения длины на уже созданной базе', () => {
  it('чистая старая база: все пять ограничений добавляются и проверены', async () => {
    const s = await oldDatabase();
    expect(await state(s)).toEqual({});
    await s.applySchema();
    expect(await state(s)).toEqual(Object.fromEntries(NAMES.map((n) => [n, true])));
    const userId = makeUserId();
    await s.addUser(userId);
    await expect(s.as({ role: 'authenticated', sub: userId }, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(33))))).rejects.toMatchObject({ code: '23514' });
    await expect(s.as({ role: 'authenticated', sub: userId }, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(32))))).resolves.toBeDefined();
  });

  it('в старой базе уже лежит слишком длинная строка: схема не падает, новые длинные значения отвергаются, старую можно только укоротить', async () => {
    const s = await oldDatabase();
    const userId = makeUserId();
    await s.addUser(userId);
    const as = { role: 'authenticated' as const, sub: userId };
    const dirty = makeWallet().id;
    const long = 'c'.repeat(5000);
    await s.as(as, (tx) => tx.query(insertWallet(dirty, long)));
    const dirtyCat = makeCategory().id;
    await s.as(as, (tx) =>
      tx.query(
        `insert into public.categories (id, created_at, client_updated_at, device_id, name, kind, color, icon, sort_order)
         values ('${dirtyCat}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev', 'C', 'expense', '#fff', '${'i'.repeat(100)}', 1)`,
      ),
    );

    await s.applySchema(); // не должно бросить
    // ограничения есть для всех; «не проверены» только там, где нашлись старые нарушения
    expect(await state(s)).toEqual({
      wallets_color_len: false,
      wallets_icon_len: true,
      categories_color_len: true,
      categories_icon_len: false,
      transactions_fx_source_len: true,
    });

    // новая длинная строка отвергается
    await expect(s.as(as, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(33))))).rejects.toMatchObject({ code: '23514' });
    // правка старой строки с тем же длинным значением отвергается (её сервер принял бы только с укороченным цветом)
    const newer = '2026-02-01T00:00:00Z';
    const upsert = (color: string) =>
      `${insertWallet(dirty, color, newer)} on conflict (id) do update set color = excluded.color, client_updated_at = excluded.client_updated_at, device_id = excluded.device_id`;
    await expect(s.as(as, (tx) => tx.query(upsert(long)))).rejects.toMatchObject({ code: '23514' });
    await s.as(as, (tx) => tx.query(upsert('#abcdef')));
    const row = (await s.adminRows('wallets')).find((r) => r['id'] === dirty);
    expect(row?.['color']).toBe('#abcdef');

    // повторный запуск: ничего не падает, ничего не дублируется
    await s.applySchema();
    const count = await s.db.query<{ n: number }>(`select count(*)::int as n from pg_constraint where conname = any($1)`, [[...NAMES]]);
    expect(count.rows[0]?.n).toBe(NAMES.length);
  });
});
