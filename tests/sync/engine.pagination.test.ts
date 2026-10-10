import { describe, expect, it } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { toWire } from '@/sync/tables';
import { makeTransaction, makeWallet } from './factories';
import { USER, openDevice, spy, type Spy } from './engineHarness';

/** Получение страницами по 500: ничего не пропускается на стыках страниц, пустой хвост не запрашивается зря. */

const iso = (ms: number) => new Date(ms).toISOString();

/** Сервер, на котором уже лежит кошелёк и n операций (отправлены напрямую, минуя устройства). */
async function serverWith(n: number): Promise<{ server: MemoryServer; ids: string[] }> {
  const server = createMemoryServer();
  const t = server.transportFor(USER);
  const base = Date.now() - 3_600_000;
  const wallet = makeWallet({ createdAt: iso(base), clientUpdatedAt: iso(base) });
  await t.push('wallets', [toWire('wallets', wallet)]);
  const txs = Array.from({ length: n }, (_, i) =>
    makeTransaction({ walletId: wallet.id, createdAt: iso(base + i), clientUpdatedAt: iso(base + i), amountMinor: 1 + i, baseAmountMinor: 1 + i }),
  );
  for (let i = 0; i < txs.length; i += 200) await t.push('transactions', txs.slice(i, i + 200).map((x) => toWire('transactions', x)));
  return { server, ids: txs.map((x) => x.id) };
}

async function newDevice(server: MemoryServer) {
  let sp!: Spy;
  const d = await openDevice(server, 'dev-b', { wrap: (inner) => (sp = spy(inner)).transport });
  return { d, sp };
}

describe('страницы получения', () => {
  it('1100 операций: три страницы (500 + 500 + 100), всё на месте, курс на последней строке', async () => {
    const { server, ids } = await serverWith(1100);
    const { d, sp } = await newDevice(server);
    await d.engine.syncNow();
    expect(await d.store.db.transactions.count()).toBe(1100);
    expect((await d.store.db.transactions.toArray()).map((t) => t.id).sort()).toEqual([...ids].sort());
    const rows = server.dump(USER, 'transactions');
    expect(await d.store.sync.getCursor('transactions')).toBe(rows[rows.length - 1]?.server_seq);
    // первая загрузка: 3 страницы; после отправки — ещё одно получение (пустое, с курсором на хвосте)
    const first = sp.pulls('transactions').map((c) => c.size);
    expect(first).toHaveLength(4);
    expect(first[0]).toBe(0);
    expect(first[1]).toBe(rows[499]?.server_seq);
    expect(first[2]).toBe(rows[999]?.server_seq);
    expect(first[3]).toBe(rows[1099]?.server_seq);
  });

  it('ровно 500 операций: после полной страницы делается ещё один запрос и он пустой; ничего не теряется', async () => {
    const { server } = await serverWith(500);
    const { d, sp } = await newDevice(server);
    await d.engine.syncNow();
    expect(await d.store.db.transactions.count()).toBe(500);
    const sizes = sp.pulls('transactions').map((c) => c.size);
    expect(sizes).toHaveLength(3); // 0 → полная страница; хвост → пусто; (после отправки) хвост → пусто
    expect(sizes[1]).toBe(sizes[2]);
  });

  it('499 операций: одна неполная страница, лишнего запроса за хвостом нет', async () => {
    const { server } = await serverWith(499);
    const { d, sp } = await newDevice(server);
    await d.engine.syncNow();
    expect(await d.store.db.transactions.count()).toBe(499);
    expect(sp.pulls('transactions')).toHaveLength(2); // первая загрузка + получение после отправки
  });

  it('сервер вернул строки не новее курса (баг сервера): цикл не зацикливается, а завершается ошибкой', async () => {
    const { server } = await serverWith(10);
    const { d, sp } = await newDevice(server);
    await d.engine.syncNow();
    expect(await d.store.db.transactions.count()).toBe(10);
    // «сломанный» сервер: на любой запрос возвращает одну и ту же полную страницу старых строк
    const old = server.dump(USER, 'transactions');
    sp.onPull = (table, _after, rows) => (table === 'transactions' ? Array.from({ length: 500 }, (_, i) => old[i % old.length]!) : rows);
    await d.engine.syncNow();
    expect(d.engine.getStatus().phase).toBe('error');
    expect(sp.pulls('transactions').length).toBeLessThan(10); // не крутились по кругу
  });
});
