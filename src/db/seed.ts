import type { CategoryKind } from '@/domain/types';
import { defaultId } from './ids';
import type { Store } from './store';

/**
 * Стартовые данные нового пользователя: настройки (базовая валюта TJS), категории и кошелёк «Наличные».
 * id детерминированы (от userId и вечного slug), поэтому два устройства одного пользователя при затравке
 * создадут ОДНИ И ТЕ ЖЕ строки, а не дубли. Slug менять нельзя.
 *
 * Вызывать только после первой успешной загрузки данных с сервера: иначе свежие локальные настройки
 * оказались бы «новее» серверных и затёрли их.
 */

interface SeedCategory {
  slug: string;
  kind: CategoryKind;
  name: string;
  icon: string;
  color: string;
}

const SEED_CATEGORIES: readonly SeedCategory[] = [
  { slug: 'category:food', kind: 'expense', name: 'Еда', icon: '🍽️', color: '#f97316' },
  { slug: 'category:groceries', kind: 'expense', name: 'Продукты', icon: '🛒', color: '#22c55e' },
  { slug: 'category:transport', kind: 'expense', name: 'Транспорт', icon: '🚌', color: '#3b82f6' },
  { slug: 'category:housing', kind: 'expense', name: 'Жильё', icon: '🏠', color: '#a855f7' },
  { slug: 'category:communication', kind: 'expense', name: 'Связь', icon: '📱', color: '#06b6d4' },
  { slug: 'category:health', kind: 'expense', name: 'Здоровье', icon: '💊', color: '#ef4444' },
  { slug: 'category:shopping', kind: 'expense', name: 'Покупки', icon: '🛍️', color: '#ec4899' },
  { slug: 'category:entertainment', kind: 'expense', name: 'Развлечения', icon: '🎬', color: '#f59e0b' },
  { slug: 'category:subscriptions', kind: 'expense', name: 'Подписки', icon: '🔁', color: '#6366f1' },
  { slug: 'category:education', kind: 'expense', name: 'Образование', icon: '🎓', color: '#14b8a6' },
  { slug: 'category:debts', kind: 'expense', name: 'Долги', icon: '🤝', color: '#64748b' },
  { slug: 'category:other-expense', kind: 'expense', name: 'Прочее', icon: '📦', color: '#94a3b8' },
  { slug: 'category:salary', kind: 'income', name: 'Зарплата', icon: '💼', color: '#16a34a' },
  { slug: 'category:side-income', kind: 'income', name: 'Подработка', icon: '🧰', color: '#0ea5e9' },
  { slug: 'category:bonus', kind: 'income', name: 'Бонус', icon: '🎯', color: '#eab308' },
  { slug: 'category:gifts', kind: 'income', name: 'Подарки', icon: '🎁', color: '#f43f5e' },
  { slug: 'category:other-income', kind: 'income', name: 'Прочее', icon: '💰', color: '#84cc16' },
];

const CASH_SLUG = 'wallet:cash';

/**
 * Создаёт стартовые данные, если у пользователя ещё нет строки настроек. Идемпотентна: повторный вызов
 * (и вызов на втором устройстве) ничего не дублирует. Всё делается одной транзакцией — либо вся затравка, либо ничего.
 * Возвращает true, если затравка выполнена сейчас.
 */
export async function ensureSeeded(store: Store): Promise<boolean> {
  // id считаются ДО транзакции: ожидание не-Dexie промисов (crypto) внутри транзакции её закрыло бы.
  const walletId = await defaultId(store.userId, CASH_SLUG);
  const categoryIds = await Promise.all(SEED_CATEGORIES.map((c) => defaultId(store.userId, c.slug)));
  const { db } = store;

  return db.transaction('rw', [db.settings, db.wallets, db.categories, db.meta], async () => {
    if (await db.settings.get(store.userId)) return false;

    if (!(await db.wallets.get(walletId))) {
      await store.wallets.create(
        { name: 'Наличные', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#16a34a', icon: '💵' },
        { id: walletId },
      );
    }
    for (const [i, c] of SEED_CATEGORIES.entries()) {
      const id = categoryIds[i];
      if (id === undefined || (await db.categories.get(id))) continue;
      await store.categories.create({ name: c.name, kind: c.kind, color: c.color, icon: c.icon }, { id });
    }
    const wallet = await db.wallets.get(walletId);
    const usable = wallet !== undefined && wallet.deletedAt === null && wallet.archivedAt === null;
    await store.settings.ensure({ baseCurrency: 'TJS', weekStartsOn: 1, defaultWalletId: usable ? walletId : null });
    return true;
  });
}
