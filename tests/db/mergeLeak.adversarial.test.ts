import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/db';
import { exportTransactionsCsv } from '@/db/backup';
import { toWire } from '@/sync/tables';
import { basics, expense, makeStore } from './helpers';

/** dirtyGroups — чисто локальное поле: не уходит в облако, не попадает в копии и не берётся из чужого файла. */

describe('dirtyGroups не утекает', () => {
  it('не попадает в строку для отправки, резервную копию и CSV', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const tx = await expense(store, cash.id, 1000, { note: 'секрет-заметка' });
    await store.sync.markPushed('transactions', [{ id: tx.id, clientUpdatedAt: tx.clientUpdatedAt, deviceId: tx.deviceId }]);
    const edited = await store.transactions.update(tx.id, { amountMinor: 2000 });
    expect(edited.dirtyGroups).toEqual(['money']);
    expect((edited as { dirtyBase?: unknown }).dirtyBase, 'память о правках должна быть у правленой строки').toBeDefined();
    const wireKeys = Object.keys(toWire('transactions', edited as never)).join(',').toLowerCase();
    expect(wireKeys).not.toMatch(/group|dirty/);
    expect(JSON.stringify(toWire('transactions', edited as never))).not.toMatch(/dirtyBase|dirty_base|"b":|"at":/);
    const backup = JSON.stringify(await exportBackup(store));
    expect(backup).not.toMatch(/dirtyGroups|dirty_groups|dirtyBase|dirty_base/);
    expect(await exportTransactionsCsv(store)).not.toMatch(/dirtyGroups|dirtyBase|money/);
  });

  it('чужой файл копии с лишними служебными полями не может подсунуть строке dirtyGroups', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const tx = await expense(store, cash.id, 1000);
    const backup = JSON.parse(JSON.stringify(await exportBackup(store)));
    const t = backup.transactions.find((x: { id: string }) => x.id === tx.id);
    t.dirtyGroups = ['note'];
    t.dirtyBase = { note: { b: { note: 'подмена' }, at: '2000-01-01T00:00:00.000Z' } };
    t.dirty = 0;
    t.serverSeq = 999999;
    t.clientUpdatedAt = new Date(Date.now() + 1000).toISOString(); // новее локальной: строка будет заменена версией из файла
    t.note = 'из файла';
    await importBackup(store, backup);
    const row = (await store.db.transactions.get(tx.id))!;
    expect(row.note).toBe('из файла');
    expect(row.dirty).toBe(1);
    expect('dirtyGroups' in row, 'в строку попали группы из файла').toBe(false);
    expect('dirtyBase' in row, 'в строку попала память о правках из файла').toBe(false);
    expect(row.serverSeq).not.toBe(999999);
  });
});
