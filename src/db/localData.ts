import Dexie, { type DexieOptions } from 'dexie';
import { dbNameFor } from './database';
import { defaultId } from './ids';

/**
 * Сколько данных ПОЛЬЗОВАТЕЛЯ лежит в его локальной базе на этом устройстве: живые операции плюс кошельки, заведённые им самим
 * (стартовый «Наличные» не считается: он есть у каждого). Базу НЕ создаёт: нет её на устройстве — 0. Любая ошибка — тоже 0:
 * это лишь подсказка человеку, она не должна мешать запуску приложения.
 */
export async function countUserData(userId: string, options?: DexieOptions): Promise<number> {
  const db = new Dexie(dbNameFor(userId), options);
  try {
    await db.open(); // без объявленной схемы Dexie только читает существующую базу; нет базы — ошибка, и ничего не создаётся
    const names = new Set(db.tables.map((t) => t.name));
    if (!names.has('transactions') || !names.has('wallets')) return 0;
    const cashId = await defaultId(userId, 'wallet:cash');
    const [transactions, wallets] = await Promise.all([
      db.table('transactions').filter((t: { deletedAt: unknown }) => t.deletedAt === null).count(),
      db.table('wallets').filter((w: { deletedAt: unknown; id: string }) => w.deletedAt === null && w.id !== cashId).count(),
    ]);
    return transactions + wallets;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}
