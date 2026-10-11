// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseTransport, toWellFormed } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Расхождение «локальная проверка пропустила — сервер отверг навсегда»: всё, что репозитории принимают,
 * должно доехать до настоящей схемы (PGlite) и вернуться без изменений.
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

async function device(userId: string, deviceId: string): Promise<Device> {
  const client = createClient(emu.url, ANON_KEY, {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => makeJwt({ sub: userId }),
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true });
}

async function quarantinedOf(d: Device) {
  const out: Array<{ table: string; what: string; why: string | null }> = [];
  for (const w of await d.store.db.wallets.toArray()) if (w.syncError) out.push({ table: 'wallets', what: JSON.stringify(w.name), why: w.syncError });
  for (const c of await d.store.db.categories.toArray()) if (c.syncError) out.push({ table: 'categories', what: JSON.stringify(c.name), why: c.syncError });
  for (const t of await d.store.db.transactions.toArray()) if (t.syncError) out.push({ table: 'transactions', what: JSON.stringify(t.note).slice(0, 40), why: t.syncError });
  return out;
}

const walletBase = { currency: 'TJS' as const, kind: 'cash' as const, openingBalanceMinor: 0, color: '#111111', icon: 'w' };

describe('граничные значения, которые принимает локальная проверка', () => {
  const names: Array<[string, string]> = [
    ['60 латинских', 'a'.repeat(60)],
    ['30 эмодзи', '😀'.repeat(30)],
    ['комбинируемые знаки', 'é'.repeat(30)],
    ['ZWJ-семья', '👨‍👩‍👧‍👦'.repeat(5)],
    ['управляющий символ \\u0001', 'a\u0001b'],
    ['разделитель строк U+2028', 'a b'],
    ['кавычки и обратная косая', `O'Reilly "x" \\ \\u0000 %_`],
    ['SQL', `'; drop table wallets; --`],
    ['русские', 'ЁёЙй Тоҷикӣ ҳ қ ӯ'],
    ['одинокий суррогат', 'ab\ud83d'],
    ['одинокий нижний суррогат', 'ab\ude00'],
    ['символ U+FFFF', 'a￿b'],
    ['символ U+FEFF (BOM)', '﻿name'],
  ];

  for (const [label, name] of names) {
    it(`название кошелька: ${label}`, async () => {
      const u = makeUserId();
      const d = await device(u, 'dev-a');
      await d.engine.syncNow();
      let created;
      try {
        created = await d.store.wallets.create({ ...walletBase, name });
      } catch {
        return; // локальная проверка не пустила — расхождения нет
      }
      await d.engine.syncNow();
      expect(await quarantinedOf(d), 'карантин').toEqual([]);
      const server = (await pg.adminRows('wallets')).find((r) => r['id'] === created.id);
      // «одинокая» половинка суррогатной пары не хранится в Postgres: уходит как «�», всё остальное — без изменений
      expect(server?.['name']).toBe(toWellFormed(created.name));
    });
  }

  const notes: Array<[string, string]> = [
    ['500 латинских', 'n'.repeat(500)],
    ['250 эмодзи (500 единиц UTF-16)', '😀'.repeat(250)],
    ['перевод строки и табуляция', 'a\r\nb\tc'],
    ['одинокий суррогат на границе', 'x'.repeat(499) + '\ud83d'],
    ['только эмодзи на границе 500 единиц', '😀'.repeat(249) + 'ab'],
    ['пробелы по краям', '  abc  '],
    ['U+0085 NEL', 'a\u0085b'],
  ];
  for (const [label, note] of notes) {
    it(`заметка: ${label}`, async () => {
      const u = makeUserId();
      const d = await device(u, 'dev-a');
      await d.engine.syncNow();
      const w = (await d.store.db.wallets.toArray())[0]!;
      let tx;
      try {
        tx = await d.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100, occurredOn: '2026-10-05', note });
      } catch {
        return;
      }
      await d.engine.syncNow();
      expect(await quarantinedOf(d), 'карантин').toEqual([]);
      const server = (await pg.adminRows('transactions')).find((r) => r['id'] === tx.id);
      expect(server?.['note']).toBe(toWellFormed(tx.note));
    });
  }

  const amounts: Array<[string, number, string]> = [
    ['минимум', 1, '2000-01-01'],
    ['максимум 1e15', 1_000_000_000_000_000, '2100-01-01'],
    ['високосный день', 12_345, '2024-02-29'],
  ];
  for (const [label, amountMinor, occurredOn] of amounts) {
    it(`сумма и дата: ${label}`, async () => {
      const u = makeUserId();
      const d = await device(u, 'dev-a');
      await d.engine.syncNow();
      const w = (await d.store.db.wallets.toArray())[0]!;
      let tx;
      try {
        tx = await d.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor, occurredOn });
      } catch {
        return;
      }
      await d.engine.syncNow();
      expect(await quarantinedOf(d), 'карантин').toEqual([]);
      const server = (await pg.adminRows('transactions')).find((r) => r['id'] === tx.id);
      expect(Number(server?.['amount_minor'])).toBe(tx.amountMinor);
      expect(String(server?.['occurred_on']).slice(0, 10)).toBe(tx.occurredOn);
    });
  }

  it('начальный остаток ±1e15', async () => {
    const u = makeUserId();
    const d = await device(u, 'dev-a');
    await d.engine.syncNow();
    const made = [] as string[];
    for (const openingBalanceMinor of [1e15, -1e15, 1e15 - 1]) {
      try {
        made.push((await d.store.wallets.create({ ...walletBase, name: `o${openingBalanceMinor}`, openingBalanceMinor })).id);
      } catch {
        /* не пустили */
      }
    }
    await d.engine.syncNow();
    expect(await quarantinedOf(d), 'карантин').toEqual([]);
    expect(made.length).toBeGreaterThan(0);
  });

  it('курсы: крайние и «длинные» значения возвращаются без искажения суммы в базовой валюте', async () => {
    const u = makeUserId();
    const d = await device(u, 'dev-a');
    await d.engine.syncNow();
    const usd = await d.store.wallets.create({ ...walletBase, name: 'USD', currency: 'USD' });
    const made: string[] = [];
    for (const rate of [1e-10, 0.1 + 0.2, 10.123456789012345, 9_999_999_999.5, 1 / 3, 2 / 3]) {
      try {
        const t = await d.store.transactions.create({
          kind: 'expense',
          walletId: usd.id,
          amountMinor: 123_456,
          occurredOn: '2026-10-05',
          fx: { rate, source: 'manual' },
        });
        made.push(t.id);
      } catch {
        /* не пустили */
      }
    }
    await d.engine.syncNow();
    expect(await quarantinedOf(d), 'карантин').toEqual([]);
    // после обратной загрузки локальные суммы не должны поменяться
    const before = new Map((await d.store.db.transactions.toArray()).map((t) => [t.id, t.baseAmountMinor]));
    await d.engine.syncNow();
    for (const t of await d.store.db.transactions.toArray()) expect(t.baseAmountMinor, t.id).toBe(before.get(t.id));
    expect(made.length).toBeGreaterThan(0);
  });
});
