import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { openDevice } from './engineHarness';

/** Два телефона: на одном меняют валюту только что заведённого кошелька, на другом (без сети) уже записывают в него расход. */

describe('валюта кошелька и офлайн-операция с другого устройства', () => {
  it('после синхронизации операция не должна менять смысл суммы: «расход 1000 TJS» не становится «1000 USD»', async () => {
    const server = createMemoryServer();
    let bOffline = false;
    const a = await openDevice(server, 'dev-a', { seed: true });
    const b = await openDevice(server, 'dev-b', {
      seed: true,
      wrap: (inner) => ({
        pull: async (t, s, l) => (bOffline ? Promise.reject(new TransportError('network', 'офлайн')) : inner.pull(t, s, l)),
        push: async (t, r) => (bOffline ? Promise.reject(new TransportError('network', 'офлайн')) : inner.push(t, r)),
      }),
    });
    await a.engine.syncNow();
    await b.engine.syncNow();

    const w = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#111111', icon: 'c' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    bOffline = true;
    // A: «я ошибся, это долларовая карта» — операций по кошельку на A ещё нет, поэтому разрешено
    await a.store.wallets.update(w.id, { currency: 'USD' });
    await a.engine.syncNow();
    // B без сети: записал расход 1000 сомони по этой карте
    const tx = await b.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100_000, occurredOn: '2026-10-05', note: 'продукты' });
    expect(tx.fxSource).toBe('same'); // B считает: валюта кошелька = базовая (TJS)

    bOffline = false;
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();

    for (const d of [a, b]) {
      const wallet = await d.store.db.wallets.get(w.id);
      const row = await d.store.db.transactions.get(tx.id);
      // инвариант: операция «в базовой валюте» (курс 1, источник same) может лежать только в кошельке базовой валюты
      expect(row?.fxSource === 'same' ? wallet?.currency === row.baseCurrency : true, `${d.deviceId}: кошелёк ${wallet?.currency}, операция fxSource=${row?.fxSource}`).toBe(true);
    }
    // следствие: остаток на обоих устройствах — «минус 1000 сомони», а не «минус 1000 долларов»
    for (const d of [a, b]) {
      const walletRow = await d.store.db.wallets.get(w.id);
      const txs = await d.store.db.transactions.toArray();
      expect(walletRow?.currency, `${d.deviceId}: валюта кошелька`).toBe('TJS');
      expect(computeBalances([walletRow!], txs).get(w.id), `${d.deviceId}: остаток`).toBe(-100_000);
    }
  });
});
