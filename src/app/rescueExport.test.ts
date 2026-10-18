import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { ensureSeeded, FinoraDB, importBackup, openStore, type Store } from '@/db';
import { withoutSettings } from '@/features/settings/backupAccount';
import { lockKey } from '@/lock/lockStore';
import { canRescueExport, exportLocalBackup } from './rescueExport';

const spy = vi.hoisted(() => ({ files: [] as Array<{ name: string; mime: string; content: string }>, opened: [] as unknown[] }));

vi.mock('@/features/settings/download', () => ({
  downloadTextFile: (name: string, mime: string, content: string) => spy.files.push({ name, mime, content }),
}));
// Настоящее хранилище, но запоминаем каждое открытое: экран сбоя обязан его закрыть.
vi.mock('@/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db')>();
  return {
    ...real,
    openStore: async (...args: Parameters<typeof real.openStore>) => {
      const s = await real.openStore(...args);
      spy.opened.push(s);
      return s;
    },
  };
});

const ACCOUNT = '7d1f6f3e-4a0b-4b1e-9d3a-2f5a8c9e1b77';

afterEach(async () => {
  spy.files.length = 0;
  spy.opened.length = 0;
  localStorage.clear();
  await new FinoraDB(LOCAL_USER_ID).delete();
  await new FinoraDB(ACCOUNT).delete();
});

async function seedLocal(): Promise<void> {
  const s = await openStore(LOCAL_USER_ID);
  try {
    await ensureSeeded(s);
    const wallet = (await s.db.wallets.toArray())[0];
    await s.transactions.create({ kind: 'expense', walletId: wallet?.id ?? '', amountMinor: 1250, occurredOn: '2026-10-15', note: 'обед' });
  } finally {
    s.close();
  }
}

describe('копия данных с экрана сбоя (локальный режим)', () => {
  it('сохраняет полную резервную копию, которую принимает восстановление, и закрывает хранилище', async () => {
    await seedLocal();
    spy.opened.length = 0;
    await exportLocalBackup();

    expect(spy.files).toHaveLength(1);
    const file = spy.files[0] as { name: string; mime: string; content: string };
    expect(file.name).toMatch(/^sumoima-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.mime).toBe('application/json');
    // тот же файл, что даёт «Резервная копия» в Настройках: его можно загрузить обратно
    const account = await openStore(ACCOUNT);
    try {
      await importBackup(account, withoutSettings(JSON.parse(file.content)), { sourceUserId: LOCAL_USER_ID });
      const notes = (await account.db.transactions.toArray()).map((t) => t.note);
      expect(notes).toContain('обед');
    } finally {
      account.close();
    }
    const rescued = spy.opened[0] as Store;
    expect(rescued.userId).toBe(LOCAL_USER_ID);
    expect(rescued.db.isOpen()).toBe(false);
  });

  it('замок включён (или запись замка повреждена) — копию не предлагаем и не сохраняем', async () => {
    expect(canRescueExport()).toBe(true);
    localStorage.setItem(lockKey(LOCAL_USER_ID), '{битая запись');
    expect(canRescueExport()).toBe(false);
    await expect(exportLocalBackup()).rejects.toThrow(/замок/);
    expect(spy.files).toHaveLength(0);
    expect(spy.opened).toHaveLength(0);
  });
});
