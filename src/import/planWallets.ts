import { placementOf, type ExistingMap } from './existing';
import { nameKey } from './text';
import type { AccountRef, PlanWallet, WalletChoice, WalletLite, WalletTarget, ZenRow } from './types';

const isLive = (w: WalletLite) => w.deletedAt === null;
const isUsable = (w: WalletLite) => w.deletedAt === null && w.archivedAt === null;

/**
 * Счёт Дзен-мани → кошелёк. Порядок автоподбора:
 *  1) кошелёк, созданный прошлым импортом (детерминированный id) — повторный импорт не плодит дубли;
 *  2) кошелёк, где уже лежат операции этого счёта из прошлых загрузок (человек направил счёт туда вручную: «history») —
 *     иначе новые строки того же счёта расползлись бы по другому, только что созданному кошельку;
 *  3) живой кошелёк с тем же названием и той же валютой;
 *  4) иначе — создать новый (начальный остаток 0).
 * Человек может вручную выбрать любой подходящий кошелёк той же валюты или «создать новый».
 * Кошелёк прошлого импорта, который потом удалили или убрали в архив, не воскрешаем и не обходим молча: счёт блокируется,
 * пока человек не выберет другой кошелёк (в архивный и удалённый операции писать нельзя).
 */
export function resolveWallet(
  account: AccountRef & { rowCount: number },
  wallets: readonly WalletLite[],
  detId: string,
  choice: WalletChoice | undefined,
  history?: string,
): Omit<PlanWallet, 'movementMinor' | 'addCount'> {
  const candidates = wallets.filter((w) => isUsable(w) && w.currency === account.currency).map((w) => ({ id: w.id, name: w.name }));
  const det = wallets.find((w) => w.id === detId);
  // Новый кошелёк получает детерминированный id: если он уже занят (живым, архивным или удалённым), «создать новый» невозможно
  const base = { key: account.key, name: account.name, currency: account.currency, rowCount: account.rowCount, candidates, canCreate: !det };

  if (choice !== undefined && choice !== 'new') {
    const picked = candidates.find((c) => c.id === choice);
    if (picked) return { ...base, target: { kind: 'existing', id: picked.id, name: picked.name, how: 'chosen' }, chosen: true };
    // выбранный кошелёк пропал или стал неподходящим — возвращаемся к автоподбору
  }

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
  const past = history === undefined ? undefined : candidates.find((c) => c.id === history);
  const wanted = nameKey(account.name);
  const byName = candidates.find((c) => nameKey(c.name) === wanted);
  // История и название указывают на один кошелёк — это обычный «найден по названию», пояснять нечего
  if (past && past.id !== byName?.id) return { ...base, target: { kind: 'existing', id: past.id, name: past.name, how: 'history' }, chosen: false };
  if (byName) return { ...base, target: { kind: 'existing', id: byName.id, name: byName.name, how: 'name' }, chosen: false };
  return { ...base, target: fresh(), chosen: false };
}

/** id кошелька, в который пойдут операции счёта; null — счёт заблокирован. */
export function targetWalletId(t: WalletTarget): string | null {
  return t.kind === 'blocked' ? null : t.id;
}

/**
 * Где уже лежат операции каждого счёта: ключ счёта → кошелёк, в котором их больше всего (при равенстве — с меньшим id, чтобы
 * результат не зависел от порядка). Берутся только строки файла, найденные в базе по номеру: по ним видно, куда счёт был направлен
 * раньше, даже если человек выбирал кошелёк вручную и кошелёк импорта не создавался.
 */
export function walletHistory(rows: readonly ZenRow[], txIds: readonly string[], existing: ExistingMap): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  const add = (key: string | undefined, walletId: string | null) => {
    if (key === undefined || walletId === null) return;
    const byWallet = tally.get(key) ?? new Map<string, number>();
    byWallet.set(walletId, (byWallet.get(walletId) ?? 0) + 1);
    tally.set(key, byWallet);
  };
  for (const row of rows) {
    const v = existing.get(txIds[row.index] ?? '');
    if (v === undefined || typeof v === 'boolean') continue;
    const placed = placementOf(row.kind, v);
    add(row.outcome?.account.key, placed.out);
    add(row.income?.account.key, placed.in);
  }
  const out = new Map<string, string>();
  for (const [key, byWallet] of tally) {
    let best: string | null = null;
    let bestN = 0;
    for (const [id, n] of byWallet) {
      if (n > bestN || (n === bestN && best !== null && id < best)) {
        best = id;
        bestN = n;
      }
    }
    if (best !== null) out.set(key, best);
  }
  return out;
}
