import type { Store } from '@/db';
import type { TxKind, UUID } from '@/domain/types';
import type { ExistingTx, Placement } from './types';

/**
 * Что планировщик знает об операциях, которые уже лежат в базе. Нужно для трёх вещей:
 *  1) «уже есть» по номеру (id) — как и раньше;
 *  2) «уже есть» по содержимому (дата, сумма, кошелёк, заметка): id операций из резервной копии другого аккаунта или локального
 *     режима перекодируются (backupRecode.ts) и больше не совпадают с id, выведенными из строк файла, а повторная загрузка
 *     выгрузки целиком не должна задваивать историю;
 *  3) в каком кошельке операция лежит на самом деле — чтобы новые строки того же счёта шли туда же, а «остаток по файлу» не
 *     считал деньги, которые лежат в другом кошельке.
 */

export type ExistingMap = ReadonlyMap<string, boolean | ExistingTx>;

/** Все операции базы (включая удалённые) в виде, нужном планировщику. */
export async function loadExisting(store: Store): Promise<Map<string, ExistingTx>> {
  const out = new Map<string, ExistingTx>();
  await store.db.transactions.each((t) => {
    out.set(t.id, {
      deleted: t.deletedAt !== null,
      kind: t.kind,
      walletId: t.walletId,
      toWalletId: t.toWalletId,
      amountMinor: t.amountMinor,
      toAmountMinor: t.toAmountMinor,
      occurredOn: t.occurredOn,
      note: t.note,
    });
  });
  return out;
}

export const isDeletedEntry = (v: boolean | ExistingTx): boolean => (typeof v === 'boolean' ? v : v.deleted);

/**
 * В каких кошельках лежат стороны операции. Если вид операции в базе стал другим, чем в строке файла (человек изменил её руками),
 * не гадаем: сторон нет.
 */
export function placementOf(kind: TxKind, tx: ExistingTx): Placement {
  if (tx.kind !== kind) return { out: null, in: null };
  if (kind === 'expense') return { out: tx.walletId, in: null };
  if (kind === 'income') return { out: null, in: tx.walletId };
  return { out: tx.walletId, in: tx.toWalletId };
}

const SEP = '\u001f';

export interface ContentFields {
  kind: TxKind;
  occurredOn: string;
  walletId: UUID;
  toWalletId: UUID | null;
  amountMinor: number;
  toAmountMinor: number | null;
  note: string;
}

/** Ключ «содержимого»: вид, дата, кошельки, суммы, заметка. Категория не входит: её человек часто правит после импорта. */
export function contentKey(f: ContentFields): string {
  return [f.kind, f.occurredOn, f.walletId, f.toWalletId ?? '', f.amountMinor, f.toAmountMinor ?? '', f.note.trim()].join(SEP);
}

export interface ContentIndex {
  /** Забирает одну подходящую операцию базы (живые раньше удалённых): одну и ту же нельзя засчитать дважды. */
  take(key: string): 'live' | 'deleted' | null;
}

/**
 * Индекс операций базы по содержимому. Не входят операции, чей id совпал со строкой файла: они уже учтены «по номеру»
 * (иначе вторая такая же строка файла ошибочно «нашла» бы чужую пару).
 * Одинаковые операции считаются по количеству: две одинаковые чашки кофе в файле — это две операции, а в базе одна — значит
 * одна «уже есть», вторая добавится.
 */
export function buildContentIndex(existing: ExistingMap, claimedIds: ReadonlySet<string>): ContentIndex {
  const counts = new Map<string, { live: number; deleted: number }>();
  for (const [id, v] of existing) {
    if (typeof v === 'boolean' || claimedIds.has(id)) continue;
    const key = contentKey(v);
    const c = counts.get(key) ?? { live: 0, deleted: 0 };
    if (v.deleted) c.deleted++;
    else c.live++;
    counts.set(key, c);
  }
  return {
    take(key) {
      const c = counts.get(key);
      if (!c) return null;
      if (c.live > 0) {
        c.live--;
        return 'live';
      }
      if (c.deleted > 0) {
        c.deleted--;
        return 'deleted';
      }
      return null;
    },
  };
}
