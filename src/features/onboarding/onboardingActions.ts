import type { Store } from '@/db';
import { ValidationError } from '@/db';
import type { CurrencyCode, LocalRow, Minor, Wallet, WalletKind } from '@/domain/types';
import { cleanName, COLOR_CHOICES, DEFAULT_ICON_BY_KIND, sameName } from '@/features/wallets/walletUi';
import { defaultId } from '@/db';

/** Записи мастера в базу. Все повторяемы: второй вызов с теми же данными ничего не дублирует. */

export interface WalletDraft {
  name: string;
  kind: WalletKind;
  currency: CurrencyCode;
  openingBalanceMinor: Minor;
}

export type AddWalletResult = { status: 'created'; wallet: LocalRow<Wallet> } | { status: 'exists'; wallet: LocalRow<Wallet> };

function checkName(raw: string): string {
  const name = cleanName(raw);
  if (name === '') throw new ValidationError('Введите название кошелька');
  if (name.length > 60) throw new ValidationError('Название не длиннее 60 символов');
  return name;
}

const liveOnes = (rows: LocalRow<Wallet>[]) => rows.filter((w) => w.deletedAt === null && w.archivedAt === null);

/**
 * Создаёт кошелёк, если кошелька с таким названием ещё нет. Проверка и запись — в одной транзакции, поэтому
 * двойной тап и повторное «Дальше» не заведут второй такой же («exists» — вернули уже существующий).
 */
export async function addWalletOnce(store: Store, draft: WalletDraft): Promise<AddWalletResult> {
  const name = checkName(draft.name);
  const { db } = store;
  return db.transaction('rw', [db.wallets, db.meta], async () => {
    const live = liveOnes(await db.wallets.toArray());
    const same = live.find((w) => sameName(w.name, name));
    if (same) return { status: 'exists' as const, wallet: same };
    const color = COLOR_CHOICES[live.length % COLOR_CHOICES.length]?.value ?? '#16a34a';
    const wallet = await store.wallets.create({
      name,
      kind: draft.kind,
      currency: draft.currency,
      openingBalanceMinor: draft.openingBalanceMinor,
      color,
      icon: DEFAULT_ICON_BY_KIND[draft.kind],
    });
    return { status: 'created' as const, wallet };
  });
}

/** Правка кошелька. Название не должно совпасть с другим кошельком. Менять значок вместе с видом, пока значок «по умолчанию». */
export async function editWallet(store: Store, wallet: LocalRow<Wallet>, draft: WalletDraft): Promise<LocalRow<Wallet>> {
  const name = checkName(draft.name);
  const { db } = store;
  return db.transaction('rw', [db.wallets, db.transactions, db.recurring_rules, db.savings_goals, db.meta], async () => {
    const live = liveOnes(await db.wallets.toArray());
    if (live.some((w) => w.id !== wallet.id && sameName(w.name, name))) {
      throw new ValidationError('Кошелёк с таким названием уже есть');
    }
    const patch: Parameters<typeof store.wallets.update>[1] = {};
    if (name !== wallet.name) patch.name = name;
    if (draft.kind !== wallet.kind) {
      patch.kind = draft.kind;
      if (wallet.icon === DEFAULT_ICON_BY_KIND[wallet.kind]) patch.icon = DEFAULT_ICON_BY_KIND[draft.kind];
    }
    if (draft.currency !== wallet.currency) patch.currency = draft.currency;
    if (draft.openingBalanceMinor !== wallet.openingBalanceMinor) patch.openingBalanceMinor = draft.openingBalanceMinor;
    return Object.keys(patch).length > 0 ? store.wallets.update(wallet.id, patch) : wallet;
  });
}

/** Убрать лишний кошелёк (в архив). Если он был «по умолчанию» — по умолчанию станет первый оставшийся. */
export async function removeWallet(store: Store, wallet: LocalRow<Wallet>): Promise<void> {
  const { db } = store;
  await db.transaction('rw', [db.wallets, db.transactions, db.recurring_rules, db.savings_goals, db.settings, db.meta], async () => {
    await store.wallets.archive(wallet.id);
    const settings = await store.settings.get();
    if (settings?.defaultWalletId === wallet.id) {
      const left = liveOnes(await db.wallets.toArray()).sort((a, b) => a.sortOrder - b.sortOrder)[0];
      await store.settings.update({ defaultWalletId: left?.id ?? null });
    }
  });
}

/**
 * Основная валюта. Пока операций нет, нетронутый стартовый «Наличные» переходит в ту же валюту:
 * иначе у человека с USD «наличные» остались бы в сомони.
 */
export async function setBaseCurrency(store: Store, code: CurrencyCode): Promise<void> {
  const seedId = await defaultId(store.userId, 'wallet:cash');
  const { db } = store;
  await db.transaction('rw', [db.settings, db.wallets, db.transactions, db.recurring_rules, db.savings_goals, db.meta], async () => {
    const settings = await store.settings.get();
    if (!settings) throw new ValidationError('Настройки ещё не созданы: дождитесь первой загрузки данных');
    if (settings.baseCurrency !== code) await store.settings.update({ baseCurrency: code });
    const seed = await db.wallets.get(seedId);
    if (seed && seed.deletedAt === null && seed.currency !== code && (await db.transactions.count()) === 0) {
      await store.wallets.update(seed.id, { currency: code });
    }
  });
}

/** Категория вкл/выкл: выключенная уходит в архив, включённая возвращается. */
export async function setCategoryEnabled(store: Store, id: string, enabled: boolean): Promise<void> {
  if (enabled) await store.categories.restore(id);
  else await store.categories.archive(id);
}
