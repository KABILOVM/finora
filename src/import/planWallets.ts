import { nameKey } from './text';
import type { AccountRef, PlanWallet, WalletChoice, WalletLite, WalletTarget } from './types';

const isLive = (w: WalletLite) => w.deletedAt === null;
const isUsable = (w: WalletLite) => w.deletedAt === null && w.archivedAt === null;

/**
 * Счёт Zenmoney → кошелёк. Порядок автоподбора:
 *  1) кошелёк, созданный прошлым импортом (детерминированный id) — повторный импорт не плодит дубли;
 *  2) живой кошелёк с тем же названием и той же валютой;
 *  3) иначе — создать новый (начальный остаток 0).
 * Человек может вручную выбрать любой подходящий кошелёк той же валюты или «создать новый».
 * Кошелёк прошлого импорта, который потом удалили или убрали в архив, не воскрешаем и не обходим молча: счёт блокируется,
 * пока человек не выберет другой кошелёк (в архивный и удалённый операции писать нельзя).
 */
export function resolveWallet(
  account: AccountRef & { rowCount: number },
  wallets: readonly WalletLite[],
  detId: string,
  choice: WalletChoice | undefined,
): Omit<PlanWallet, 'movementMinor' | 'addCount'> {
  const candidates = wallets.filter((w) => isUsable(w) && w.currency === account.currency).map((w) => ({ id: w.id, name: w.name }));
  const base = { key: account.key, name: account.name, currency: account.currency, rowCount: account.rowCount, candidates };

  if (choice !== undefined && choice !== 'new') {
    const picked = candidates.find((c) => c.id === choice);
    if (picked) return { ...base, target: { kind: 'existing', id: picked.id, name: picked.name, how: 'chosen' }, chosen: true };
    // выбранный кошелёк пропал или стал неподходящим — возвращаемся к автоподбору
  }

  const det = wallets.find((w) => w.id === detId);
  const fresh = (): WalletTarget => {
    if (!det) return { kind: 'create', id: detId, name: account.name };
    if (!isLive(det)) return { kind: 'blocked', reason: `Кошелёк «${det.name}», созданный прошлым импортом, удалён. Выберите другой кошелёк для этого счёта.` };
    if (!isUsable(det)) return { kind: 'blocked', reason: `Кошелёк «${det.name}», созданный прошлым импортом, лежит в архиве. Верните его из архива или выберите другой кошелёк.` };
    return { kind: 'existing', id: det.id, name: det.name, how: 'saved' };
  };

  if (choice === 'new') return { ...base, target: fresh(), chosen: true };

  if (det && isUsable(det)) {
    return { ...base, target: { kind: 'existing', id: det.id, name: det.name, how: 'saved' }, chosen: false };
  }
  const wanted = nameKey(account.name);
  const byName = candidates.find((c) => nameKey(c.name) === wanted);
  if (byName) return { ...base, target: { kind: 'existing', id: byName.id, name: byName.name, how: 'name' }, chosen: false };
  return { ...base, target: fresh(), chosen: false };
}

/** id кошелька, в который пойдут операции счёта; null — счёт заблокирован. */
export function targetWalletId(t: WalletTarget): string | null {
  return t.kind === 'blocked' ? null : t.id;
}
