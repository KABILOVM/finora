import { describe, expect, it } from 'vitest';
import type { LocalRow, Transaction } from '@/domain/types';
import { mergeRemoteRow } from '@/db/syncMerge';
import { stamp } from './helpers';

/**
 * Алгоритмическая стоимость слияния на 5 000 записей. Саму запись в базу здесь не меряем: fake-indexeddb растёт нелинейно
 * даже на простом bulkPut (500 → 1,5 с, 2 000 → 20 с), и это не вина слияния.
 */

const N = 5000;
/** Процессорное время процесса (мс), а не настоящие часы: на загруженной машине процесс ждёт своей очереди, и настоящее время набегает само. */
const cpuMs = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const idOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const tx = (i: number, over: Partial<Transaction> = {}): Transaction => ({
  id: idOf(i + 1),
  createdAt: stamp(T0 - 100_000),
  clientUpdatedAt: stamp(T0 - 90_000),
  deviceId: 'device-r-0001',
  deletedAt: null,
  kind: 'expense',
  walletId: idOf(0),
  toWalletId: null,
  amountMinor: 1000 + i,
  toAmountMinor: null,
  categoryId: null,
  occurredOn: '2026-10-05',
  note: `n${i}`,
  baseCurrency: 'TJS',
  baseAmountMinor: 1000 + i,
  fxRate: 1,
  fxSource: 'same',
  debtId: null,
  recurringRuleId: null,
  ...over,
});

describe('слияние: стоимость', () => {
  it('5 000 слияний чистой функции укладываются в разумное время, метки строго растут и различаются', () => {
    let t = T0;
    const stamper = { deviceId: 'device-local-0001', next: (remote: string) => stamp(Math.max(Date.parse(remote), t++) + 1) };
    const started = cpuMs();
    const stamps = new Set<string>();
    for (let i = 0; i < N; i++) {
      const remote = tx(i, { amountMinor: 5000 + i, clientUpdatedAt: stamp(T0 - 10_000 + i), deviceId: 'device-r-0002' });
      const local = { ...tx(i, { note: `моя-${i}`, clientUpdatedAt: stamp(T0 - 80_000) }), dirty: 1, serverSeq: i + 1, syncError: null, dirtyGroups: ['note'] } as LocalRow<Transaction>;
      const m = mergeRemoteRow('transactions', local, remote, N + i + 1, stamper);
      expect(m.outcome).toBe('merged');
      expect(m.row!.clientUpdatedAt > remote.clientUpdatedAt).toBe(true);
      stamps.add(m.row!.clientUpdatedAt);
    }
    expect(stamps.size).toBe(N);
    expect(cpuMs() - started).toBeLessThan(2000);
  });
});
