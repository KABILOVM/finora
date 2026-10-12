import type { BackupFile } from './backupSchema';
import { defaultId, FINORA_NAMESPACE, isUuid, uuidV5 } from './ids';
import { budgetSlug } from './budgetsRepo';
import { SEED_SLUGS } from './seed';

/**
 * Свои id для чужой копии. На сервере первичный ключ id ОДИН НА ВСЕХ пользователей: запись с id, который уже занят
 * чужой строкой (копия другого или старого аккаунта, копия из локального режима, загруженная во второй аккаунт),
 * сервер отвергает навсегда (нет прав на чужую строку), и она висит «не принята сервером» без шанса уйти.
 * Поэтому каждый id из такого файла заменяется на производный от (этот пользователь + прежний id), а все ссылки
 * (родитель категории, кошелёк, категория, долг и регулярный платёж операции, кошельки/категория/долг правила,
 * категория бюджета) переписываются так же. Производный id не случаен: тот же файл второй раз даёт те же id, поэтому повторная
 * загрузка ничего не плодит (записи сливаются по правилу «новее побеждает»), и два устройства одного аккаунта, загрузив один
 * файл, получают одни и те же записи. Ссылка на запись, которой нет в файле, остаётся как есть: её существование проверит импорт.
 *
 * Детерминированные id пересчитываются, а не просто перекодируются:
 *  - бюджет: id = defaultId(пользователь, 'budget:' + новая категория | 'total') — после перекодирования категорий;
 *  - операция по расписанию, чей id был v5(прежнее правило, дата): id = v5(новое правило, дата) — тогда она совпадёт с операцией,
 *    которую это же правило создаст на любом устройстве. Операция с изменённой датой (id уже не выводится из даты) перекодируется
 *    как обычная.
 */
export async function withAccountIds(file: BackupFile, userId: string, sourceUserId?: string): Promise<BackupFile> {
  // Стартовые записи (кошелёк «Наличные», категории) у каждого пользователя свои, но выводятся из его id по одним и тем же slug.
  // Если известно, чья это копия, её стартовые записи сопоставляются со стартовыми записями ЭТОГО пользователя, а не плодят дубли.
  const seeded = new Map<string, string>();
  if (sourceUserId !== undefined && isUuid(sourceUserId)) {
    for (const slug of SEED_SLUGS) seeded.set(await defaultId(sourceUserId, slug), await defaultId(userId, slug));
  }
  const derive = async (kind: string, ids: readonly string[]): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const id of ids) out.set(id, seeded.get(id) ?? (await uuidV5(FINORA_NAMESPACE, `${userId}:import:${kind}:${id}`)));
    return out;
  };
  const [w, c, d, r, sh] = await Promise.all([
    derive('wallet', file.wallets.map((x) => x.id)),
    derive('category', file.categories.map((x) => x.id)),
    derive('debt', file.debts.map((x) => x.id)),
    derive('rule', file.recurringRules.map((x) => x.id)),
    derive('shopping', file.shoppingItems.map((x) => x.id)),
  ]);
  const pick = (m: Map<string, string>, id: string | null): string | null => (id === null ? null : (m.get(id) ?? id));

  // операции: id по расписанию пересчитываются от нового правила, остальные — обычным производным
  const txIds = new Map<string, string>();
  for (const x of file.transactions) {
    const oldRule = x.recurringRuleId;
    if (oldRule !== null && isUuid(oldRule) && (await uuidV5(oldRule, x.occurredOn)) === x.id) {
      txIds.set(x.id, await uuidV5(pick(r, oldRule) as string, x.occurredOn));
    } else {
      txIds.set(x.id, await uuidV5(FINORA_NAMESPACE, `${userId}:import:transaction:${x.id}`));
    }
  }

  const budgets = [];
  for (const x of file.budgets) {
    const categoryId = pick(c, x.categoryId);
    budgets.push({ ...x, id: await defaultId(userId, budgetSlug(categoryId)), categoryId });
  }

  return {
    ...file,
    wallets: file.wallets.map((x) => ({ ...x, id: w.get(x.id) ?? x.id })),
    categories: file.categories.map((x) => ({ ...x, id: c.get(x.id) ?? x.id, parentId: pick(c, x.parentId) })),
    debts: file.debts.map((x) => ({ ...x, id: d.get(x.id) ?? x.id })),
    budgets,
    recurringRules: file.recurringRules.map((x) => ({
      ...x,
      id: r.get(x.id) ?? x.id,
      walletId: pick(w, x.walletId) ?? x.walletId,
      toWalletId: pick(w, x.toWalletId),
      categoryId: pick(c, x.categoryId),
      debtId: pick(d, x.debtId),
    })),
    shoppingItems: file.shoppingItems.map((x) => ({ ...x, id: sh.get(x.id) ?? x.id, transactionId: pick(txIds, x.transactionId) })),
    transactions: file.transactions.map((x) => ({
      ...x,
      id: txIds.get(x.id) ?? x.id,
      walletId: pick(w, x.walletId) ?? x.walletId,
      toWalletId: pick(w, x.toWalletId),
      categoryId: pick(c, x.categoryId),
      debtId: pick(d, x.debtId),
      recurringRuleId: pick(r, x.recurringRuleId),
    })),
  };
}

/**
 * Свой файл (с блоком настроек этого аккаунта): id записей остаются, но id бюджета обязан быть выведен из его категории —
 * иначе позже созданный на эту категорию бюджет оказался бы вторым. Для корректного файла ничего не меняет.
 */
export async function withBudgetIds(file: BackupFile, userId: string): Promise<BackupFile> {
  const budgets = [];
  for (const x of file.budgets) budgets.push({ ...x, id: await defaultId(userId, budgetSlug(x.categoryId)) });
  return { ...file, budgets };
}
