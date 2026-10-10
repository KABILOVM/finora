// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toWire } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Состязательные проверки supabase/schema.sql на настоящем Postgres (PGlite).
 * Каждый тест утверждает ЖЕЛАЕМОЕ поведение; красный тест = найденная дыра.
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

async function rejectedKind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  if (e === null) return 'accepted';
  return e instanceof TransportError ? e.kind : `other:${String(e)}`;
}

describe('метка из будущего: повтор той же правки', () => {
  it('A1. повторная отправка той же строки с меткой далеко в будущем НЕ должна давать новый server_seq', async () => {
    const t = server.transportFor(makeUserId());
    const now = Date.now();
    const w = makeWallet({ createdAt: iso(now - MIN), clientUpdatedAt: iso(now + 60 * MIN), name: 'A' });
    await t.push('wallets', [toWire('wallets', w)]);
    const first = await t.pull('wallets', 0, 10);
    await t.push('wallets', [toWire('wallets', w)]);
    await t.push('wallets', [toWire('wallets', w)]);
    const after = await t.pull('wallets', 0, 10);
    expect(after).toEqual(first); // идемпотентность: ни новых номеров, ни новых меток
  });

  it('A2. повтор старой правки с убежавших вперёд часов не должен затирать более новую правку с другого устройства', async () => {
    const t = server.transportFor(makeUserId());
    const real = Date.now();
    const w = makeWallet({ createdAt: iso(real - 10 * MIN), clientUpdatedAt: iso(real - 10 * MIN), name: 'исходное', deviceId: 'dev-b' });
    await t.push('wallets', [toWire('wallets', w)]);
    const nameOnServer = async () => (await server.adminRows('wallets')).find((r) => r['id'] === w.id)?.['name'];
    try {
      // Устройство A: часы на час вперёд. Правка принята (метка зажата до «сейчас + 5 мин»); ответ до A не дошёл.
      const aEdit = toWire('wallets', { ...w, name: 'правка A (старая)', deviceId: 'dev-a', clientUpdatedAt: iso(real + 60 * MIN) });
      await t.push('wallets', [aEdit]);
      // Проходит 6 минут. Устройство B (честные часы) делает более новую правку: её метка больше сохранённой.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(real + 6 * MIN));
      await t.push('wallets', [toWire('wallets', { ...w, name: 'правка B (новая)', deviceId: 'dev-b', clientUpdatedAt: iso(real + 6 * MIN) })]);
      expect(await nameOnServer()).toBe('правка B (новая)');
      // Проходит ещё минута. Устройство A повторяет ту же отправку (не получило подтверждение).
      vi.setSystemTime(new Date(real + 7 * MIN));
      await t.push('wallets', [aEdit]);
      expect(await nameOnServer()).toBe('правка B (новая)');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('мусор в тексте', () => {
  it('D1. код валюты с переводом строки в конце отвергается', async () => {
    const t = server.transportFor(makeUserId());
    const now = Date.now();
    const w = makeWallet({ createdAt: iso(now - MIN), clientUpdatedAt: iso(now - MIN), currency: 'TJS\n' });
    expect(await rejectedKind(t.push('wallets', [toWire('wallets', w)]))).toBe('rejected');
  });

  it('D2. символ NUL и «осиротевший» суррогат в имени не дают ошибку класса server (повтор бесполезен)', async () => {
    const t = server.transportFor(makeUserId());
    const now = Date.now();
    for (const name of ['a\u0000b', 'x\ud83d']) {
      const w = makeWallet({ createdAt: iso(now - MIN), clientUpdatedAt: iso(now - MIN), name });
      expect(await rejectedKind(t.push('wallets', [toWire('wallets', w)])), JSON.stringify(name)).not.toMatch(/^server$|^other/);
    }
  });
});

describe('большая пачка', () => {
  it('E1. 3000 операций одной пачкой принимаются и забираются без потерь и дублей', async () => {
    const userId = makeUserId();
    const t = server.transportFor(userId);
    const now = Date.now();
    const stamp = { createdAt: iso(now - 60 * MIN), clientUpdatedAt: iso(now - 60 * MIN) };
    const w = makeWallet(stamp);
    await t.push('wallets', [toWire('wallets', w)]);
    const txs = Array.from({ length: 3000 }, (_, i) => makeTransaction({ ...stamp, walletId: w.id, amountMinor: i + 1, baseAmountMinor: i + 1 }));
    await t.push('transactions', txs.map((x) => toWire('transactions', x)));
    const seen = new Set<string>();
    let cur = 0;
    for (;;) {
      const page = await t.pull('transactions', cur, 500);
      for (const r of page) seen.add(String(r['id']));
      if (page.length < 500) break;
      cur = page[page.length - 1]?.server_seq ?? cur;
    }
    expect(seen.size).toBe(3000);
  }, 60_000);
});
